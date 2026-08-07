/**
 * Redis-backed token bucket — the production limiter (design.md §3).
 *
 * The crawler runs as multiple replicas against a single Riot API key, so the
 * budget has to live outside any one process. Admission is a single Lua script
 * so the check-and-deduct across every bucket is atomic: without that, two
 * replicas can each see the last token and both send.
 */
import type Redis from 'ioredis';

import { RateLimitTimeoutError } from '../errors.js';
import type {
  BucketConfig,
  RateLimitLane,
  RateLimitSnapshot,
  RateLimiter,
  RateLimiterConfig,
} from './types.js';
import { refillRatePerMs } from './bucket-math.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Transliteration of `bucket-math.ts`'s `admitAll`.
 *
 * KEYS  — one Redis hash per bucket
 * ARGV  — [now_ms, cost, ttl_ms, (capacity, refill_per_ms) * n]
 * Returns 0 when admitted, otherwise the milliseconds to wait before retrying.
 */
const ADMIT_SCRIPT = `
local now  = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local ttl  = tonumber(ARGV[3])

local tokens = {}
local waitMs = 0

for i = 1, #KEYS do
  local capacity = tonumber(ARGV[3 + (i - 1) * 2 + 1])
  local rate     = tonumber(ARGV[3 + (i - 1) * 2 + 2])

  local state = redis.call('HMGET', KEYS[i], 'tokens', 'ts')
  local available = tonumber(state[1])
  local ts = tonumber(state[2])
  if available == nil or ts == nil then
    available = capacity
    ts = now
  end

  local elapsed = now - ts
  if elapsed < 0 then elapsed = 0 end
  available = math.min(capacity, available + elapsed * rate)
  tokens[i] = available

  if available < cost then
    local need = math.ceil((cost - available) / rate)
    if need > waitMs then waitMs = need end
  end
end

if waitMs > 0 then
  return waitMs
end

for i = 1, #KEYS do
  redis.call('HSET', KEYS[i], 'tokens', tokens[i] - cost, 'ts', now)
  redis.call('PEXPIRE', KEYS[i], ttl)
end

return 0
`;

/** Read-only variant: refills and reports without deducting. */
const INSPECT_SCRIPT = `
local now = tonumber(ARGV[1])
local out = {}
for i = 1, #KEYS do
  local capacity = tonumber(ARGV[1 + (i - 1) * 2 + 1])
  local rate     = tonumber(ARGV[1 + (i - 1) * 2 + 2])
  local state = redis.call('HMGET', KEYS[i], 'tokens', 'ts')
  local available = tonumber(state[1])
  local ts = tonumber(state[2])
  if available == nil or ts == nil then
    available = capacity
    ts = now
  end
  local elapsed = now - ts
  if elapsed < 0 then elapsed = 0 end
  available = math.min(capacity, available + elapsed * rate)
  -- Redis Lua cannot return floats; scale to preserve one decimal place.
  out[i] = math.floor(available * 10)
end
return out
`;

export class RedisRateLimiter implements RateLimiter {
  readonly #redis: Redis;
  readonly #config: RateLimiterConfig;
  readonly #prefix: string;
  readonly #now: () => number;

  constructor(redis: Redis, config: RateLimiterConfig, now: () => number = Date.now) {
    this.#redis = redis;
    this.#config = config;
    this.#prefix = config.keyPrefix ?? 'tftcodex:ratelimit';
    this.#now = now;
  }

  #laneConfig(lane: RateLimitLane): BucketConfig {
    const config = this.#config.laneLimits[lane];
    if (!config) throw new Error(`No rate-limit configuration for lane "${lane}".`);
    return config;
  }

  /**
   * Global buckets are shared across lanes — they represent Riot's actual
   * per-key limits. The lane bucket is what keeps backfill from eating the
   * whole key (design.md §3).
   */
  #keysAndConfigs(lane: RateLimitLane): { keys: string[]; configs: BucketConfig[] } {
    const globals = this.#config.globalLimits;
    return {
      keys: [
        ...globals.map((limit) => `${this.#prefix}:global:${limit.refillWindowSeconds}s`),
        `${this.#prefix}:lane:${lane}`,
      ],
      configs: [...globals, this.#laneConfig(lane)],
    };
  }

  /**
   * TTL is generous relative to the refill window: a bucket that expires early
   * silently resets to full capacity, which would hand out free tokens. Ten
   * refill windows is long enough that only a genuinely idle bucket expires,
   * and an idle bucket would have refilled to capacity anyway.
   */
  #ttlMs(configs: BucketConfig[]): number {
    const longest = Math.max(...configs.map((config) => config.refillWindowSeconds));
    return Math.ceil(longest * 1000 * 10);
  }

  async acquire(lane: RateLimitLane, cost = 1): Promise<void> {
    const { keys, configs } = this.#keysAndConfigs(lane);

    const overCapacity = configs.find((config) => cost > config.capacity);
    if (overCapacity) {
      throw new Error(
        `A cost of ${cost} exceeds a bucket capacity of ${overCapacity.capacity} on lane ` +
          `"${lane}"; it can never be admitted. Raise the configured capacity or lower the cost.`,
      );
    }

    const maxWaitMs = this.#config.maxWaitMs ?? 30_000;
    const deadline = this.#now() + maxWaitMs;
    const ttlMs = this.#ttlMs(configs);

    for (;;) {
      const args = [
        String(this.#now()),
        String(cost),
        String(ttlMs),
        ...configs.flatMap((config) => [String(config.capacity), String(refillRatePerMs(config))]),
      ];

      const waitMs = Number(await this.#redis.eval(ADMIT_SCRIPT, keys.length, ...keys, ...args));
      if (waitMs === 0) return;

      if (this.#now() + waitMs > deadline) {
        throw new RateLimitTimeoutError(lane, maxWaitMs);
      }
      await sleep(waitMs);
    }
  }

  async inspect(lane: RateLimitLane): Promise<RateLimitSnapshot> {
    const { keys, configs } = this.#keysAndConfigs(lane);
    const args = [
      String(this.#now()),
      ...configs.flatMap((config) => [String(config.capacity), String(refillRatePerMs(config))]),
    ];

    const raw = (await this.#redis.eval(INSPECT_SCRIPT, keys.length, ...keys, ...args)) as number[];
    const tokens = raw.map((value) => Number(value) / 10);

    return {
      lane,
      laneTokens: tokens[tokens.length - 1] ?? 0,
      laneCapacity: this.#laneConfig(lane).capacity,
      globalTokens: tokens.slice(0, this.#config.globalLimits.length),
      globalCapacities: this.#config.globalLimits.map((limit) => limit.capacity),
    };
  }
}
