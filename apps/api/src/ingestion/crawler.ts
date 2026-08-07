/**
 * The match crawler (tasks 1.1–1.3).
 *
 * Three stages, each independently restartable:
 *   1. Seed  — pull apex-tier league entries, store their PUUIDs.
 *   2. Discover — walk each seed's recent match ids, dedup, queue them.
 *   3. Fetch — pull full match JSON for queued ids, upsert into `raw_matches`.
 *
 * The crawler is entirely off the request path (design.md §2): tier-list
 * computation must never block, or be blocked by, live API traffic.
 *
 * Every Riot call runs on a named rate-limit lane. Backfill and live refresh
 * use different lanes so a backfill run can never starve the 30-minute refresh
 * SLA (R1.2, design.md §3).
 *
 * _Requirements: 1.1, 1.2, 1.8, 11.5, 12.1, 12.2_
 */
import {
  RiotApiError,
  patchOf,
  queueIdOf,
  type RateLimitLane,
  type RiotApiClient,
} from '@tft-codex/riot-client';
import { MatchSchema } from '@tft-codex/riot-client';

import type { IngestionRepository } from '../repositories/ingestion-repository.js';

/** Only ranked TFT feeds the meta engine (R1.1). */
const RANKED_TFT_QUEUE_ID = 1100;

export interface CrawlerOptions {
  riot: RiotApiClient;
  repository: IngestionRepository;
  platform: string;
  regional: string;
  /** `live` for the scheduled refresh, `backfill` for bulk historical runs. */
  lane?: RateLimitLane;
  logger?: (message: string, detail?: unknown) => void;
}

export interface SeedResult {
  discovered: number;
  newPlayers: number;
}

export interface DiscoverResult {
  playersCrawled: number;
  matchIdsSeen: number;
  newMatchIds: number;
}

export interface FetchResult {
  attempted: number;
  stored: number;
  skipped: number;
}

export class Crawler {
  readonly #riot: RiotApiClient;
  readonly #repo: IngestionRepository;
  readonly #platform: string;
  readonly #regional: string;
  readonly #lane: RateLimitLane;
  readonly #log: (message: string, detail?: unknown) => void;

  constructor(options: CrawlerOptions) {
    this.#riot = options.riot;
    this.#repo = options.repository;
    this.#platform = options.platform;
    this.#regional = options.regional;
    this.#lane = options.lane ?? 'live';
    this.#log = options.logger ?? (() => undefined);
  }

  /**
   * Task 1.1 — seed the player pool from Challenger/Grandmaster/Master.
   *
   * Apex tiers are used because they produce the cleanest meta signal: comps
   * are piloted closer to their ceiling, so placement differences reflect the
   * comp rather than the pilot.
   */
  async seedPlayers(): Promise<SeedResult> {
    const tiers = ['challenger', 'grandmaster', 'master'] as const;
    const players: { puuid: string; platform: string; tier: string }[] = [];

    for (const tier of tiers) {
      try {
        const league = await this.#riot.getApexLeague(tier, { lane: this.#lane });
        for (const entry of league.entries) {
          players.push({ puuid: entry.puuid, platform: this.#platform, tier: league.tier });
        }
      } catch (error) {
        // One empty tier must not abort seeding — a region may genuinely have
        // no Challenger entries early in a set.
        this.#log(`seed: ${tier} failed`, error);
      }
    }

    const newPlayers = await this.#repo.upsertSeedPlayers(players);
    this.#log(`seed: ${players.length} entries, ${newPlayers} new`);
    return { discovered: players.length, newPlayers };
  }

  /**
   * Task 1.2 — walk seed players' recent matches and queue unseen ids.
   *
   * `matchesPerPlayer` is small by design. Apex players share lobbies
   * constantly, so the same match arrives from up to 8 seeds; pulling a deep
   * history per player buys far less coverage per request than pulling a
   * shallow history across many players.
   */
  async discoverMatches(
    options: { players?: number; matchesPerPlayer?: number } = {},
  ): Promise<DiscoverResult> {
    const playerLimit = options.players ?? 50;
    const matchesPerPlayer = options.matchesPerPlayer ?? 20;

    const players = await this.#repo.claimSeedPlayersToCrawl(playerLimit);
    let matchIdsSeen = 0;
    let newMatchIds = 0;
    const crawled: string[] = [];

    for (const player of players) {
      try {
        const ids = await this.#riot.getMatchIdsByPuuid(player.puuid, {
          count: matchesPerPlayer,
          lane: this.#lane,
        });
        matchIdsSeen += ids.length;
        newMatchIds += await this.#repo.recordDiscoveredMatches(ids, this.#regional);
        crawled.push(player.puuid);
      } catch (error) {
        // A player who transferred region or was banned 404s. Mark them
        // crawled anyway so they rotate to the back of the queue instead of
        // being retried first on every cycle.
        if (error instanceof RiotApiError && error.isNotFound) {
          crawled.push(player.puuid);
          continue;
        }
        this.#log(`discover: ${player.puuid} failed`, error);
      }
    }

    await this.#repo.markSeedPlayersCrawled(crawled);
    this.#log(`discover: ${crawled.length} players, ${newMatchIds}/${matchIdsSeen} new matches`);
    return { playersCrawled: crawled.length, matchIdsSeen, newMatchIds };
  }

  /**
   * Task 1.3 — fetch queued matches and store them.
   *
   * Non-ranked queues are skipped permanently rather than stored and filtered
   * later: storing them would inflate the raw table with rows the aggregation
   * job can never use, and re-fetching them each cycle would waste budget the
   * live refresh needs.
   */
  async fetchMatches(options: { limit?: number } = {}): Promise<FetchResult> {
    const limit = options.limit ?? 100;
    const queued = await this.#repo.claimMatchesToFetch(limit);

    let stored = 0;
    let skipped = 0;

    for (const item of queued) {
      try {
        const raw = await this.#riot.getMatch(item.matchId, { lane: this.#lane });
        const match = MatchSchema.parse(raw);
        const queueId = queueIdOf(match.info);

        if (queueId !== RANKED_TFT_QUEUE_ID) {
          await this.#repo.skipMatch(item.matchId, `queue ${queueId ?? 'unknown'} not ranked TFT`);
          skipped += 1;
          continue;
        }

        const patch = patchOf(match.info);
        if (!patch) {
          // An unfamiliar game_version means the parser drifted. Skip with a
          // reason rather than storing an unpatched row that would silently
          // mislabel every stat derived from it.
          await this.#repo.skipMatch(item.matchId, `unparseable game_version`);
          skipped += 1;
          continue;
        }

        await this.#repo.upsertRawMatch({
          matchId: match.metadata.match_id,
          patch,
          queueId,
          setNumber: match.info.tft_set_number ?? null,
          // Riot reports game_datetime in epoch milliseconds.
          gameDatetime: new Date(match.info.game_datetime),
          regional: item.regional,
          payload: match,
        });
        stored += 1;
      } catch (error) {
        if (error instanceof RiotApiError && error.isNotFound) {
          await this.#repo.skipMatch(item.matchId, 'not found');
          skipped += 1;
          continue;
        }
        // Anything else is likely transient — leave it queued for the next run.
        this.#log(`fetch: ${item.matchId} failed`, error);
      }
    }

    this.#log(`fetch: ${stored} stored, ${skipped} skipped of ${queued.length}`);
    return { attempted: queued.length, stored, skipped };
  }

  /** One full crawl cycle, wrapped in pipeline bookkeeping (R11.5). */
  async runCycle(
    options: { players?: number; matchesPerPlayer?: number; fetchLimit?: number } = {},
  ): Promise<{ seed: SeedResult; discover: DiscoverResult; fetch: FetchResult }> {
    const runId = await this.#repo.startRun('crawl');
    try {
      const seed = await this.seedPlayers();
      const discover = await this.discoverMatches(options);
      const fetch = await this.fetchMatches({ limit: options.fetchLimit ?? 100 });

      await this.#repo.finishRun(runId, {
        status: 'succeeded',
        matchesProcessed: fetch.stored,
      });
      return { seed, discover, fetch };
    } catch (error) {
      await this.#repo.finishRun(runId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
