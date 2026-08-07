import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitTimeoutError } from '../errors.js';
import { admitAll, refill, refillRatePerMs, waitMsFor } from './bucket-math.js';
import { MemoryRateLimiter } from './memory-token-bucket.js';
import { rateLimiterConfigFromEnv } from './factory.js';
import type { RateLimiterConfig } from './types.js';

describe('bucket math', () => {
  it('refills proportionally to elapsed time and caps at capacity', () => {
    const config = { capacity: 10, refillWindowSeconds: 1 };
    expect(refillRatePerMs(config)).toBeCloseTo(0.01);

    expect(refill({ tokens: 0, updatedAt: 0 }, config, 500).tokens).toBeCloseTo(5);
    expect(refill({ tokens: 0, updatedAt: 0 }, config, 5_000).tokens).toBe(10);
  });

  it('never rewinds a bucket when the clock jumps backwards', () => {
    const config = { capacity: 10, refillWindowSeconds: 1 };
    expect(refill({ tokens: 4, updatedAt: 1_000 }, config, 500).tokens).toBe(4);
  });

  it('reports Infinity when a cost can never fit', () => {
    const config = { capacity: 5, refillWindowSeconds: 1 };
    expect(waitMsFor({ tokens: 5, updatedAt: 0 }, config, 6)).toBe(Infinity);
  });

  it('admits against every bucket or none of them', () => {
    const configs = [
      { capacity: 10, refillWindowSeconds: 1 },
      { capacity: 1, refillWindowSeconds: 10 },
    ];
    const states = [
      { tokens: 10, updatedAt: 0 },
      { tokens: 0, updatedAt: 0 },
    ];

    const result = admitAll(states, configs, 1, 0);
    expect(result.admitted).toBe(false);
    // The generous bucket must not have been drained by the failed attempt.
    expect(states[0]!.tokens).toBe(10);
  });

  it('waits for the slowest bucket, not the fastest', () => {
    const configs = [
      { capacity: 10, refillWindowSeconds: 1 }, // 100ms per token
      { capacity: 10, refillWindowSeconds: 10 }, // 1000ms per token
    ];
    const states = [
      { tokens: 0, updatedAt: 0 },
      { tokens: 0, updatedAt: 0 },
    ];
    const result = admitAll(states, configs, 1, 0);
    expect(result.admitted).toBe(false);
    if (!result.admitted) expect(result.waitMs).toBe(1_000);
  });
});

describe('MemoryRateLimiter (_Requirements: 12.2_)', () => {
  let clock = 0;
  const now = () => clock;

  const config: RateLimiterConfig = {
    globalLimits: [{ capacity: 10, refillWindowSeconds: 1 }],
    laneLimits: {
      live: { capacity: 6, refillWindowSeconds: 1 },
      backfill: { capacity: 2, refillWindowSeconds: 1 },
      lobby: { capacity: 8, refillWindowSeconds: 1 },
      player: { capacity: 4, refillWindowSeconds: 1 },
    },
    maxWaitMs: 5_000,
  };

  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('admits up to the lane capacity without waiting', async () => {
    const limiter = new MemoryRateLimiter(config, now);
    for (let index = 0; index < 2; index += 1) {
      await limiter.acquire('backfill');
    }
    const snapshot = await limiter.inspect('backfill');
    expect(snapshot.laneTokens).toBeCloseTo(0);
  });

  it('caps a lane below the global budget so it cannot starve the others', async () => {
    // The whole point of design.md §3's lane split: backfill has no deadline,
    // the 30-minute refresh (R1.2) does, and lobby intel (R14.1) is synchronous.
    const limiter = new MemoryRateLimiter(config, now);
    await limiter.acquire('backfill');
    await limiter.acquire('backfill');

    const backfill = await limiter.inspect('backfill');
    const live = await limiter.inspect('live');

    expect(backfill.laneTokens).toBeCloseTo(0);
    // Backfill drained its own lane but left the live lane untouched...
    expect(live.laneTokens).toBe(6);
    // ...while still consuming from the shared global budget, as it must.
    expect(live.globalTokens[0]).toBeCloseTo(8);
  });

  it('times out rather than waiting forever when a lane is saturated', async () => {
    const limiter = new MemoryRateLimiter(
      {
        ...config,
        laneLimits: { ...config.laneLimits, backfill: { capacity: 1, refillWindowSeconds: 600 } },
        maxWaitMs: 100,
      },
      now,
    );
    await limiter.acquire('backfill');
    await expect(limiter.acquire('backfill')).rejects.toBeInstanceOf(RateLimitTimeoutError);
  });

  it('rejects a cost that could never be admitted instead of hanging', async () => {
    const limiter = new MemoryRateLimiter(config, now);
    await expect(limiter.acquire('backfill', 99)).rejects.toThrow(/can never be admitted/);
  });

  it('serialises concurrent callers so they cannot both take the last token', async () => {
    const limiter = new MemoryRateLimiter(
      {
        ...config,
        laneLimits: { ...config.laneLimits, live: { capacity: 1, refillWindowSeconds: 1 } },
      },
      now,
    );

    const first = limiter.acquire('live');
    const second = limiter.acquire('live');

    await first;
    const snapshot = await limiter.inspect('live');
    expect(snapshot.laneTokens).toBeCloseTo(0);

    // The second caller must be waiting for a refill, not already admitted.
    clock += 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(second).resolves.toBeUndefined();
  });
});

describe('rateLimiterConfigFromEnv', () => {
  it('falls back to development-key defaults when unconfigured', () => {
    const config = rateLimiterConfigFromEnv({});
    expect(config.globalLimits[0]).toEqual({ capacity: 20, refillWindowSeconds: 1 });
  });

  it('derives lane caps from the configured per-second limit', () => {
    const config = rateLimiterConfigFromEnv({
      RIOT_RATE_LIMIT_PER_SECOND: '100',
      RIOT_RATE_LIMIT_PER_TWO_MINUTES: '2000',
    });
    expect(config.globalLimits).toEqual([
      { capacity: 100, refillWindowSeconds: 1 },
      { capacity: 2000, refillWindowSeconds: 120 },
    ]);
    expect(config.laneLimits.live.capacity).toBe(60);
    expect(config.laneLimits.backfill.capacity).toBe(30);
  });

  it('never produces a lane capacity of zero, which would deadlock the lane', () => {
    const config = rateLimiterConfigFromEnv({ RIOT_RATE_LIMIT_PER_SECOND: '1' });
    for (const limit of Object.values(config.laneLimits)) {
      expect(limit.capacity).toBeGreaterThanOrEqual(1);
    }
  });
});
