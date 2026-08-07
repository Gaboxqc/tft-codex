/**
 * `GET /v1/comps` and `GET /v1/comps/:id` (task 1.10).
 *
 * Comp metadata comes from Postgres, computed stats from the published
 * snapshot. Reading stats from the snapshot rather than querying ClickHouse per
 * request means a comp detail page shows exactly the numbers the tier list
 * showed — the two can never disagree, which they would if each computed its
 * own view at a slightly different moment.
 *
 * _Requirements: 2.1–2.6, 11.1_
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DIFFICULTIES, PLAYSTYLES, type Comp, type TierList } from '@tft-codex/shared-types';

import { CACHE_KEYS } from '../../db/redis.js';
import type { CompMetadata } from '../../repositories/comp-repository.js';
import type { AppContext } from '../context.js';
import { cachedRead, fingerprintOf } from '../cache.js';

const SearchQuerySchema = z.object({
  patch: z.string().optional(),
  q: z.string().max(100).optional(),
  carry: z.string().max(100).optional(),
  trait: z.string().max(100).optional(),
  playstyle: z.enum(PLAYSTYLES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
});

/**
 * Joins Postgres metadata with the snapshot's computed stats.
 *
 * A comp with no snapshot entry is still returned — it exists and is worth
 * browsing — but carries zeroed stats and a `provisional` tier so nothing
 * implies a rank it never earned (R1.4).
 */
export function toComp(metadata: CompMetadata, snapshot: TierList | null): Comp {
  const entry = snapshot?.entries.find((candidate) => candidate.compId === metadata.id);

  return {
    id: metadata.id,
    name: metadata.name,
    ...(metadata.altName ? { altName: metadata.altName } : {}),
    patch: metadata.patch,
    tier: entry?.tier ?? 'provisional',
    trend: entry?.trend ?? 'stable',
    playstyle: metadata.playstyle,
    difficulty: metadata.difficulty,
    coreTraits: metadata.coreTraits,
    carries: metadata.carries,
    units: metadata.units,
    formation: metadata.formation,
    augmentPriority: metadata.augmentPriority,
    curatedAugments: metadata.curatedAugments,
    explanation: metadata.explanation,
    stageGuides: metadata.stageGuides,
    flexSlots: metadata.flexSlots,
    computedStats: entry?.stats ?? {
      avgPlacement: 0,
      top4Rate: 0,
      winRate: 0,
      playRate: 0,
      sampleSize: 0,
      computedAt: snapshot?.lastRefreshedAt ?? new Date(0).toISOString(),
    },
  };
}

export async function registerCompRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/v1/comps', async (request, reply) => {
    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_query',
        detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }

    const filters = parsed.data;
    const patch = filters.patch ?? (await context.comps.currentPatch());
    if (!patch) {
      return reply.status(503).send({ error: 'no_current_patch' });
    }

    const { value, hit } = await cachedRead(
      {
        cache: context.cache,
        route: 'comps.search',
        fingerprint: fingerprintOf({ patch, ...filters }),
        ttlSeconds: context.config.meta.refreshIntervalMinutes * 60,
        logger: context.log,
      },
      async () => {
        const snapshot = await readSnapshot(context, patch);
        const metadata = await context.comps.search({
          patch,
          ...(filters.q ? { query: filters.q } : {}),
          ...(filters.carry ? { carry: filters.carry } : {}),
          ...(filters.trait ? { trait: filters.trait } : {}),
          ...(filters.playstyle ? { playstyle: filters.playstyle } : {}),
          ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
        });
        return { patch, comps: metadata.map((comp) => toComp(comp, snapshot)) };
      },
    );

    reply.header('x-cache', hit ? 'hit' : 'miss');
    reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300');
    return value;
  });

  app.get<{ Params: { id: string }; Querystring: { patch?: string } }>(
    '/v1/comps/:id',
    async (request, reply) => {
      const patch = request.query.patch ?? (await context.comps.currentPatch());
      if (!patch) {
        return reply.status(503).send({ error: 'no_current_patch' });
      }

      const { value, hit } = await cachedRead(
        {
          cache: context.cache,
          route: 'comps.detail',
          fingerprint: fingerprintOf({ patch, id: request.params.id }),
          ttlSeconds: context.config.meta.refreshIntervalMinutes * 60,
          logger: context.log,
        },
        async () => {
          const metadata = await context.comps.findById(request.params.id, patch);
          if (!metadata) return null;
          return toComp(metadata, await readSnapshot(context, patch));
        },
      );

      if (!value) {
        return reply.status(404).send({
          error: 'comp_not_found',
          detail: `No comp "${request.params.id}" on patch ${patch}.`,
        });
      }

      reply.header('x-cache', hit ? 'hit' : 'miss');
      reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300');
      return value;
    },
  );
}

async function readSnapshot(context: AppContext, patch: string): Promise<TierList | null> {
  try {
    const version = await context.cache.get(CACHE_KEYS.tierListVersion(patch));
    if (!version) return null;
    const raw = await context.cache.get(CACHE_KEYS.tierListSnapshot(patch, version));
    return raw ? (JSON.parse(raw) as TierList) : null;
  } catch (error) {
    context.log('comp snapshot read failed', error);
    return null;
  }
}
