/**
 * Personal analytics endpoints (tasks 3.6, 3.8, 3.10, 3.15).
 *
 * Every route here requires a session and serves only the caller's own data —
 * `request.puuid` comes from the verified token, never from a parameter. There
 * is deliberately no `/v1/players/:puuid` route: an id in the path is an
 * invitation to forget the ownership check, and R4.6 forbids surfacing data
 * about other players regardless.
 *
 * _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 7.3, 12.4, 15.1, 15.3, 15.4_
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { buildNarrative, reviewMatch } from '../../domain/coaching.js';
import { averageCurves } from '../../domain/curves.js';
import type { AppContext } from '../context.js';
import { makeRequireSession } from '../require-session.js';

const AnalyticsQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export async function registerPlayerRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const requireSession = makeRequireSession(context);

  // ── Profile ──────────────────────────────────────────────────────────────

  app.get('/v1/players/me', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const profile = await context.players.findProfile(request.puuid!);
    if (!profile) return reply.status(404).send({ error: 'profile_not_found' });

    reply.header('cache-control', 'no-store');
    return profile;
  });

  /**
   * Unlink (R7.3).
   *
   * Marks for deletion and revokes every session immediately, then the purge
   * job hard-deletes inside 30 days. Serving stops now rather than in 30 days —
   * the window exists for auditability and accidental-unlink recovery, not to
   * keep serving data the user asked us to forget.
   */
  app.delete('/v1/players/me', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    await context.players.requestDeletion(request.puuid!);
    await context.auth.deleteSessionsFor(request.puuid!);
    void reply.clearCookie('tftc_session', { path: '/' });

    context.log(`profile deletion requested for ${request.puuid!.slice(0, 8)}…`);

    return reply.status(202).send({
      status: 'deletion_requested',
      detail:
        'Your profile and derived analytics are no longer served and will be permanently ' +
        'deleted within 30 days.',
    });
  });

  /** R15.4 — opt out of AI narrative text in favour of the raw stat view. */
  app.put<{ Body: { coachingNarrativeOptOut?: unknown } }>(
    '/v1/players/me/preferences',
    async (request, reply) => {
      if (!(await requireSession(request, reply))) return reply;

      const optOut = request.body?.coachingNarrativeOptOut;
      if (typeof optOut !== 'boolean') {
        return reply.status(400).send({ error: 'invalid_request' });
      }

      await context.players.setCoachingOptOut(request.puuid!, optOut);
      return { coachingNarrativeOptOut: optOut };
    },
  );

  // ── Matches ──────────────────────────────────────────────────────────────

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/v1/players/me/matches',
    async (request, reply) => {
      if (!(await requireSession(request, reply))) return reply;

      const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 20) || 20));
      const offset = Math.max(0, Number(request.query.offset ?? 0) || 0);

      reply.header('cache-control', 'no-store');
      return {
        matches: await context.players.listMatches(request.puuid!, { limit, offset }),
        limit,
        offset,
      };
    },
  );

  /**
   * Single match review (R4.3).
   *
   * Compares the player's curves against the averaged curves of top-4
   * finishers on the same comp. `curveSource` is echoed so the client can say
   * "final state only" rather than implying a full per-round trace — see
   * `match-extraction.ts` for why Riot's API cannot give us more.
   */
  app.get<{ Params: { matchId: string } }>(
    '/v1/players/me/matches/:matchId',
    async (request, reply) => {
      if (!(await requireSession(request, reply))) return reply;

      const match = await context.players.findMatch(request.puuid!, request.params.matchId);
      if (!match) return reply.status(404).send({ error: 'match_not_found' });

      const baseline = await buildBaseline(context, match.detectedCompId, match.patch);
      const review = reviewMatch({
        placement: match.placement,
        compName: baseline.compName,
        levelCurve: match.levelCurve,
        goldCurve: match.goldCurve,
        baselineLevelCurve: baseline.levelCurve,
        baselineGoldCurve: baseline.goldCurve,
      });

      reply.header('cache-control', 'no-store');
      return {
        match,
        baseline: {
          compId: match.detectedCompId,
          compName: baseline.compName,
          levelCurve: baseline.levelCurve,
          goldCurve: baseline.goldCurve,
          sampleSize: baseline.sampleSize,
        },
        levelDeviations: review.levelDeviations,
        goldDeviations: review.goldDeviations,
        suggestions: review.suggestions,
        keyDeviationRound: review.keyDeviationRound,
        // Riot exposes no TFT match timeline; this says so honestly rather
        // than letting the client draw a line through one point.
        curveSource: 'final-state',
      };
    },
  );

  /**
   * Post-game coaching narrative (task 3.15, R15).
   *
   * Generated strictly after the match — it reads a stored `player_matches`
   * row, which by definition only exists once the game has ended and been
   * synced. There is no code path here that could run mid-match (R15.3).
   */
  app.get<{ Params: { matchId: string } }>(
    '/v1/matches/:matchId/coaching',
    async (request, reply) => {
      if (!(await requireSession(request, reply))) return reply;

      const profile = await context.players.findProfile(request.puuid!);
      if (profile?.coachingNarrativeOptOut) {
        // R15.4 — honour the opt-out at the API, not just in the UI. A client
        // that ignored the preference would otherwise still get the text.
        return reply.status(409).send({
          error: 'coaching_opted_out',
          detail: 'This account prefers the raw stat view. Change it in preferences.',
        });
      }

      const cached = await context.players.findCoaching(request.puuid!, request.params.matchId);
      if (cached) {
        reply.header('cache-control', 'no-store');
        return { matchId: request.params.matchId, ...cached };
      }

      const match = await context.players.findMatch(request.puuid!, request.params.matchId);
      if (!match) return reply.status(404).send({ error: 'match_not_found' });

      const baseline = await buildBaseline(context, match.detectedCompId, match.patch);
      const input = {
        placement: match.placement,
        compName: baseline.compName,
        levelCurve: match.levelCurve,
        goldCurve: match.goldCurve,
        baselineLevelCurve: baseline.levelCurve,
        baselineGoldCurve: baseline.goldCurve,
      };

      const review = reviewMatch(input);
      const narrative = buildNarrative(input, review);

      await context.players.saveCoaching({
        matchId: match.matchId,
        puuid: request.puuid!,
        narrative,
        keyDeviationRound: review.keyDeviationRound,
        suggestions: review.suggestions,
      });

      reply.header('cache-control', 'no-store');
      return {
        matchId: match.matchId,
        narrative,
        keyDeviationRound: review.keyDeviationRound,
        suggestions: review.suggestions,
        generatedAt: new Date().toISOString(),
      };
    },
  );

  // ── Aggregate analytics (R4.4) ───────────────────────────────────────────

  app.get('/v1/players/me/analytics', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const parsed = AnalyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_query' });

    const analytics = await context.players.analytics(request.puuid!, {
      ...(parsed.data.from ? { from: new Date(parsed.data.from) } : {}),
      ...(parsed.data.to ? { to: new Date(parsed.data.to) } : {}),
    });

    // Comp names come from the registry so the dashboard shows "Vanguard Zoe"
    // rather than a slug.
    const patch = await context.comps.currentPatch();
    const names = new Map(
      patch ? (await context.comps.listMetadata(patch)).map((comp) => [comp.id, comp.name]) : [],
    );

    reply.header('cache-control', 'no-store');
    return {
      totalGames: analytics.totalGames,
      overallAvgPlacement: analytics.overallAvgPlacement,
      byComp: analytics.byComp.map((entry) => ({
        ...entry,
        compName: entry.compId ? (names.get(entry.compId) ?? entry.compId) : null,
      })),
    };
  });
}

/**
 * Builds the top-4 baseline for a comp.
 *
 * Sourced from the aggregation pipeline's own view of the comp rather than by
 * re-fetching matches: R4.6 keeps other participants' data in memory only, and
 * the pipeline has already reduced it to an average nobody's identity is
 * attached to.
 */
async function buildBaseline(
  context: AppContext,
  compId: string | null,
  patch: string,
): Promise<{
  compName: string | null;
  levelCurve: { round: string; value: number }[];
  goldCurve: { round: string; value: number }[];
  sampleSize: number;
}> {
  if (!compId) {
    return { compName: null, levelCurve: [], goldCurve: [], sampleSize: 0 };
  }

  const metadata = await context.comps.findById(compId, patch);
  const stored = await context.players.baselineFor(compId, patch);

  return {
    compName: metadata?.name ?? compId,
    levelCurve: averageCurves(stored.levelCurves),
    goldCurve: averageCurves(stored.goldCurves),
    sampleSize: stored.sampleSize,
  };
}
