/**
 * Process entry point: wires real connections, starts Fastify, shuts down
 * cleanly.
 *
 * Note which ClickHouse client the HTTP context gets: the gateway one. That is
 * the compliance boundary from design.md §7 expressed in wiring — request
 * handlers physically cannot hold credentials that can read augment win rates.
 */
import { loadConfig } from './config.js';
import { createAdminClickHouse, createGatewayClickHouse } from './db/clickhouse.js';
import { createPostgresPool } from './db/postgres.js';
import { createRedis } from './db/redis.js';
import { buildApp } from './http/app.js';
import { RiotApiClient, createRateLimiter, rateLimiterConfigFromEnv } from '@tft-codex/riot-client';

import { AugmentInternalRepository } from './repositories/augment-internal-repository.js';
import { AugmentRepository } from './repositories/augment-repository.js';
import { AuthRepository } from './repositories/auth-repository.js';
import { BuilderRepository } from './repositories/builder-repository.js';
import { CompRepository } from './repositories/comp-repository.js';
import { GameDataRepository } from './repositories/game-data-repository.js';
import { IngestionRepository } from './repositories/ingestion-repository.js';
import { OlapReadRepository } from './repositories/olap-repository.js';
import { PlayerRepository } from './repositories/player-repository.js';
import { ReferenceRepository } from './repositories/reference-repository.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createPostgresPool(config.postgres.connectionString);
  const cache = createRedis(config.redis.url);
  // Gateway credentials, not admin. Do not "temporarily" change this.
  const olapClient = createGatewayClickHouse(config);
  /**
   * Admin credentials, used for exactly one thing: letting the recommendation
   * engine ORDER augment options. `AugmentInternalRepository` is the only
   * consumer, and `POST /v1/recommendations` turns its output into a
   * qualitative reason string rather than a number (design.md §7 step 3).
   *
   * This is the one place in the request path with credentials that can read
   * the restricted table, which is why it is called out here rather than
   * quietly constructed alongside the others.
   */
  const augmentStatsClient = createAdminClickHouse(config);

  const app = await buildApp({
    logger: true,
    context: {
      config,
      cache,
      comps: new CompRepository(db),
      augments: new AugmentRepository(db),
      ingestion: new IngestionRepository(db),
      olap: new OlapReadRepository(olapClient),
      augmentStats: new AugmentInternalRepository(augmentStatsClient),
      reference: new ReferenceRepository(db),
      players: new PlayerRepository(db),
      auth: new AuthRepository(db),
      builder: new BuilderRepository(db),
      gameData: new GameDataRepository(db),
      // Shares the Redis token bucket with the crawler, so request-time
      // lookups draw from the same budget rather than a second one Riot has
      // no idea about (R12.2).
      riot: new RiotApiClient({
        apiKey: config.riot.apiKey,
        platform: config.riot.platform,
        ...(config.riot.regional ? { regional: config.riot.regional } : {}),
        rateLimiter: createRateLimiter(rateLimiterConfigFromEnv(), cache),
      }),
      log: (message, detail) => console.warn(`[api] ${message}`, detail ?? ''),
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await Promise.allSettled([db.end(), cache.quit(), olapClient.close()]);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.server.port, host: config.server.host });

  if (!config.compliance.tier3RecommendationsConfirmed) {
    // Stated at every boot on purpose. This is the flag that decides whether
    // the app is inside or outside Riot's real-time-recommendation policy
    // (R3.7), and it should never be a surprise which way it is set.
    app.log.info(
      'Recommendation engine locked to Tier-2 (static lookup). ' +
        'Tier-3 adaptive mode requires written Riot confirmation — see docs/approvals.md.',
    );
  }
}

main().catch((error: unknown) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
