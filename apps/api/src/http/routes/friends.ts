/**
 * Opt-in friends and the comparison leaderboard (task 6.8).
 *
 * `GET    /v1/friends`                  opt-in state, friends, pending requests
 * `PUT    /v1/friends/opt-in`           join or leave the feature entirely
 * `POST   /v1/friends/requests`         send a request by Riot ID
 * `POST   /v1/friends/requests/accept`  accept one
 * `DELETE /v1/friends`                  decline, cancel, or unfriend
 * `GET    /v1/friends/leaderboard`      aggregate comparison
 *
 * This is the only part of the product where one player sees another's data,
 * so every route here checks the viewer's own opt-in first. Being opted out is
 * not merely "no friends shown" — it is a 403 on the whole surface, because a
 * player who has not joined should not be able to act inside it at all.
 *
 * **No response here carries another player's PUUID.** It is Riot's permanent,
 * cross-service identifier, and a client has no need of it: the Riot ID is
 * already on screen and works perfectly well as the key for accepting and
 * unfriending. Everything internal stays keyed by PUUID; only the wire format
 * is narrowed.
 *
 * _Requirements: 4.6, 4.7, 7.1, 7.4_
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { buildLeaderboard, describeStanding } from '../../domain/leaderboard.js';
import type { AppContext } from '../context.js';
import { makeRequireSession } from '../require-session.js';

/**
 * Every route here names the other player by Riot ID — see the note above.
 *
 * "Name#TAG": loose on the parts, strict on the shape. Riot's own rules for
 * what a name may contain are looser than most guesses at them, so validating
 * beyond the separator would reject real players.
 */
const TargetSchema = z.object({ riotId: z.string().min(3).max(50).includes('#') });

export async function registerFriendRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const requireSession = makeRequireSession(context);

  /** Session + opt-in. Returns the puuid, or null once it has replied. */
  const requireParticipant = async (
    request: Parameters<typeof requireSession>[0],
    reply: Parameters<typeof requireSession>[1],
  ): Promise<string | null> => {
    if (!(await requireSession(request, reply))) return null;

    if (!(await context.friends.optInStatus(request.puuid!))) {
      await reply.status(403).send({
        error: 'friends_not_enabled',
        detail: 'Turn on friends before using this.',
      });
      return null;
    }

    return request.puuid!;
  };

  app.get('/v1/friends', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const optedIn = await context.friends.optInStatus(request.puuid!);

    reply.header('cache-control', 'no-store');

    // Readable while opted out, unlike the rest: someone has to be able to
    // see that the feature is off before they can decide to turn it on.
    if (!optedIn) return { optedIn: false, friends: [], pending: [] };

    const [stats, pending] = await Promise.all([
      context.friends.leaderboardFor(request.puuid!),
      context.friends.pendingFor(request.puuid!),
    ]);

    return {
      optedIn: true,
      friends: stats
        .filter((entry) => entry.puuid !== request.puuid)
        .map((entry) => ({ riotId: entry.riotId })),
      // Pending entries are narrowed the same way.
      pending: pending.map((entry) => ({
        riotId: entry.riotId,
        direction: entry.direction,
        createdAt: entry.createdAt,
      })),
    };
  });

  /**
   * Joins or leaves the feature.
   *
   * Leaving deletes every relationship rather than hiding them — see
   * `setOptIn`. Rejoining later starts from nothing, which is the only
   * behaviour that keeps the other person's consent meaningful.
   */
  app.put('/v1/friends/opt-in', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const parsed = z.object({ optIn: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    await context.friends.setOptIn(request.puuid!, parsed.data.optIn);

    reply.header('cache-control', 'no-store');
    return { optedIn: parsed.data.optIn };
  });

  app.post('/v1/friends/requests', async (request, reply) => {
    const puuid = await requireParticipant(request, reply);
    if (!puuid) return reply;

    const parsed = TargetSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_riot_id' });

    const target = await context.friends.findByRiotId(parsed.data.riotId);

    if (!target) {
      // Deliberately the same answer whether they have no account or have not
      // opted in. Distinguishing the two would leak exactly what the opt-in
      // exists to protect.
      return reply.status(404).send({
        error: 'not_found',
        detail: 'No player with that Riot ID has friends turned on.',
      });
    }

    if (target.puuid === puuid) {
      return reply.status(400).send({ error: 'cannot_friend_yourself' });
    }

    const outcome = await context.friends.request(puuid, target.puuid);

    reply.header('cache-control', 'no-store');
    return { riotId: target.riotId, outcome };
  });

  app.post('/v1/friends/requests/accept', async (request, reply) => {
    const puuid = await requireParticipant(request, reply);
    if (!puuid) return reply;

    const parsed = TargetSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const target = await context.friends.findByRiotId(parsed.data.riotId);
    if (!target) return reply.status(404).send({ error: 'no_pending_request' });

    const accepted = await context.friends.accept(puuid, target.puuid);
    if (!accepted) return reply.status(404).send({ error: 'no_pending_request' });

    reply.header('cache-control', 'no-store');
    return { accepted: true };
  });

  /** Decline, cancel or unfriend — one operation, so no record of who declined whom. */
  app.delete('/v1/friends', async (request, reply) => {
    const puuid = await requireParticipant(request, reply);
    if (!puuid) return reply;

    const parsed = TargetSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const target = await context.friends.findByRiotId(parsed.data.riotId);
    // Nothing to remove and nothing to report — the same answer either way, so
    // this cannot be used to probe who has the feature on.
    if (!target) return { removed: false };

    const removed = await context.friends.remove(puuid, target.puuid);

    reply.header('cache-control', 'no-store');
    return { removed };
  });

  app.get('/v1/friends/leaderboard', async (request, reply) => {
    const puuid = await requireParticipant(request, reply);
    if (!puuid) return reply;

    const rows = buildLeaderboard(await context.friends.leaderboardFor(puuid), {
      viewerPuuid: puuid,
    });

    reply.header('cache-control', 'no-store');
    return {
      // `isYou` already tells the client which row is theirs, so the puuid it
      // would otherwise need for that comparison is dropped on the way out.
      rows: rows.map(({ puuid: _puuid, ...row }) => row),
      standing: describeStanding(rows),
    };
  });
}
