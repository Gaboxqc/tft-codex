/**
 * Aggregate-and-publish entry point (tasks 1.6, 1.7, 1.8).
 *
 * `npm run aggregate --workspace @tft-codex/api`
 *
 * Aggregation uses the ADMIN ClickHouse client because it writes. Publishing
 * reads through the GATEWAY client — the same restricted credentials the API
 * uses — so the numbers that reach the tier list have demonstrably travelled a
 * path that cannot touch `augment_internal_stats` (R3.1, design.md §7).
 */
import { loadConfig } from '../config.js';
import { createAdminClickHouse, createGatewayClickHouse } from '../db/clickhouse.js';
import { createPostgresPool } from '../db/postgres.js';
import { createRedis } from '../db/redis.js';
import { CompRepository } from '../repositories/comp-repository.js';
import { IngestionRepository } from '../repositories/ingestion-repository.js';
import { OlapReadRepository, OlapWriteRepository } from '../repositories/olap-repository.js';
import { Aggregator } from './aggregator.js';
import { TierListPublisher } from './publisher.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createPostgresPool(config.postgres.connectionString);
  const redis = createRedis(config.redis.url);
  const adminOlap = createAdminClickHouse(config);
  const gatewayOlap = createGatewayClickHouse(config);

  try {
    const ingestion = new IngestionRepository(db);
    const comps = new CompRepository(db);
    const log = (message: string, detail?: unknown) =>
      console.warn(`[aggregate] ${message}`, detail ?? '');

    const aggregator = new Aggregator({
      repository: ingestion,
      olap: new OlapWriteRepository(adminOlap),
      signaturesByPatch: await comps.signaturesByPatch(),
      logger: log,
    });

    const result = await aggregator.run();

    if (result.unmatchedParticipants > 0) {
      const ratio = result.unmatchedParticipants / Math.max(1, result.participantsProcessed);
      // A rising unmatched ratio is the earliest signal that the signature
      // registry has fallen behind a balance patch — worth surfacing before
      // the tier list starts looking thin (design.md §3).
      log(
        `${(ratio * 100).toFixed(1)}% of participants matched no registered comp signature. ` +
          'If this is climbing, the registry needs a refresh for this patch.',
      );
    }

    const patch = await comps.currentPatch();
    if (!patch) {
      log('no current patch marked — skipping publish');
      return;
    }

    const publisher = new TierListPublisher({
      // Read via the restricted gateway credentials, deliberately.
      olap: new OlapReadRepository(gatewayOlap),
      comps,
      repository: ingestion,
      cache: redis,
      minSampleSize: config.meta.compMinSampleSize,
      logger: log,
    });

    const snapshot = await publisher.publish(patch);
    console.warn(
      `[aggregate] done — ${result.matchesProcessed} matches aggregated, ` +
        `${snapshot.entries.length} comps published for patch ${patch}`,
    );
  } finally {
    await Promise.allSettled([db.end(), redis.quit(), adminOlap.close(), gatewayOlap.close()]);
  }
}

main().catch((error: unknown) => {
  console.error('[aggregate] failed', error);
  process.exit(1);
});
