/**
 * Patch history, notification preference and bookmark endpoint tests
 * (task 6.9).
 *
 * _Requirements: 7.4, 8.2, 8.3, 8.4, 9.1, 9.3, 9.4_
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { authHeaderFor, buildTestContext } from '../test-context.js';

let app: FastifyInstance | undefined;

const SESSION = { puuid: 'puuid-1', sessionId: 'sid-1' };

const start = async (options: Parameters<typeof buildTestContext>[0] = {}) => {
  const { context } = buildTestContext({ session: SESSION, ...options });
  app = await buildApp({ context });
  return { app, context, headers: authHeaderFor(context, SESSION) };
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (result: { json: () => unknown }): any => result.json();

describe('Patch routes are public (_Requirements: 7.4_)', () => {
  it('serves the patch list, snapshots and meta shifts without a session', async () => {
    const { app } = await start();

    for (const url of [
      '/v1/patches',
      '/v1/patches/latest',
      '/v1/patches/17.9/snapshots',
      '/v1/patches/17.9/meta-shifts',
    ]) {
      expect((await app.inject({ url })).statusCode, url).toBe(200);
    }
  });
});

describe('GET /v1/patches/latest (_Requirements: 8.2_)', () => {
  it('reports an unapproved summary as awaiting review, not as empty', async () => {
    // R8.2 keeps metaImpactSummary null until a human signs off. Saying so
    // explicitly beats an empty string the client has to interpret.
    const { app } = await start({ metaImpactSummary: null });
    const body = json(await app.inject({ url: '/v1/patches/latest' }));

    expect(body.metaImpactSummary).toBeNull();
    expect(body.metaImpactSummaryStatus).toBe('awaiting-review');
  });

  it('reports an approved summary as published', async () => {
    const { app } = await start({ metaImpactSummary: 'Vanguard got worse.' });
    const body = json(await app.inject({ url: '/v1/patches/latest' }));

    expect(body.metaImpactSummary).toBe('Vanguard got worse.');
    expect(body.metaImpactSummaryStatus).toBe('published');
  });
});

describe('Snapshot history (_Requirements: 8.3, 8.4_)', () => {
  it('lists archived snapshots newest first', async () => {
    const { app } = await start();
    const body = json(await app.inject({ url: '/v1/patches/17.9/snapshots' }));

    expect(body.snapshots).toHaveLength(2);
    expect(body.snapshots[0]!.version).toBe('v1');
  });

  it('diffs a snapshot against the one immediately before it', async () => {
    // R8.3's "consecutive" — comparing against an arbitrary earlier snapshot
    // would report movement that never happened in a single step.
    const { app } = await start();
    const body = json(await app.inject({ url: '/v1/patches/17.9/snapshots/v2' }));

    expect(body.comparedTo).toBe('v1');
    expect(body.diff.changed).toHaveLength(1);
    expect(body.diff.changed[0]!.from).toBe('C');
    expect(body.diff.changed[0]!.to).toBe('S');
    expect(body.diff.metaShifts).toHaveLength(1);
  });

  it('returns a null diff for the first snapshot rather than an empty one', async () => {
    // "This is the first snapshot" and "nothing changed" are different facts.
    const { app } = await start();
    const body = json(await app.inject({ url: '/v1/patches/17.9/snapshots/v1' }));

    expect(body.diff).toBeNull();
    expect(body.comparedTo).toBeNull();
  });

  it('404s an unknown snapshot version', async () => {
    const { app } = await start();
    expect((await app.inject({ url: '/v1/patches/17.9/snapshots/nope' })).statusCode).toBe(404);
  });

  it('lists recorded meta shifts', async () => {
    const { app } = await start();
    const body = json(await app.inject({ url: '/v1/patches/17.9/meta-shifts' }));

    expect(body.shifts).toHaveLength(1);
    expect(body.shifts[0]!.compId).toBe('vanguard-zoe');
  });
});

describe('Notification preferences (_Requirements: 9.1, 9.3, 9.4_)', () => {
  it('requires a session', async () => {
    const { app } = await start();
    expect((await app.inject({ url: '/v1/notifications/prefs' })).statusCode).toBe(401);
  });

  it('reports fullyUnsubscribed so a settings screen can say so plainly', async () => {
    const { app, headers } = await start({
      prefs: [{ channel: 'email', category: 'patch', enabled: false }],
    });
    const body = json(await app.inject({ url: '/v1/notifications/prefs', headers }));

    expect(body.fullyUnsubscribed).toBe(true);
  });

  it('reports not-fully-unsubscribed when at least one channel is on', async () => {
    const { app, headers } = await start({
      prefs: [{ channel: 'email', category: 'patch', enabled: true }],
    });
    expect(
      json(await app.inject({ url: '/v1/notifications/prefs', headers })).fullyUnsubscribed,
    ).toBe(false);
  });

  it('replaces preferences wholesale', async () => {
    // A full replace, not a merge: the settings screen sends the complete
    // state it is showing, and a partial upsert would leave a channel enabled
    // that the user just switched off but which was omitted from the payload.
    const { app, headers, context } = await start();
    const payload = {
      prefs: [
        { channel: 'email', category: 'patch', enabled: true },
        { channel: 'webpush', category: 'bookmarkedComp', enabled: false },
      ],
    };

    const result = await app.inject({
      method: 'PUT',
      url: '/v1/notifications/prefs',
      headers,
      payload,
    });

    expect(result.statusCode).toBe(200);
    expect(context.notifications.replacePrefs).toHaveBeenCalledWith('puuid-1', payload.prefs);
  });

  it('rejects an unknown channel rather than storing it', async () => {
    const { app, headers } = await start();
    const result = await app.inject({
      method: 'PUT',
      url: '/v1/notifications/prefs',
      headers,
      payload: { prefs: [{ channel: 'carrier-pigeon', category: 'patch', enabled: true }] },
    });
    expect(result.statusCode).toBe(400);
  });

  it('unsubscribes a category in one action (R9.4)', async () => {
    // This is the endpoint an unsubscribe link in an email hits, and that link
    // cannot know the user's other settings.
    const { app, headers, context } = await start();
    const result = await app.inject({
      method: 'DELETE',
      url: '/v1/notifications/prefs/bookmarkedComp',
      headers,
    });

    expect(result.statusCode).toBe(200);
    expect(context.notifications.unsubscribeCategory).toHaveBeenCalledWith(
      'puuid-1',
      'bookmarkedComp',
    );
  });

  it('rejects an unknown category on unsubscribe', async () => {
    const { app, headers } = await start();
    const result = await app.inject({
      method: 'DELETE',
      url: '/v1/notifications/prefs/everything',
      headers,
    });
    expect(result.statusCode).toBe(400);
  });
});

describe('Bookmarks (_Requirements: 9.1_)', () => {
  it('requires a session', async () => {
    const { app } = await start();
    expect((await app.inject({ url: '/v1/bookmarks' })).statusCode).toBe(401);
  });

  it('round-trips a bookmark', async () => {
    const { app, headers } = await start();

    const created = await app.inject({
      method: 'POST',
      url: '/v1/bookmarks',
      headers,
      payload: { kind: 'comp', targetId: 'vanguard-zoe' },
    });
    expect(created.statusCode).toBe(201);

    const listed = json(await app.inject({ url: '/v1/bookmarks', headers }));
    expect(listed.bookmarks).toEqual([{ kind: 'comp', targetId: 'vanguard-zoe' }]);
  });

  it('is idempotent — bookmarking twice stores one', async () => {
    const { app, headers } = await start();
    const payload = { kind: 'comp', targetId: 'vanguard-zoe' };

    await app.inject({ method: 'POST', url: '/v1/bookmarks', headers, payload });
    await app.inject({ method: 'POST', url: '/v1/bookmarks', headers, payload });

    expect(json(await app.inject({ url: '/v1/bookmarks', headers })).bookmarks).toHaveLength(1);
  });

  it('removes a bookmark', async () => {
    const { app, headers } = await start();
    const payload = { kind: 'comp', targetId: 'vanguard-zoe' };

    await app.inject({ method: 'POST', url: '/v1/bookmarks', headers, payload });
    const removed = await app.inject({ method: 'DELETE', url: '/v1/bookmarks', headers, payload });

    expect(json(removed).removed).toBe(true);
    expect(json(await app.inject({ url: '/v1/bookmarks', headers })).bookmarks).toEqual([]);
  });

  it('returns 200 when removing a bookmark that is already gone', async () => {
    // The state the caller asked for, not an error.
    const { app, headers } = await start();
    const result = await app.inject({
      method: 'DELETE',
      url: '/v1/bookmarks',
      headers,
      payload: { kind: 'comp', targetId: 'never-bookmarked' },
    });

    expect(result.statusCode).toBe(200);
    expect(json(result).removed).toBe(false);
  });

  it('rejects an unknown bookmark kind', async () => {
    const { app, headers } = await start();
    const result = await app.inject({
      method: 'POST',
      url: '/v1/bookmarks',
      headers,
      payload: { kind: 'augment', targetId: 'x' },
    });
    expect(result.statusCode).toBe(400);
  });
});
