/**
 * Tier-list publisher (tasks 1.7, 1.8).
 *
 * Reads the summed comp counters, runs the scoring formula, and publishes a
 * versioned snapshot to Redis.
 *
 * The publish is two-phase: write the snapshot under a fresh version key, then
 * flip the pointer. Readers hold the old version until the new one is complete,
 * so a crash mid-write leaves the previous tier list live rather than serving a
 * half-built one — which is design.md §9's "partial failure doesn't publish a
 * partial tier list", made concrete.
 *
 * _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 8.3_
 */
import type { CompTier, TierList, TierListEntry } from '@tft-codex/shared-types';

import { CACHE_KEYS, type Cache } from '../db/redis.js';
import {
  SCORING_FORMULA_VERSION,
  isMetaShift,
  scoreComps,
  trendFor,
  type ScoredComp,
} from '../domain/tier-scoring.js';
import type { CompRepository } from '../repositories/comp-repository.js';
import type { IngestionRepository } from '../repositories/ingestion-repository.js';
import type { OlapReadRepository } from '../repositories/olap-repository.js';

export interface PublisherOptions {
  olap: OlapReadRepository;
  comps: CompRepository;
  repository: IngestionRepository;
  cache: Cache;
  minSampleSize: number;
  /** Snapshots older than this are dropped; keeps Redis from growing forever. */
  snapshotTtlSeconds?: number;
  logger?: (message: string, detail?: unknown) => void;
  now?: () => Date;
}

export class TierListPublisher {
  readonly #olap: OlapReadRepository;
  readonly #comps: CompRepository;
  readonly #repo: IngestionRepository;
  readonly #cache: Cache;
  readonly #minSampleSize: number;
  readonly #ttl: number;
  readonly #log: (message: string, detail?: unknown) => void;
  readonly #now: () => Date;

  constructor(options: PublisherOptions) {
    this.#olap = options.olap;
    this.#comps = options.comps;
    this.#repo = options.repository;
    this.#cache = options.cache;
    this.#minSampleSize = options.minSampleSize;
    // Two full refresh cycles' worth of history by default — long enough that
    // a reader mid-request never loses the version it is holding.
    this.#ttl = options.snapshotTtlSeconds ?? 60 * 60 * 24;
    this.#log = options.logger ?? (() => undefined);
    this.#now = options.now ?? (() => new Date());
  }

  async publish(patch: string): Promise<TierList> {
    const runId = await this.#repo.startRun('score');

    try {
      const counters = await this.#olap.compCounters(patch);
      const scored = scoreComps(counters, { minSampleSize: this.#minSampleSize });

      // Metadata (name, playstyle, difficulty, carries) lives in Postgres;
      // stats live in ClickHouse. The tier list is the join of the two.
      const metadata = await this.#comps.listMetadata(patch);
      const metadataById = new Map(metadata.map((comp) => [comp.id, comp]));

      const previous = await this.#readCurrent(patch);
      const previousTierById = new Map(
        (previous?.entries ?? []).map((entry) => [entry.compId, entry.tier]),
      );

      const computedAt = this.#now().toISOString();
      const entries = scored
        // A comp with computed stats but no registry metadata has no confirmed
        // signature yet (design.md §3) — it belongs in the editorial queue, not
        // on a public tier list.
        .filter((comp) => metadataById.has(comp.compId))
        .map((comp) => this.#toEntry(comp, metadataById, previousTierById, computedAt))
        // Provisional comps sort to the bottom regardless of score, then by
        // score within each group. R1.4 says a low-sample comp has not earned a
        // rank; letting its score interleave it above a confident C-tier comp
        // would assert exactly the confidence we just declined to assert.
        .sort((a, b) => {
          const aProvisional = a.tier === 'provisional';
          const bProvisional = b.tier === 'provisional';
          if (aProvisional !== bProvisional) return aProvisional ? 1 : -1;
          return b.compositeScore - a.compositeScore;
        });

      const snapshot: TierList = {
        patch,
        lastRefreshedAt: computedAt,
        // A snapshot is never stale at the moment it is written. Staleness is
        // computed at read time against the refresh interval (R1.6).
        stale: false,
        scoringFormulaVersion: SCORING_FORMULA_VERSION,
        entries,
      };

      const version = `${Date.parse(computedAt)}`;
      await this.#writeThenFlip(patch, version, snapshot);

      await this.#repo.finishRun(runId, {
        status: 'succeeded',
        matchesProcessed: entries.length,
        publishedVersion: version,
      });

      this.#log(`publish: patch ${patch}, ${entries.length} comps, version ${version}`);
      return snapshot;
    } catch (error) {
      await this.#repo.finishRun(runId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  #toEntry(
    comp: ScoredComp,
    metadataById: Map<string, Awaited<ReturnType<CompRepository['listMetadata']>>[number]>,
    previousTierById: Map<string, CompTier>,
    computedAt: string,
  ): TierListEntry {
    const meta = metadataById.get(comp.compId)!;
    const previousTier = previousTierById.get(comp.compId);

    return {
      compId: comp.compId,
      name: meta.name,
      tier: comp.tier,
      trend: trendFor(previousTier, comp.tier),
      playstyle: meta.playstyle,
      difficulty: meta.difficulty,
      coreTraits: meta.coreTraits,
      carries: meta.carries,
      compositeScore: comp.compositeScore,
      stats: {
        avgPlacement: comp.avgPlacement,
        top4Rate: comp.top4Rate,
        winRate: comp.winRate,
        playRate: comp.playRate,
        sampleSize: comp.games,
        computedAt,
      },
      metaShift: previousTier ? isMetaShift(previousTier, comp.tier) : false,
    };
  }

  /**
   * Writes the snapshot under its own key, then flips the pointer.
   *
   * Never the other way round: a pointer flipped before the payload exists
   * makes every reader 404 until the write lands.
   */
  async #writeThenFlip(patch: string, version: string, snapshot: TierList): Promise<void> {
    await this.#cache.set(
      CACHE_KEYS.tierListSnapshot(patch, version),
      JSON.stringify(snapshot),
      'EX',
      this.#ttl,
    );
    await this.#cache.set(CACHE_KEYS.tierListVersion(patch), version);
    await this.#cache.set(CACHE_KEYS.lastPublishedAt, snapshot.lastRefreshedAt);
  }

  async #readCurrent(patch: string): Promise<TierList | null> {
    try {
      const version = await this.#cache.get(CACHE_KEYS.tierListVersion(patch));
      if (!version) return null;
      const raw = await this.#cache.get(CACHE_KEYS.tierListSnapshot(patch, version));
      return raw ? (JSON.parse(raw) as TierList) : null;
    } catch (error) {
      // Losing the previous snapshot costs us trend arrows for one cycle. It
      // must not stop the new tier list being published.
      this.#log('publish: could not read previous snapshot', error);
      return null;
    }
  }
}

/**
 * Whether the pipeline has missed 2x its normal interval (R1.6).
 *
 * The clients keep serving the last known-good data either way — this only
 * decides whether they say so (R11.2).
 */
export function isStale(
  lastRefreshedAt: string | null,
  refreshIntervalMinutes: number,
  now: Date = new Date(),
): boolean {
  if (!lastRefreshedAt) return true;
  const age = now.getTime() - Date.parse(lastRefreshedAt);
  if (!Number.isFinite(age)) return true;
  return age > refreshIntervalMinutes * 2 * 60_000;
}
