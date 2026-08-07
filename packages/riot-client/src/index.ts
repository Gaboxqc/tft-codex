/**
 * @tft-codex/riot-client — the only sanctioned path to Riot's API (R12.1).
 *
 * All calls are server-side: the API key lives in a secrets manager and never
 * reaches a client bundle or the Overwolf package (design.md §10).
 */
export * from './errors.js';
export * from './routing.js';
export * from './dto.js';
export * from './riot-api-client.js';
export * from './rate-limit/types.js';
export * from './rate-limit/bucket-math.js';
export { MemoryRateLimiter } from './rate-limit/memory-token-bucket.js';
export { RedisRateLimiter } from './rate-limit/redis-token-bucket.js';
export { createRateLimiter, rateLimiterConfigFromEnv } from './rate-limit/factory.js';
