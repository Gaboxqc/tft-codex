/**
 * `POST /v1/recommendations` (tasks 2.9, 2.13).
 *
 * The R3.7 enforcement point. A client may ask for `tier3-adaptive`; the server
 * decides what it actually gets, based on a deployment flag that only exists
 * server-side. No client build — web, Overwolf, or anything else — can enable
 * Tier-3 by itself (design.md §5).
 *
 * The downgrade is silent rather than an error, and `modeServed` echoes what
 * ran. An error would leave the Overwolf overlay with nothing to show; a silent
 * downgrade with an honest label keeps it useful and keeps the UI truthful.
 *
 * _Requirements: 3.1, 3.4, 3.5, 3.7, 5.4, 5.5_
 */
import type { FastifyInstance } from 'fastify';
import { RecommendationRequestSchema } from '@tft-codex/shared-types';

import { type AugmentDescriptor, type CompShape, recommend } from '../../domain/recommendation.js';
import type { AppContext } from '../context.js';

export async function registerRecommendationRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  app.post('/v1/recommendations', async (request, reply) => {
    const parsed = RecommendationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }

    const input = parsed.data;
    const patch = await context.comps.currentPatch();
    if (!patch) return reply.status(503).send({ error: 'no_current_patch' });

    const comps = await context.comps.listMetadata(patch);
    const compShapes: CompShape[] = comps.map((comp, index) => ({
      compId: comp.id,
      name: comp.name,
      units: comp.units.map((unit) => unit.championId),
      coreTraits: comp.coreTraits,
      tierRank: index,
    }));

    const offered = input.augmentOptions ?? [];
    const descriptors = new Map<string, AugmentDescriptor>();
    let counters: Awaited<ReturnType<typeof context.augmentStats.countersForAugments>> = [];

    if (offered.length > 0) {
      for (const record of await context.augments.descriptorsFor(patch, offered)) {
        descriptors.set(record.id, {
          id: record.id,
          name: record.name,
          category: (record.category ?? undefined) as AugmentDescriptor['category'],
          relatedTraits: record.relatedTraits,
          relatedCarries: record.relatedCarries,
          requiresTraits: record.requiresTraits,
        });
      }

      // Restricted stats, read with admin credentials by a service that never
      // serializes them. They order the options; a reason string is what ships
      // (design.md §7 step 3).
      counters = await context.augmentStats.countersForAugments(patch, offered);
    }

    const response = recommend({
      requestedMode: input.mode,
      // The flag lives in server config and nowhere else.
      tier3Confirmed: context.config.compliance.tier3RecommendationsConfirmed,
      offeredAugmentIds: offered,
      descriptors,
      counters,
      boardUnits: input.boardUnits,
      goldAvailable: input.goldAvailable,
      level: input.level,
      comps: compShapes,
    });

    if (input.mode === 'tier3-adaptive' && response.modeServed === 'tier2-lookup') {
      // Logged, not silent to us — a spike here means a client is shipping a
      // Tier-3 request it should not be, which is worth knowing before Riot
      // asks (R13.6).
      context.log('recommendation: downgraded tier3-adaptive request to tier2-lookup', {
        source: input.source,
      });
    }

    // Never cached. A recommendation is per-request by definition, and caching
    // one keyed by board state would be a stored record of what a player was
    // holding — exactly the shape of thing R14.3 and R10's privacy rules exist
    // to avoid.
    reply.header('cache-control', 'no-store');
    return response;
  });
}
