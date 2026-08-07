/**
 * Persistence for the ingestion pipeline.
 *
 * Every write here is idempotent. Crawler workers get restarted, jobs get
 * retried, and a run that half-finished must be safe to run again — design.md
 * §9 makes that a requirement, not an aspiration.
 *
 * _Requirements: 1.1, 1.2, 1.8_
 */
import type { Database } from '../db/postgres.js';

export interface SeedPlayer {
  puuid: string;
  platform: string;
  tier: string;
}

export interface RawMatchRow {
  matchId: string;
  patch: string | null;
  queueId: number | null;
  setNumber: number | null;
  gameDatetime: Date | null;
  regional: string;
  payload: unknown;
}

export class IngestionRepository {
  constructor(private readonly db: Database) {}

  // ── Seed players (task 1.1) ──────────────────────────────────────────────

  /**
   * Upserts apex-tier players. `discovered_at` is preserved on conflict so a
   * player's crawl priority isn't reset every time they reappear in the
   * Challenger list.
   */
  async upsertSeedPlayers(players: readonly SeedPlayer[]): Promise<number> {
    if (players.length === 0) return 0;

    const { rowCount } = await this.db.query(
      `
      INSERT INTO seed_players (puuid, platform, tier)
      SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])
      ON CONFLICT (puuid) DO UPDATE SET tier = EXCLUDED.tier
      `,
      [
        players.map((player) => player.puuid),
        players.map((player) => player.platform),
        players.map((player) => player.tier),
      ],
    );
    return rowCount ?? 0;
  }

  /**
   * Least-recently-crawled players first, nulls first.
   *
   * The ordering is the whole point: without it the crawler re-walks the same
   * few players every cycle while the rest of the pool goes stale, and the
   * match sample quietly narrows to a handful of accounts.
   */
  async claimSeedPlayersToCrawl(limit: number): Promise<SeedPlayer[]> {
    const { rows } = await this.db.query<{ puuid: string; platform: string; tier: string }>(
      `
      SELECT puuid, platform, tier
      FROM seed_players
      ORDER BY last_crawled_at NULLS FIRST
      LIMIT $1
      `,
      [limit],
    );
    return rows;
  }

  async markSeedPlayersCrawled(puuids: readonly string[]): Promise<void> {
    if (puuids.length === 0) return;
    await this.db.query(
      'UPDATE seed_players SET last_crawled_at = now() WHERE puuid = ANY($1::text[])',
      [puuids],
    );
  }

  // ── Match discovery (task 1.2) ───────────────────────────────────────────

  /**
   * Records discovered match ids and returns how many were genuinely new.
   *
   * `ON CONFLICT DO NOTHING` is the dedup mechanism, and dedup is the single
   * biggest saving on the Riot rate-limit budget — apex players share lobbies
   * constantly, so the same match id arrives from up to 8 different seeds.
   */
  async recordDiscoveredMatches(matchIds: readonly string[], regional: string): Promise<number> {
    if (matchIds.length === 0) return 0;

    const { rowCount } = await this.db.query(
      `
      INSERT INTO discovered_matches (match_id, regional)
      SELECT unnest($1::text[]), $2
      ON CONFLICT (match_id) DO NOTHING
      `,
      [matchIds, regional],
    );
    return rowCount ?? 0;
  }

  /** Match ids discovered but not yet fetched, oldest first. */
  async claimMatchesToFetch(limit: number): Promise<{ matchId: string; regional: string }[]> {
    const { rows } = await this.db.query<{ match_id: string; regional: string }>(
      `
      SELECT match_id, regional
      FROM discovered_matches
      WHERE fetched_at IS NULL AND skipped_reason IS NULL
      ORDER BY discovered_at
      LIMIT $1
      `,
      [limit],
    );
    return rows.map((row) => ({ matchId: row.match_id, regional: row.regional }));
  }

  /**
   * Marks a match as permanently unfetchable.
   *
   * Without this, a 404 or an out-of-scope queue is retried on every cycle
   * forever, burning rate-limit budget that the live refresh needs.
   */
  async skipMatch(matchId: string, reason: string): Promise<void> {
    await this.db.query('UPDATE discovered_matches SET skipped_reason = $2 WHERE match_id = $1', [
      matchId,
      reason,
    ]);
  }

  // ── Match storage (task 1.3) ─────────────────────────────────────────────

  /**
   * Upserts a raw match by `matchId`.
   *
   * `aggregated_at` is deliberately NOT reset on conflict: re-fetching a match
   * we already aggregated must not cause it to be counted twice.
   */
  async upsertRawMatch(match: RawMatchRow): Promise<void> {
    await this.db.query(
      `
      INSERT INTO raw_matches
        (match_id, patch, queue_id, set_number, game_datetime, regional, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (match_id) DO UPDATE SET
        patch         = EXCLUDED.patch,
        queue_id      = EXCLUDED.queue_id,
        set_number    = EXCLUDED.set_number,
        game_datetime = EXCLUDED.game_datetime,
        payload       = EXCLUDED.payload
      `,
      [
        match.matchId,
        match.patch,
        match.queueId,
        match.setNumber,
        match.gameDatetime,
        match.regional,
        JSON.stringify(match.payload),
      ],
    );

    await this.db.query('UPDATE discovered_matches SET fetched_at = now() WHERE match_id = $1', [
      match.matchId,
    ]);
  }

  /** Matches ingested but not yet folded into the rollups (task 1.6). */
  async claimMatchesToAggregate(
    limit: number,
  ): Promise<{ matchId: string; patch: string; payload: unknown }[]> {
    const { rows } = await this.db.query<{ match_id: string; patch: string; payload: unknown }>(
      `
      SELECT match_id, patch, payload
      FROM raw_matches
      WHERE aggregated_at IS NULL AND patch IS NOT NULL
      ORDER BY ingested_at
      LIMIT $1
      `,
      [limit],
    );
    return rows.map((row) => ({
      matchId: row.match_id,
      patch: row.patch,
      payload: row.payload,
    }));
  }

  /**
   * Marks matches consumed. Called only after their deltas have landed in
   * ClickHouse, so a crash between the two re-counts a batch rather than
   * silently dropping it — over-counting is recoverable by a recount, losing
   * matches is not detectable at all.
   */
  async markMatchesAggregated(matchIds: readonly string[]): Promise<void> {
    if (matchIds.length === 0) return;
    await this.db.query(
      'UPDATE raw_matches SET aggregated_at = now() WHERE match_id = ANY($1::text[])',
      [matchIds],
    );
  }

  // ── Pipeline bookkeeping (R1.6, R11.5) ───────────────────────────────────

  async startRun(kind: 'crawl' | 'aggregate' | 'score'): Promise<number> {
    const { rows } = await this.db.query<{ id: string }>(
      'INSERT INTO pipeline_runs (kind) VALUES ($1) RETURNING id',
      [kind],
    );
    return Number(rows[0]!.id);
  }

  async finishRun(
    id: number,
    result: {
      status: 'succeeded' | 'failed';
      matchesProcessed?: number;
      publishedVersion?: string;
      error?: string;
    },
  ): Promise<void> {
    await this.db.query(
      `
      UPDATE pipeline_runs
      SET finished_at = now(),
          status = $2,
          matches_processed = $3,
          published_version = $4,
          error = $5
      WHERE id = $1
      `,
      [
        id,
        result.status,
        result.matchesProcessed ?? 0,
        result.publishedVersion ?? null,
        result.error ?? null,
      ],
    );
  }

  /** Backs the stale-data check (R1.6) and the healthcheck metric (R11.5). */
  async lastSuccessfulRunAt(kind: 'crawl' | 'aggregate' | 'score'): Promise<Date | null> {
    const { rows } = await this.db.query<{ finished_at: Date }>(
      `
      SELECT finished_at FROM pipeline_runs
      WHERE kind = $1 AND status = 'succeeded' AND finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
      `,
      [kind],
    );
    return rows[0]?.finished_at ?? null;
  }
}
