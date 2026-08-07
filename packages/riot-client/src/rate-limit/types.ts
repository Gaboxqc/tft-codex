/**
 * Rate limiting for the Riot API.
 *
 * R12.2 requires staying inside Riot's published limits for the app's key tier
 * **at all times**. Two things make that harder than a single bucket:
 *
 * 1. Riot enforces two windows at once (per-second and per-two-minutes), so a
 *    request must satisfy both before it goes out.
 * 2. design.md §3 requires backfill crawling to be unable to starve the
 *    30-minute refresh SLA (R1.2), and the Lobby Intel Service to get a
 *    reserved slice because it fires synchronously at loading-screen time and
 *    cannot queue behind a backfill job (R14.1).
 *
 * So: one set of global buckets enforcing Riot's actual limits, plus a per-lane
 * bucket capping how much of that budget any one lane may consume. A request is
 * admitted only when every applicable bucket has a token.
 */

/**
 * Traffic lanes with different starvation characteristics.
 *
 * - `live`     — the 30-minute meta refresh crawl. Must never be starved (R1.2).
 * - `backfill` — historical/bulk crawling. Lowest priority, hard-capped.
 * - `lobby`    — one-shot pre-combat lobby lookups, up to 7 per match. Latency
 *                sensitive and bursty; gets a reserved slice (R14.1).
 * - `player`   — on-demand personal match sync for a linked user (R4.1).
 */
export const RATE_LIMIT_LANES = ['live', 'backfill', 'lobby', 'player'] as const;
export type RateLimitLane = (typeof RATE_LIMIT_LANES)[number];

export interface BucketConfig {
  /** Maximum tokens the bucket can hold — also its burst size. */
  capacity: number;
  /** Seconds for a fully drained bucket to refill. */
  refillWindowSeconds: number;
}

export interface RateLimiterConfig {
  /**
   * Riot's published limits for this key tier. Every one of these must admit
   * the request. A development key is typically 20 req/s and 100 req/2min.
   */
  globalLimits: BucketConfig[];
  /**
   * Per-lane caps, expressed in the same units. These sit *inside* the global
   * budget — a lane cannot exceed its own cap even when the global bucket is
   * full, which is what stops backfill from consuming the whole key.
   */
  laneLimits: Record<RateLimitLane, BucketConfig>;
  /** Namespace for Redis keys, so multiple deployments can share one Redis. */
  keyPrefix?: string;
  /** How long a caller will wait for admission before giving up. */
  maxWaitMs?: number;
}

export interface RateLimiter {
  /**
   * Blocks until the request may proceed.
   *
   * @throws RateLimitTimeoutError if admission takes longer than `maxWaitMs`.
   */
  acquire(lane: RateLimitLane, cost?: number): Promise<void>;
  /**
   * Current token counts, for the R11.5 rate-limit-consumption dashboard.
   * Reported without consuming anything.
   */
  inspect(lane: RateLimitLane): Promise<RateLimitSnapshot>;
}

export interface RateLimitSnapshot {
  lane: RateLimitLane;
  /** Tokens left in the lane's own bucket. */
  laneTokens: number;
  laneCapacity: number;
  /** Tokens left in each global bucket, in the order they were configured. */
  globalTokens: number[];
  globalCapacities: number[];
}

/**
 * Sensible defaults for a Riot **development** key (20 req/s, 100 req/2min).
 *
 * The lane split reserves headroom rather than dividing the budget exactly:
 * lobby traffic is bursty (7 lookups arrive at once) and live refresh must
 * never wait behind backfill. Backfill is capped well below the global limit
 * on purpose — it is the only lane with no deadline.
 *
 * Re-tune these the moment a production key lands; they are read from env
 * (`RIOT_RATE_LIMIT_*`) rather than hardcoded at the call site.
 */
export const DEVELOPMENT_KEY_LIMITS: RateLimiterConfig = {
  globalLimits: [
    { capacity: 20, refillWindowSeconds: 1 },
    { capacity: 100, refillWindowSeconds: 120 },
  ],
  laneLimits: {
    live: { capacity: 12, refillWindowSeconds: 1 },
    backfill: { capacity: 6, refillWindowSeconds: 1 },
    lobby: { capacity: 8, refillWindowSeconds: 1 },
    player: { capacity: 6, refillWindowSeconds: 1 },
  },
  maxWaitMs: 30_000,
};
