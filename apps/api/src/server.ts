/**
 * Process entry point: wires real connections, starts Fastify, shuts down
 * cleanly.
 *
 * Note which ClickHouse client the HTTP context gets: the gateway one. That is
 * the compliance boundary from design.md §7 expressed in wiring — request
 * handlers physically cannot hold credentials that can read augment win rates.
 */
import { loadConfig } from './config.js';
import { createGatewayClickHouse } from './db/clickhouse.js';
import { createPostgresPool } from './db/postgres.js';
import { createRedis } from './db/redis.js';
import { buildApp } from './http/app.js';
import { CompRepository } from './repositories/comp-repository.js';
import { IngestionRepository } from './repositories/ingestion-repository.js';
import { OlapReadRepository } from './repositories/olap-repository.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createPostgresPool(config.postgres.connectionString);
  const cache = createRedis(config.redis.url);
  // Gateway credentials, not admin. Do not "temporarily" change this.
  const olapClient = createGatewayClickHouse(config);

  const app = await buildApp({
    logger: true,
    context: {
      config,
      cache,
      comps: new CompRepository(db),
      ingestion: new IngestionRepository(db),
      olap: new OlapReadRepository(olapClient),
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
