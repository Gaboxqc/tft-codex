/**
 * Crawl entry point (task 1.8).
 *
 * `npm run crawl --workspace @tft-codex/api [-- --lane backfill]`
 *
 * Run this on the 30-minute schedule that R1.2 requires. It is deliberately a
 * one-shot process rather than a daemon with an internal timer: a scheduler
 * (cron, ECS scheduled task, whatever the deployment uses) already handles
 * retries, overlap prevention and alerting on non-zero exit, and reimplementing
 * that inside the process would mean reimplementing it badly.
 */
import { RiotApiClient, createRateLimiter, rateLimiterConfigFromEnv } from '@tft-codex/riot-client';

import { loadConfig } from '../config.js';
import { createPostgresPool } from '../db/postgres.js';
import { createRedis } from '../db/redis.js';
import { IngestionRepository } from '../repositories/ingestion-repository.js';
import { Crawler } from './crawler.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const lane = process.argv.includes('--lane=backfill') ? 'backfill' : 'live';

  const db = createPostgresPool(config.postgres.connectionString);
  const redis = createRedis(config.redis.url);

  try {
    const riot = new RiotApiClient({
      apiKey: config.riot.apiKey,
      platform: config.riot.platform,
      ...(config.riot.regional ? { regional: config.riot.regional } : {}),
      // Redis-backed so multiple crawler replicas share one budget. Without
      // it each replica would enforce the full limit independently and the app
      // would breach Riot's actual budget by exactly the replica count (R12.2).
      rateLimiter: createRateLimiter(rateLimiterConfigFromEnv(), redis),
      onRequest: (event) => {
        // Feeds the R11.5 error-rate and rate-limit-consumption dashboards.
        if (event.status === null || event.status >= 400) {
          console.warn(
            `[riot] ${event.endpoint} status=${event.status ?? 'network'} attempt=${event.attempt}`,
          );
        }
      },
    });

    const crawler = new Crawler({
      riot,
      repository: new IngestionRepository(db),
      platform: config.riot.platform,
      regional: config.riot.regional ?? 'europe',
      lane,
      logger: (message, detail) => console.warn(`[crawl] ${message}`, detail ?? ''),
    });

    const result = await crawler.runCycle();
    console.warn(
      `[crawl] done — ${result.seed.newPlayers} new seeds, ` +
        `${result.discover.newMatchIds} new match ids, ${result.fetch.stored} matches stored`,
    );
  } finally {
    await Promise.allSettled([db.end(), redis.quit()]);
  }
}

main().catch((error: unknown) => {
  console.error('[crawl] failed', error);
  process.exit(1);
});
