/**
 * Patch history and notification preferences (tasks 6.4, 6.5).
 *
 * `GET /v1/patches`                    patch list (public)
 * `GET /v1/patches/latest`             latest patch + approved summary
 * `GET /v1/patches/:id/snapshots`      browsable tier-list history (R8.4)
 * `GET /v1/patches/:id/meta-shifts`    comps that moved more than a tier
 * `GET|PUT /v1/notifications/prefs`    subscription management (R9.1, R9.4)
 * `GET|POST|DELETE /v1/bookmarks`      what to be told about
 *
 * Patch routes are public — R7.4 keeps the product useful logged out, and
 * patch history is exactly the kind of thing someone reads before deciding
 * whether to make an account.
 *
 * _Requirements: 7.4, 8.1, 8.2, 8.3, 8.4, 9.1, 9.3, 9.4_
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { diffSnapshots } from '../../domain/snapshot-diff.js';
import type { AppContext } from '../context.js';
import { cachedRead } from '../cache.js';
import { makeRequireSession } from '../require-session.js';

const PrefsSchema = z.object({
  prefs: z
    .array(
      z.object({
        channel: z.enum(['email', 'webpush', 'overwolf-native']),
        category: z.enum(['patch', 'bookmarkedComp', 'bookmarkedChampion']),
        enabled: z.boolean(),
      }),
    )
    .max(30),
});

const BookmarkSchema = z.object({
  kind: z.enum(['comp', 'champion']),
  targetId: z.string().min(1).max(120),
});

export async function registerPatchRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const requireSession = makeRequireSession(context);

  // ── Patch history (R8.4) ─────────────────────────────────────────────────

  app.get('/v1/patches', async (_request, reply) => {
    const { value, hit } = await cachedRead(
      {
        cache: context.cache,
        route: 'patches.list',
        fingerprint: 'all',
        // Patch metadata changes when a patch ships, not on the meta refresh.
        ttlSeconds: 60 * 30,
        logger: context.log,
      },
      async () => ({ patches: await context.patches.list() }),
    );

    reply.header('x-cache', hit ? 'hit' : 'miss');
    reply.header('cache-control', 'public, max-age=300');
    return value;
  });

  app.get('/v1/patches/latest', async (_request, reply) => {
    const patch = await context.patches.latest();
    if (!patch) return reply.status(503).send({ error: 'no_patches' });

    reply.header('cache-control', 'public, max-age=300');
    return {
      ...patch,
      // R8.2 — null until a human approves the draft. Saying so explicitly
      // beats an empty string the client has to guess the meaning of.
      metaImpactSummaryStatus: patch.metaImpactSummary ? 'published' : 'awaiting-review',
    };
  });

  app.get<{ Params: { id: string } }>('/v1/patches/:id/snapshots', async (request, reply) => {
    const snapshots = await context.patches.listSnapshots(request.params.id);

    reply.header('cache-control', 'public, max-age=120');
    return { patch: request.params.id, snapshots };
  });

  /**
   * A single archived snapshot, optionally diffed against its predecessor.
   *
   * The diff is computed against the snapshot *immediately prior*, which is
   * what R8.3 means by "consecutive" — comparing against an arbitrary earlier
   * one would report movement that never happened in one step.
   */
  app.get<{ Params: { id: string; version: string } }>(
    '/v1/patches/:id/snapshots/:version',
    async (request, reply) => {
      const snapshot = await context.patches.findSnapshot(
        request.params.id,
        request.params.version,
      );
      if (!snapshot) return reply.status(404).send({ error: 'snapshot_not_found' });

      const previous = await context.patches.previousSnapshot(
        request.params.id,
        request.params.version,
      );

      reply.header('cache-control', 'public, max-age=300');
      return {
        snapshot,
        // null rather than an empty diff when there is no predecessor: "this
        // is the first snapshot" and "nothing changed" are different facts.
        diff: previous ? diffSnapshots(previous.entries, snapshot.entries) : null,
        comparedTo: previous?.version ?? null,
      };
    },
  );

  app.get<{ Params: { id: string } }>('/v1/patches/:id/meta-shifts', async (request, reply) => {
    reply.header('cache-control', 'public, max-age=120');
    return {
      patch: request.params.id,
      shifts: await context.patches.recentMetaShifts(request.params.id),
    };
  });

  // ── Notification preferences (R9.1, R9.3, R9.4) ──────────────────────────

  app.get('/v1/notifications/prefs', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const prefs = await context.notifications.prefsFor(request.puuid!);

    reply.header('cache-control', 'no-store');
    return {
      prefs,
      // Surfaced explicitly so a settings screen can say "you will receive
      // nothing" rather than leaving the user to infer it from empty switches.
      fullyUnsubscribed: !prefs.some((pref) => pref.enabled),
    };
  });

  app.put('/v1/notifications/prefs', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const parsed = PrefsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }

    await context.notifications.replacePrefs(request.puuid!, parsed.data.prefs);

    reply.header('cache-control', 'no-store');
    return { prefs: parsed.data.prefs };
  });

  /**
   * R9.4 — unsubscribe from a category in one action.
   *
   * A dedicated route rather than making the client send a full preferences
   * payload: this is the endpoint an unsubscribe link in an email hits, and
   * that link cannot know the user's other settings.
   */
  app.delete<{ Params: { category: string } }>(
    '/v1/notifications/prefs/:category',
    async (request, reply) => {
      if (!(await requireSession(request, reply))) return reply;

      const category = z
        .enum(['patch', 'bookmarkedComp', 'bookmarkedChampion'])
        .safeParse(request.params.category);
      if (!category.success) return reply.status(400).send({ error: 'unknown_category' });

      const disabled = await context.notifications.unsubscribeCategory(
        request.puuid!,
        category.data,
      );

      reply.header('cache-control', 'no-store');
      return { category: category.data, disabled };
    },
  );

  // ── Bookmarks (R9.1) ─────────────────────────────────────────────────────

  app.get('/v1/bookmarks', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    reply.header('cache-control', 'no-store');
    return { bookmarks: await context.notifications.bookmarksFor(request.puuid!) };
  });

  app.post('/v1/bookmarks', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const parsed = BookmarkSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    await context.notifications.addBookmark(request.puuid!, parsed.data);

    reply.header('cache-control', 'no-store');
    return reply.status(201).send(parsed.data);
  });

  app.delete('/v1/bookmarks', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const parsed = BookmarkSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const removed = await context.notifications.removeBookmark(request.puuid!, parsed.data);

    reply.header('cache-control', 'no-store');
    // 200 either way — removing a bookmark that is already gone is the state
    // the caller asked for, not an error.
    return { removed };
  });
}
