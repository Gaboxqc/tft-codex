import type Redis from 'ioredis';

import { MemoryRateLimiter } from './memory-token-bucket.js';
import { RedisRateLimiter } from './redis-token-bucket.js';
import { DEVELOPMENT_KEY_LIMITS, type RateLimiter, type RateLimiterConfig } from './types.js';

/**
 * Redis when a connection is supplied, in-process otherwise.
 *
 * The in-process fallback is safe only for a single replica. Anything that runs
 * more than one crawler process must pass Redis — otherwise each process
 * enforces the full limit independently and the app breaches Riot's actual
 * budget by exactly the replica count (R12.2).
 */
export function createRateLimiter(
  config: RateLimiterConfig,
  redis?: Redis | null,
  now: () => number = Date.now,
): RateLimiter {
  return redis ? new RedisRateLimiter(redis, config, now) : new MemoryRateLimiter(config, now);
}

/**
 * Builds limiter config from `RIOT_RATE_LIMIT_*` env vars, falling back to
 * development-key defaults. Lane caps scale with the configured per-second
 * limit rather than being restated, so raising the key tier doesn't require
 * remembering to raise four other numbers.
 */
export function rateLimiterConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RateLimiterConfig {
  const perSecond = Number(env['RIOT_RATE_LIMIT_PER_SECOND'] ?? 0);
  const perTwoMinutes = Number(env['RIOT_RATE_LIMIT_PER_TWO_MINUTES'] ?? 0);

  if (!Number.isFinite(perSecond) || perSecond <= 0) return DEVELOPMENT_KEY_LIMITS;

  const share = (fraction: number) => ({
    capacity: Math.max(1, Math.floor(perSecond * fraction)),
    refillWindowSeconds: 1,
  });

  const globalLimits = [{ capacity: perSecond, refillWindowSeconds: 1 }];
  if (Number.isFinite(perTwoMinutes) && perTwoMinutes > 0) {
    globalLimits.push({ capacity: perTwoMinutes, refillWindowSeconds: 120 });
  }

  return {
    globalLimits,
    laneLimits: {
      // Shares intentionally sum above 1.0: they are caps, not reservations.
      // The global bucket is what enforces the real limit; these only stop any
      // single lane from monopolising it (design.md §3).
      live: share(0.6),
      lobby: share(0.4),
      backfill: share(0.3),
      player: share(0.3),
    },
    maxWaitMs: Number(env['RIOT_RATE_LIMIT_MAX_WAIT_MS'] ?? 30_000),
    ...(env['RIOT_RATE_LIMIT_KEY_PREFIX'] ? { keyPrefix: env['RIOT_RATE_LIMIT_KEY_PREFIX'] } : {}),
  };
}
