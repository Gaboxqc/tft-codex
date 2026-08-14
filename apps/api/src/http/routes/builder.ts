/**
 * Builder endpoints (tasks 4.3, 4.4, 4.8).
 *
 * `POST /v1/builder/comps`      save a board, get a share link
 * `GET  /v1/builder/comps/:id`  load a shared board, with live stats if it
 *                               matches a tracked comp (R6.4)
 * `POST /v1/builder/analyze`    traits + estimate for an unsaved board
 * `POST /v1/items/optimize`     multi-carry itemization (R16)
 *
 * R7.4: the builder works logged out. Saving anonymously is allowed — the
 * board is owned by whoever holds the link, the same trust model as an
 * unlisted document — and only *updating* requires a session.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.4, 16.1, 16.2, 16.3_
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { estimateBoard, type EstimateUnit } from '../../domain/board-estimate.js';
import { detectComp } from '../../domain/comp-detection.js';
import { optimizeItems, type OptimizerUnit } from '../../domain/item-optimizer.js';
import { activeTraits, resolveTraits, toTraitCounts } from '../../domain/traits.js';
import type { AppContext } from '../context.js';
import { tokenFrom } from '../require-session.js';
import { verifyAccessToken } from '../../auth/session.js';

const BuilderUnitSchema = z.object({
  championId: z.string().min(1),
  starLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  itemIds: z.array(z.string().min(1)).max(3).default([]),
  position: z.number().int().min(0).max(27).optional(),
});

const BoardSchema = z.object({
  name: z.string().min(1).max(80).default('Untitled board'),
  // The board cap is 10 in current sets; 12 leaves headroom for a future one
  // without a code change, and the real constraint is the player's level.
  units: z.array(BuilderUnitSchema).max(12),
  level: z.number().int().min(1).max(11).default(8),
  patch: z.string().optional(),
});

const OptimizeSchema = z.object({
  heldItems: z.array(z.string().min(1)).max(30),
  boardUnits: z.array(z.string().min(1)).min(1).max(12),
  compId: z.string().min(1).optional(),
  patch: z.string().optional(),
});

export async function registerBuilderRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  /**
   * Resolves the caller's PUUID if they happen to be signed in, without
   * requiring it. Saving anonymously is a supported path, not a fallback.
   */
  const optionalPuuid = async (
    request: Parameters<typeof tokenFrom>[0],
  ): Promise<string | null> => {
    const token = tokenFrom(request);
    if (!token) return null;

    const verified = verifyAccessToken(token, context.config.jwtSecret);
    if (!verified.valid) return null;

    const session = await context.auth.findSession(verified.claims.sid);
    return session?.puuid ?? null;
  };

  // ── Analysis for an unsaved board ────────────────────────────────────────

  app.post('/v1/builder/analyze', async (request, reply) => {
    const parsed = BoardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }

    const patch = parsed.data.patch ?? (await context.comps.currentPatch());
    if (!patch) return reply.status(503).send({ error: 'no_current_patch' });

    reply.header('cache-control', 'no-store');
    return analyzeBoard(context, patch, parsed.data);
  });

  // ── Save and load (R6.3) ─────────────────────────────────────────────────

  app.post('/v1/builder/comps', async (request, reply) => {
    const parsed = BoardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }

    const patch = parsed.data.patch ?? (await context.comps.currentPatch());
    if (!patch) return reply.status(503).send({ error: 'no_current_patch' });

    const saved = await context.builder.save({
      puuid: await optionalPuuid(request),
      patch,
      name: parsed.data.name,
      units: parsed.data.units,
      level: parsed.data.level,
    });

    reply.header('cache-control', 'no-store');
    return reply.status(201).send({
      ...saved,
      // The client should not have to know how to construct this.
      shareUrl: `${context.config.webBaseUrl}/builder/${saved.id}`,
    });
  });

  app.get<{ Params: { id: string } }>('/v1/builder/comps/:id', async (request, reply) => {
    const saved = await context.builder.findById(request.params.id);
    if (!saved) {
      return reply.status(404).send({
        error: 'board_not_found',
        detail: 'That share link does not point at a saved board.',
      });
    }

    const analysis = await analyzeBoard(context, saved.patch, saved);

    // A shared board is immutable content at a stable URL, so it caches — but
    // the live stats attached to it are not, hence the short window.
    reply.header('cache-control', 'public, max-age=60');
    return { board: saved, ...analysis };
  });

  app.get('/v1/builder/comps', async (request, reply) => {
    const puuid = await optionalPuuid(request);
    if (!puuid) return reply.status(401).send({ error: 'unauthenticated' });

    reply.header('cache-control', 'no-store');
    return { boards: await context.builder.listForPlayer(puuid) };
  });

  app.put<{ Params: { id: string } }>('/v1/builder/comps/:id', async (request, reply) => {
    const puuid = await optionalPuuid(request);
    if (!puuid) return reply.status(401).send({ error: 'unauthenticated' });

    const parsed = BoardSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const updated = await context.builder.update(request.params.id, puuid, {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.units !== undefined ? { units: parsed.data.units } : {}),
      ...(parsed.data.level !== undefined ? { level: parsed.data.level } : {}),
    });

    // 404 rather than 403 for a board owned by someone else: confirming a
    // board exists but is not yours leaks that the id is real.
    if (!updated) return reply.status(404).send({ error: 'board_not_found' });

    reply.header('cache-control', 'no-store');
    return updated;
  });

  // ── Itemization optimizer (R16) ──────────────────────────────────────────

  app.post('/v1/items/optimize', async (request, reply) => {
    const parsed = OptimizeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }

    const patch = parsed.data.patch ?? (await context.comps.currentPatch());
    if (!patch) return reply.status(503).send({ error: 'no_current_patch' });

    const gameData = await context.gameData.forPatch(patch);

    // Item priorities come from the comp's own guide when one is supplied, so
    // the optimizer inherits editorial judgement rather than inventing its own.
    const comp = parsed.data.compId
      ? await context.comps.findById(parsed.data.compId, patch)
      : null;

    const units: OptimizerUnit[] = parsed.data.boardUnits.map((championId) => {
      const fromComp = comp?.units.find((unit) => unit.championId === championId);
      return {
        championId,
        name: gameData.championNames.get(championId) ?? championId,
        role: fromComp?.role ?? 'support',
        wants: fromComp?.items ?? [],
      };
    });

    const result = optimizeItems({
      heldItems: parsed.data.heldItems,
      units,
      recipes: gameData.recipes,
    });

    // R16.3 — this is a builder/post-game tool. Never cached against a player,
    // and it took no live bench input to produce.
    reply.header('cache-control', 'no-store');
    return result;
  });
}

/**
 * Traits, estimate, and comp match for a board.
 *
 * Shared by the analyze and load routes so a saved board and a live edit can
 * never disagree about what the same units mean.
 */
async function analyzeBoard(
  context: AppContext,
  patch: string,
  board: { units: { championId: string; starLevel?: number; itemIds?: string[] }[]; level: number },
) {
  const gameData = await context.gameData.forPatch(patch);

  const resolved = resolveTraits(
    board.units.map((unit) => ({
      championId: unit.championId,
      ...(unit.itemIds ? { itemIds: unit.itemIds } : {}),
    })),
    {
      traitsByChampion: gameData.traitsByChampion,
      traits: gameData.traits,
      emblemGrants: gameData.emblemGrants,
    },
  );

  const estimateUnits: EstimateUnit[] = board.units.map((unit) => ({
    championId: unit.championId,
    cost: (gameData.costs.get(unit.championId) ?? 1) as EstimateUnit['cost'],
    starLevel: (unit.starLevel ?? 1) as EstimateUnit['starLevel'],
    role: gameData.roles.get(unit.championId) ?? 'support',
    completedItems: unit.itemIds?.length ?? 0,
  }));

  // R6.4 — reuse the ingestion path's detection so a builder board is matched
  // exactly the way a real match is, rather than by a parallel implementation.
  const signatures = await context.comps.listSignatures(patch);
  const match = detectComp(
    {
      traitCounts: toTraitCounts(resolved),
      championIds: board.units.map((unit) => unit.championId),
      ...(board.units.some((unit) => unit.starLevel)
        ? {
            starLevels: Object.fromEntries(
              board.units.map((unit) => [unit.championId, unit.starLevel ?? 1]),
            ),
          }
        : {}),
    },
    signatures,
  );

  const matchedComp = match ? await context.comps.findById(match.compId, patch) : null;

  return {
    patch,
    traits: resolved,
    estimate: estimateBoard({
      units: estimateUnits,
      activeBreakpoints: activeTraits(resolved).map((trait) => trait.activeBreakpoint!),
      level: board.level,
    }),
    matchedComp: matchedComp
      ? {
          compId: matchedComp.id,
          name: matchedComp.name,
          matchScore: match!.score,
        }
      : null,
  };
}
