/**
 * Linked player profiles, their matches, and the deletion path.
 *
 * R7.2 limits stored identity to PUUID, region and display Riot ID — that is
 * the whole of what this class can write, because it is the whole of what the
 * table has.
 *
 * R7.3 requires unlink to delete the profile and every derived analytic within
 * 30 days. `requestDeletion` marks the row; `purgeExpired` removes it, and the
 * cascade takes the matches and coaching rows with it. Nothing has to be
 * remembered in application code.
 *
 * _Requirements: 4.1, 4.2, 4.4, 4.6, 4.7, 7.2, 7.3, 12.4, 15.4_
 */
import type { CurvePoint, MatchSummary, PlayerProfile } from '@tft-codex/shared-types';

import { withTransaction, type Database } from '../db/postgres.js';

export interface StoredMatch extends MatchSummary {
  completedItemCount?: number;
}

interface ProfileRow {
  puuid: string;
  region: string;
  riot_id: string;
  linked_at: Date;
  last_synced_at: Date | null;
  coaching_narrative_opt_out: boolean;
  deletion_requested_at: Date | null;
}

interface MatchRow {
  match_id: string;
  puuid: string;
  patch: string;
  placement: number;
  detected_comp_id: string | null;
  augments_picked: string[];
  level_curve: CurvePoint[];
  gold_curve: CurvePoint[];
  played_at: Date;
}

const toProfile = (row: ProfileRow): PlayerProfile => ({
  puuid: row.puuid,
  region: row.region,
  riotId: row.riot_id,
  linkedAt: row.linked_at.toISOString(),
  lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
  notificationPrefs: [],
  coachingNarrativeOptOut: row.coaching_narrative_opt_out,
});

const toMatch = (row: MatchRow): MatchSummary => ({
  matchId: row.match_id,
  puuid: row.puuid,
  patch: row.patch,
  placement: row.placement,
  detectedCompId: row.detected_comp_id,
  augmentsPicked: row.augments_picked,
  levelCurve: row.level_curve,
  goldCurve: row.gold_curve,
  timestamp: row.played_at.toISOString(),
});

export class PlayerRepository {
  constructor(private readonly db: Database) {}

  // ── Profile ──────────────────────────────────────────────────────────────

  /**
   * Creates or refreshes a linked profile.
   *
   * Re-linking clears any pending deletion: a user who unlinks and links again
   * within the retention window has plainly changed their mind, and leaving
   * the flag set would delete the account they just restored.
   */
  async upsertProfile(profile: {
    puuid: string;
    region: string;
    riotId: string;
  }): Promise<PlayerProfile> {
    const { rows } = await this.db.query<ProfileRow>(
      `
      INSERT INTO player_profiles (puuid, region, riot_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (puuid) DO UPDATE SET
        region = EXCLUDED.region,
        riot_id = EXCLUDED.riot_id,
        deletion_requested_at = NULL
      RETURNING *
      `,
      [profile.puuid, profile.region, profile.riotId],
    );
    return toProfile(rows[0]!);
  }

  /**
   * Reads a profile. A profile pending deletion reads as absent — the row
   * survives briefly for auditability, but nothing is served from it.
   */
  async findProfile(puuid: string): Promise<PlayerProfile | null> {
    const { rows } = await this.db.query<ProfileRow>(
      'SELECT * FROM player_profiles WHERE puuid = $1 AND deletion_requested_at IS NULL',
      [puuid],
    );
    return rows[0] ? toProfile(rows[0]) : null;
  }

  /** R15.4 — let a user opt out of AI narrative text in favour of raw stats. */
  async setCoachingOptOut(puuid: string, optOut: boolean): Promise<void> {
    await this.db.query(
      'UPDATE player_profiles SET coaching_narrative_opt_out = $2 WHERE puuid = $1',
      [puuid, optOut],
    );
  }

  // ── Deletion (R7.3, R12.4) ───────────────────────────────────────────────

  /** Marks a profile for deletion. Serving stops immediately. */
  async requestDeletion(puuid: string): Promise<void> {
    await this.db.query(
      'UPDATE player_profiles SET deletion_requested_at = now() WHERE puuid = $1',
      [puuid],
    );
  }

  /**
   * Hard-deletes profiles whose retention window has elapsed.
   *
   * Returns the deleted PUUIDs so the caller can write an audit line (R12.4).
   * The cascade removes matches, coaching rows, sessions and notification
   * prefs — there is no second query here to forget.
   */
  async purgeExpired(retentionDays = 30): Promise<string[]> {
    const { rows } = await this.db.query<{ puuid: string }>(
      `
      DELETE FROM player_profiles
      WHERE deletion_requested_at IS NOT NULL
        AND deletion_requested_at < now() - make_interval(days => $1)
      RETURNING puuid
      `,
      [retentionDays],
    );
    return rows.map((row) => row.puuid);
  }

  // ── Matches ──────────────────────────────────────────────────────────────

  /**
   * Upserts synced matches.
   *
   * Idempotent by `(match_id, puuid)`, so re-running a sync never duplicates
   * (task 3.13). Returns how many rows were genuinely new.
   *
   * Inserted row by row inside one transaction rather than as a single
   * multi-row statement. `augments_picked` is `text[]`, and there is no clean
   * way to pass an array *of* arrays through `UNNEST` without routing it
   * through jsonb and casting back — which is exactly the kind of clever SQL
   * that works until an augment id contains a quote. A sync batch is at most a
   * few dozen rows, so the loop costs nothing worth the risk.
   */
  async upsertMatches(matches: readonly StoredMatch[]): Promise<number> {
    if (matches.length === 0) return 0;

    return withTransaction(this.db, async (client) => {
      let inserted = 0;

      for (const match of matches) {
        const { rowCount } = await client.query(
          `
          INSERT INTO player_matches
            (match_id, puuid, patch, placement, detected_comp_id, augments_picked,
             level_curve, gold_curve, played_at)
          VALUES ($1, $2, $3, $4, $5, $6::text[], $7::jsonb, $8::jsonb, $9)
          ON CONFLICT (match_id, puuid) DO NOTHING
          `,
          [
            match.matchId,
            match.puuid,
            match.patch,
            match.placement,
            match.detectedCompId,
            match.augmentsPicked,
            JSON.stringify(match.levelCurve),
            JSON.stringify(match.goldCurve),
            match.timestamp,
          ],
        );
        inserted += rowCount ?? 0;
      }

      return inserted;
    });
  }

  async markSynced(puuid: string): Promise<void> {
    await this.db.query('UPDATE player_profiles SET last_synced_at = now() WHERE puuid = $1', [
      puuid,
    ]);
  }

  /** Match ids already stored, so a sync can skip fetching them again. */
  async knownMatchIds(puuid: string): Promise<Set<string>> {
    const { rows } = await this.db.query<{ match_id: string }>(
      'SELECT match_id FROM player_matches WHERE puuid = $1',
      [puuid],
    );
    return new Set(rows.map((row) => row.match_id));
  }

  async listMatches(
    puuid: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<MatchSummary[]> {
    const { rows } = await this.db.query<MatchRow>(
      `SELECT * FROM player_matches WHERE puuid = $1
       ORDER BY played_at DESC LIMIT $2 OFFSET $3`,
      [puuid, options.limit ?? 20, options.offset ?? 0],
    );
    return rows.map(toMatch);
  }

  async findMatch(puuid: string, matchId: string): Promise<MatchSummary | null> {
    const { rows } = await this.db.query<MatchRow>(
      'SELECT * FROM player_matches WHERE puuid = $1 AND match_id = $2',
      [puuid, matchId],
    );
    return rows[0] ? toMatch(rows[0]) : null;
  }

  /**
   * Aggregated personal stats (R4.4).
   *
   * Grouped by comp, and NOT by augment. R4.7 gates "placement broken down by
   * augment picked" on Riot's written answer (task 3.12); the data to compute
   * it sits in the same table, so the restriction has to live in the queries —
   * this is one of them, and it deliberately does not have that GROUP BY.
   */
  async analytics(
    puuid: string,
    range: { from?: Date; to?: Date } = {},
  ): Promise<{
    byComp: { compId: string | null; games: number; avgPlacement: number }[];
    totalGames: number;
    overallAvgPlacement: number | null;
  }> {
    const conditions = ['puuid = $1'];
    const params: unknown[] = [puuid];

    if (range.from) {
      params.push(range.from);
      conditions.push(`played_at >= $${params.length}`);
    }
    if (range.to) {
      params.push(range.to);
      conditions.push(`played_at <= $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const { rows } = await this.db.query<{
      detected_comp_id: string | null;
      games: string;
      avg_placement: string;
    }>(
      `SELECT detected_comp_id, count(*) AS games, avg(placement) AS avg_placement
       FROM player_matches WHERE ${where}
       GROUP BY detected_comp_id ORDER BY games DESC`,
      params,
    );

    const byComp = rows.map((row) => ({
      compId: row.detected_comp_id,
      games: Number(row.games),
      avgPlacement: Number(row.avg_placement),
    }));

    const totalGames = byComp.reduce((sum, entry) => sum + entry.games, 0);
    const overallAvgPlacement =
      totalGames === 0
        ? null
        : byComp.reduce((sum, entry) => sum + entry.avgPlacement * entry.games, 0) / totalGames;

    return { byComp, totalGames, overallAvgPlacement };
  }

  /**
   * Top-4 baseline curves for a comp (R4.3).
   *
   * Built from linked users' own stored matches, aggregated across everyone
   * who played the comp. Note the SELECT: it returns curves and nothing else —
   * no PUUID, no match id, no placement beyond the top-4 filter in the WHERE.
   * The result is an average with no identity attached to it, which is what
   * R4.6 requires of anything derived from other players.
   *
   * Capped because a baseline stops moving long before every historical match
   * is included, and an unbounded scan on a popular comp is a slow query on
   * the request path.
   */
  async baselineFor(
    compId: string,
    patch: string,
    limit = 200,
  ): Promise<{ levelCurves: CurvePoint[][]; goldCurves: CurvePoint[][]; sampleSize: number }> {
    const { rows } = await this.db.query<{ level_curve: CurvePoint[]; gold_curve: CurvePoint[] }>(
      `SELECT level_curve, gold_curve
       FROM player_matches
       WHERE detected_comp_id = $1 AND patch = $2 AND placement <= 4
       ORDER BY played_at DESC
       LIMIT $3`,
      [compId, patch, limit],
    );

    return {
      levelCurves: rows.map((row) => row.level_curve),
      goldCurves: rows.map((row) => row.gold_curve),
      sampleSize: rows.length,
    };
  }

  // ── Coaching (R15) ───────────────────────────────────────────────────────

  async saveCoaching(entry: {
    matchId: string;
    puuid: string;
    narrative: string;
    keyDeviationRound: string | null;
    suggestions: unknown;
  }): Promise<void> {
    await this.db.query(
      `
      INSERT INTO match_coaching (match_id, puuid, narrative, key_deviation_round, suggestions)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (match_id, puuid) DO UPDATE SET
        narrative = EXCLUDED.narrative,
        key_deviation_round = EXCLUDED.key_deviation_round,
        suggestions = EXCLUDED.suggestions,
        generated_at = now()
      `,
      [
        entry.matchId,
        entry.puuid,
        entry.narrative,
        entry.keyDeviationRound,
        JSON.stringify(entry.suggestions),
      ],
    );
  }

  async findCoaching(
    puuid: string,
    matchId: string,
  ): Promise<{
    narrative: string;
    keyDeviationRound: string | null;
    suggestions: unknown;
    generatedAt: string;
  } | null> {
    const { rows } = await this.db.query<{
      narrative: string;
      key_deviation_round: string | null;
      suggestions: unknown;
      generated_at: Date;
    }>('SELECT * FROM match_coaching WHERE puuid = $1 AND match_id = $2', [puuid, matchId]);

    const row = rows[0];
    return row
      ? {
          narrative: row.narrative,
          keyDeviationRound: row.key_deviation_round,
          suggestions: row.suggestions,
          generatedAt: row.generated_at.toISOString(),
        }
      : null;
  }
}
