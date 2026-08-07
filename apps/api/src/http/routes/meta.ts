/**
 * `GET /v1/meta/tier-list` (task 1.9).
 *
 * Reads the published snapshot rather than computing anything. The pipeline
 * publishes; this route serves. That separation is what keeps the p95 under
 * 300ms (R11.1) and keeps tier-list computation off the request path entirely
 * (design.md §2).
 *
 * _Requirements: 1.5, 1.6, 1.7, 11.1, 11.2_
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DIFFICULTIES,
  PLAYSTYLES,
  TIERS,
  type TierList,
  type TierListEntry,
} from '@tft-codex/shared-types';

import { CACHE_KEYS } from '../../db/redis.js';
import { isStale } from '../../ingestion/publisher.js';
import type { AppContext } from '../context.js';

const QuerySchema = z.object({
  patch: z.string().optional(),
  tier: z.enum([...TIERS, 'provisional']).optional(),
  playstyle: z.enum(PLAYSTYLES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
});

export function applyTierListFilters(
  entries: readonly TierListEntry[],
  filters: z.infer<typeof QuerySchema>,
): TierListEntry[] {
  return entries.filter((entry) => {
    if (filters.tier && entry.tier !== filters.tier) return false;
    if (filters.playstyle && entry.playstyle !== filters.playstyle) return false;
    if (filters.difficulty && entry.difficulty !== filters.difficulty) return false;
    return true;
  });
}

export async function registerMetaRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/v1/meta/tier-list', async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_query',
        detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }

    const filters = parsed.data;
    const patch = filters.patch ?? (await context.comps.currentPatch());

    if (!patch) {
      return reply.status(503).send({
        error: 'no_current_patch',
        detail: 'No patch is marked current. The data pipeline has not run yet.',
      });
    }

    const snapshot = await readSnapshot(context, patch);
    if (!snapshot) {
      // Nothing published yet for this patch. 503 rather than an empty 200 —
      // an empty tier list and "we have no data" mean different things to a
      // client, and conflating them hides a broken pipeline.
      return reply.status(503).send({
        error: 'no_snapshot',
        detail: `No tier list has been published for patch ${patch} yet.`,
      });
    }

    // Staleness is computed at read time, not baked into the snapshot: a
    // snapshot written 10 minutes ago is fresh, the same snapshot read three
    // hours later is not (R1.6).
    const body: TierList = {
      ...snapshot,
      stale: isStale(snapshot.lastRefreshedAt, context.config.meta.refreshIntervalMinutes),
      entries: applyTierListFilters(snapshot.entries, filters),
    };

    // Clients may cache briefly, but must revalidate well inside the refresh
    // cycle or they would render a stale list without the R1.6 banner.
    reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300');
    return body;
  });

  /**
   * Health/observability endpoint backing R11.5's "minutes since last
   * successful publish" metric.
   */
  app.get('/v1/meta/health', async (_request, reply) => {
    const lastPublished = await context.ingestion.lastSuccessfulRunAt('score');
    const lastCrawl = await context.ingestion.lastSuccessfulRunAt('crawl');
    const minutesSince = lastPublished
      ? Math.floor((Date.now() - lastPublished.getTime()) / 60_000)
      : null;

    const stale = isStale(
      lastPublished?.toISOString() ?? null,
      context.config.meta.refreshIntervalMinutes,
    );

    // 200 even when stale: the app is still serving last-known-good data
    // (R11.2). The `stale` flag is what alerting should page on.
    reply.header('cache-control', 'no-store');
    return {
      status: stale ? 'degraded' : 'ok',
      stale,
      minutesSinceLastPublish: minutesSince,
      lastSuccessfulPublishAt: lastPublished?.toISOString() ?? null,
      lastSuccessfulCrawlAt: lastCrawl?.toISOString() ?? null,
      refreshIntervalMinutes: context.config.meta.refreshIntervalMinutes,
    };
  });
}

async function readSnapshot(context: AppContext, patch: string): Promise<TierList | null> {
  try {
    const version = await context.cache.get(CACHE_KEYS.tierListVersion(patch));
    if (!version) return null;
    const raw = await context.cache.get(CACHE_KEYS.tierListSnapshot(patch, version));
    return raw ? (JSON.parse(raw) as TierList) : null;
  } catch (error) {
    context.log('tier-list snapshot read failed', error);
    return null;
  }
}
