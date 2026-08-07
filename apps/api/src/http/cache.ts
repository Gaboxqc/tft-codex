/**
 * Gateway response cache for public GET routes.
 *
 * R11.1 gives cached reads a p95 budget of 300ms; R11.2 requires the app stay
 * browsable when the pipeline or Riot is down. Both point at the same design:
 * serve from Redis, and treat a Redis failure as a cache miss rather than an
 * error — a slow response is a far better outcome than a 500.
 *
 * _Requirements: 11.1, 11.2_
 */
import type { Cache } from '../db/redis.js';

export interface CachedReadOptions {
  cache: Cache;
  route: string;
  /** Distinguishes one query-parameter combination from another. */
  fingerprint: string;
  ttlSeconds: number;
  logger?: (message: string, detail?: unknown) => void;
}

export interface CachedRead<T> {
  value: T;
  hit: boolean;
}

/**
 * Reads through the cache, computing on miss.
 *
 * Note what this deliberately does NOT do: it never caches a rejection. A
 * failed compute would otherwise be served for the whole TTL, turning a
 * transient blip into minutes of visible breakage.
 */
export async function cachedRead<T>(
  options: CachedReadOptions,
  compute: () => Promise<T>,
): Promise<CachedRead<T>> {
  const { cache, route, fingerprint, ttlSeconds } = options;
  const log = options.logger ?? (() => undefined);
  const key = `tftcodex:cache:${route}:${fingerprint}`;

  try {
    const cached = await cache.get(key);
    if (cached) return { value: JSON.parse(cached) as T, hit: true };
  } catch (error) {
    // Redis down: fall through and compute. R11.2 — degraded, not broken.
    log(`cache read failed for ${key}`, error);
  }

  const value = await compute();

  try {
    await cache.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error) {
    log(`cache write failed for ${key}`, error);
  }

  return { value, hit: false };
}

/** Stable fingerprint for a set of query parameters. */
export function fingerprintOf(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    // Sorted so `?tier=S&patch=17.9` and `?patch=17.9&tier=S` share one entry
    // rather than doubling the cache footprint and halving the hit rate.
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);

  return entries.length === 0 ? 'default' : entries.join('&');
}
