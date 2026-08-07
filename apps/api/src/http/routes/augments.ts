/**
 * `GET /v1/augments/tier-list` and `GET /v1/augments/:id` (tasks 2.4, 2.5).
 *
 * These routes are covered by three independent compliance layers:
 *
 *   1. `toPublicAugment` below is an explicit allowlist — it constructs the
 *      response field by field rather than spreading the row. A new database
 *      column cannot reach a client by accident, only by someone adding a line
 *      here, which is reviewable.
 *   2. The gateway's ClickHouse credentials cannot read the restricted stats
 *      table at all, so there is no number in reach to leak.
 *   3. The `preSerialization` guard scans the outbound payload and throws in
 *      dev/test, strips in production.
 *
 * design.md §7 calls layer 1 "belt-and-suspenders for if a future engineer adds
 * a field to the wrong type by mistake". That is exactly its job.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.6_
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUGMENT_KINDS, type Augment } from '@tft-codex/shared-types';

import type { PublicAugmentRecord } from '../../repositories/augment-repository.js';
import type { AppContext } from '../context.js';
import { cachedRead, fingerprintOf } from '../cache.js';

const QuerySchema = z.object({
  patch: z.string().optional(),
  kind: z.enum(AUGMENT_KINDS).default('augment'),
  tier: z.enum(['S', 'A', 'B', 'C']).optional(),
});

/**
 * THE ALLOWLIST. Every field a client may see about an augment, enumerated.
 *
 * Written as an explicit construction rather than `{ ...record }` on purpose:
 * a spread would forward whatever the row happens to contain, which is how the
 * mistake R3.1 guards against actually happens in practice.
 *
 * Before adding a field here, check it against requirements.md R3.1. If it is
 * derived from placement or win rate — including a percentile, a rank among
 * all augments, or a "score" — it does not go in. Those are win rates with
 * extra steps and can be inverted.
 */
export function toPublicAugment(record: PublicAugmentRecord): Augment & {
  provisional: boolean;
  category: string | null;
  curatedForCompIds: string[];
  qualitativeNotes: string;
} {
  return {
    id: record.id,
    name: record.name,
    tier: record.tier,
    playRate: record.playRate,
    roundsOffered: record.roundsOffered.filter(
      (round): round is 2 | 3 | 4 => round === 2 || round === 3 || round === 4,
    ),
    description: record.description,
    patch: record.patch,
    provisional: record.provisional,
    category: record.category,
    curatedForCompIds: record.curatedForCompIds,
    qualitativeNotes: record.qualitativeNotes,
  };
}

export async function registerAugmentRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  app.get('/v1/augments/tier-list', async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_query',
        detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }

    const filters = parsed.data;
    const patch = filters.patch ?? (await context.comps.currentPatch());
    if (!patch) return reply.status(503).send({ error: 'no_current_patch' });

    const { value, hit } = await cachedRead(
      {
        cache: context.cache,
        route: 'augments.tier-list',
        fingerprint: fingerprintOf({ patch, kind: filters.kind, tier: filters.tier }),
        ttlSeconds: context.config.meta.refreshIntervalMinutes * 60,
        logger: context.log,
      },
      async () => {
        const records = await context.augments.list(patch, filters.kind);
        const augments = records
          .filter((record) => !filters.tier || record.tier === filters.tier)
          .map(toPublicAugment);
        return { patch, kind: filters.kind, augments };
      },
    );

    reply.header('x-cache', hit ? 'hit' : 'miss');
    reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300');
    return value;
  });

  app.get<{ Params: { id: string }; Querystring: { patch?: string } }>(
    '/v1/augments/:id',
    async (request, reply) => {
      const patch = request.query.patch ?? (await context.comps.currentPatch());
      if (!patch) return reply.status(503).send({ error: 'no_current_patch' });

      const record = await context.augments.findById(request.params.id, patch);
      if (!record) {
        return reply.status(404).send({
          error: 'augment_not_found',
          detail: `No augment "${request.params.id}" on patch ${patch}.`,
        });
      }

      reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300');
      return toPublicAugment(record);
    },
  );
}
