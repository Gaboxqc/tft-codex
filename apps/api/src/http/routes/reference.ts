/**
 * `GET /v1/reference/breakpoints` (task 2.14).
 *
 * A chart, not a calculator (R17.2). It is sourced entirely from patch-level
 * game constants and takes no player input — there is deliberately no `gold`
 * or `level` query parameter, because accepting one would turn a static
 * reference into a live calculator wired to the player's state, which is the
 * Tier-1/Tier-2 boundary R3.7 draws.
 *
 * A player reads this and does the arithmetic themselves. That is the design,
 * not a limitation.
 *
 * _Requirements: 17.1, 17.2_
 */
import type { FastifyInstance } from 'fastify';
import type { BreakpointReference } from '@tft-codex/shared-types';

import type { AppContext } from '../context.js';
import { cachedRead, fingerprintOf } from '../cache.js';

export async function registerReferenceRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  app.get<{ Querystring: { patch?: string } }>(
    '/v1/reference/breakpoints',
    async (request, reply) => {
      const patch = request.query.patch ?? (await context.comps.currentPatch());
      if (!patch) return reply.status(503).send({ error: 'no_current_patch' });

      const { value, hit } = await cachedRead(
        {
          cache: context.cache,
          route: 'reference.breakpoints',
          fingerprint: fingerprintOf({ patch }),
          // Game constants change only on a patch, so this can be cached far
          // longer than anything computed from match data.
          ttlSeconds: 60 * 60 * 6,
          logger: context.log,
        },
        async (): Promise<BreakpointReference> => context.reference.breakpoints(patch),
      );

      reply.header('x-cache', hit ? 'hit' : 'miss');
      reply.header('cache-control', 'public, max-age=3600');
      return value;
    },
  );
}
