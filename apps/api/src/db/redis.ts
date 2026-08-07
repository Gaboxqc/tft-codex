/**
 * Redis client and the key namespace.
 *
 * Redis carries three unrelated things (design.md §13): the published tier-list
 * snapshot, the Riot rate-limit token buckets, and the lobby-intel cache.
 * Naming them in one place keeps a stray `KEYS *` or a flush during debugging
 * from being ambiguous about what it just destroyed.
 */
import Redis from 'ioredis';

export type Cache = Redis;

export function createRedis(url: string): Cache {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    // The API must stay browsable on last-cached data if Redis is unreachable
    // (R11.2), so a connection failure has to surface as an error we can catch
    // rather than a promise that never settles.
    enableOfflineQueue: false,
    lazyConnect: false,
  });

  redis.on('error', (error) => {
    console.error('[redis] connection error', error.message);
  });

  return redis;
}

export const CACHE_KEYS = {
  /**
   * The published tier-list snapshot for a patch. Versioned: the aggregation
   * job writes a new version key and only then flips the pointer, so readers
   * never observe a half-written list (design.md §9).
   */
  tierListVersion: (patch: string) => `tftcodex:tierlist:${patch}:current`,
  tierListSnapshot: (patch: string, version: string) => `tftcodex:tierlist:${patch}:v:${version}`,
  /** Timestamp of the last successful publish, for the stale check (R1.6). */
  lastPublishedAt: 'tftcodex:pipeline:last-published-at',
  /** Gateway response cache for public GET routes (R11.1). */
  response: (route: string, fingerprint: string) => `tftcodex:cache:${route}:${fingerprint}`,
  /** One-shot lobby intel per match (R14.4). */
  lobbyIntel: (matchId: string) => `tftcodex:lobby:${matchId}`,
} as const;
