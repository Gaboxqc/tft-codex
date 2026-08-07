/**
 * Pure token-bucket arithmetic, extracted so it can be unit-tested without
 * Redis and so the in-memory limiter and the Lua script stay conceptually
 * identical (the Lua is a transliteration of `refill` + `admit` below).
 */
import type { BucketConfig } from './types.js';

export interface BucketState {
  tokens: number;
  /** Epoch ms of the last refill. */
  updatedAt: number;
}

/** Tokens restored per millisecond. */
export function refillRatePerMs(config: BucketConfig): number {
  return config.capacity / (config.refillWindowSeconds * 1000);
}

/** Advances a bucket to `now`, capped at capacity. */
export function refill(state: BucketState, config: BucketConfig, now: number): BucketState {
  const elapsed = Math.max(0, now - state.updatedAt);
  const tokens = Math.min(config.capacity, state.tokens + elapsed * refillRatePerMs(config));
  return { tokens, updatedAt: now };
}

/**
 * How long (ms) until `cost` tokens are available. 0 means "now".
 *
 * Returns `Infinity` when `cost` exceeds capacity — the request can never be
 * admitted, so callers must fail loudly rather than wait forever.
 */
export function waitMsFor(state: BucketState, config: BucketConfig, cost: number): number {
  if (cost > config.capacity) return Infinity;
  if (state.tokens >= cost) return 0;
  return Math.ceil((cost - state.tokens) / refillRatePerMs(config));
}

/**
 * Admits a request against every bucket at once, or admits none of them.
 *
 * All-or-nothing matters: deducting from the per-second bucket and then failing
 * on the per-two-minute bucket would leak tokens and slowly drift the limiter
 * out of sync with Riot's actual accounting.
 */
export function admitAll(
  states: BucketState[],
  configs: BucketConfig[],
  cost: number,
  now: number,
): { admitted: true; states: BucketState[] } | { admitted: false; waitMs: number } {
  const refilled = states.map((state, index) => refill(state, configs[index]!, now));

  let waitMs = 0;
  for (const [index, state] of refilled.entries()) {
    const wait = waitMsFor(state, configs[index]!, cost);
    if (wait > waitMs) waitMs = wait;
  }

  if (waitMs > 0) return { admitted: false, waitMs };

  return {
    admitted: true,
    states: refilled.map((state) => ({ tokens: state.tokens - cost, updatedAt: now })),
  };
}
