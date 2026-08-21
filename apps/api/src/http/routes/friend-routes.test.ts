/**
 * Friends and leaderboard route tests (task 6.8).
 *
 * _Requirements: 4.6, 4.7, 7.1_
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

const IN = { friendsOptIn: true };

describe('Opting in (_Requirements: 4.6, 7.1_)', () => {
  it('requires a session everywhere', async () => {
    const { app } = await start();

    for (const url of ['/v1/friends', '/v1/friends/leaderboard']) {
      expect((await app.inject({ url })).statusCode, url).toBe(401);
    }
  });

  it('reports the feature as off without erroring, so it can be turned on', async () => {
    const { app, headers } = await start();
    const body = json(await app.inject({ url: '/v1/friends', headers }));

    expect(body.optedIn).toBe(false);
    expect(body.friends).toEqual([]);
  });

  it('403s every acting route while opted out', async () => {
    // Opted out is not "no friends shown" — a player who has not joined should
    // not be able to act inside the feature at all.
    const { app, headers } = await start();

    const routes: [string, string, unknown][] = [
      ['POST', '/v1/friends/requests', { riotId: 'Friend#EUW' }],
      ['POST', '/v1/friends/requests/accept', { riotId: 'Friend#EUW' }],
      ['DELETE', '/v1/friends', { riotId: 'Friend#EUW' }],
      ['GET', '/v1/friends/leaderboard', undefined],
    ];

    for (const [method, url, payload] of routes) {
      const result = await app.inject({
        method: method as 'GET',
        url,
        headers,
        ...(payload ? { payload } : {}),
      });
      expect(result.statusCode, url).toBe(403);
      expect(json(result).error).toBe('friends_not_enabled');
    }
  });

  it('deletes every relationship on opting out', async () => {
    // Leaving them dormant would mean rejoining silently restores access the
    // other person has not re-consented to.
    const { app, headers, context } = await start(IN);

    const result = await app.inject({
      method: 'PUT',
      url: '/v1/friends/opt-in',
      headers,
      payload: { optIn: false },
    });

    expect(result.statusCode).toBe(200);
    expect(context.friends.setOptIn).toHaveBeenCalledWith('puuid-1', false);
  });
});

describe('Finding people (_Requirements: 4.6_)', () => {
  it('sends a request by Riot ID', async () => {
    const { app, headers, context } = await start(IN);

    const result = await app.inject({
      method: 'POST',
      url: '/v1/friends/requests',
      headers,
      payload: { riotId: 'Friend#EUW' },
    });

    expect(result.statusCode).toBe(200);
    expect(context.friends.request).toHaveBeenCalledWith('puuid-1', 'puuid-2');
  });

  it('gives the same answer for "no account" and "not opted in"', async () => {
    // Distinguishing them would leak exactly what the opt-in protects: whether
    // a given Riot ID uses TFT Codex at all.
    const { app, headers } = await start(IN);

    const result = await app.inject({
      method: 'POST',
      url: '/v1/friends/requests',
      headers,
      payload: { riotId: 'Stranger#EUW' },
    });

    expect(result.statusCode).toBe(404);
    expect(json(result).detail).toBe('No player with that Riot ID has friends turned on.');
  });

  it('rejects a malformed Riot ID', async () => {
    const { app, headers } = await start(IN);
    const result = await app.inject({
      method: 'POST',
      url: '/v1/friends/requests',
      headers,
      payload: { riotId: 'no-tag-here' },
    });
    expect(result.statusCode).toBe(400);
  });

  it('refuses a self-request', async () => {
    const { app, headers, context } = await start(IN);
    (
      context.friends.findByRiotId as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({ puuid: 'puuid-1', riotId: 'Me#EUW' });

    const result = await app.inject({
      method: 'POST',
      url: '/v1/friends/requests',
      headers,
      payload: { riotId: 'Me#EUW' },
    });

    expect(result.statusCode).toBe(400);
    expect(json(result).error).toBe('cannot_friend_yourself');
  });
});

describe('Responding to requests (_Requirements: 4.6_)', () => {
  it('accepts a pending request', async () => {
    const { app, headers } = await start(IN);

    const result = await app.inject({
      method: 'POST',
      url: '/v1/friends/requests/accept',
      headers,
      payload: { riotId: 'Friend#EUW' },
    });

    expect(result.statusCode).toBe(200);
    expect(json(result).accepted).toBe(true);
  });

  it('404s accepting something that was never sent', async () => {
    const { app, headers } = await start(IN);

    const result = await app.inject({
      method: 'POST',
      url: '/v1/friends/requests/accept',
      headers,
      payload: { riotId: 'Nobody#EUW' },
    });

    expect(result.statusCode).toBe(404);
  });

  it('uses one route for declining, cancelling and unfriending', async () => {
    // Same operation on purpose: a declined request is deleted rather than
    // recorded, so nothing keeps a note of who turned down whom.
    const { app, headers, context } = await start(IN);

    const result = await app.inject({
      method: 'DELETE',
      url: '/v1/friends',
      headers,
      payload: { riotId: 'Friend#EUW' },
    });

    expect(result.statusCode).toBe(200);
    expect(context.friends.remove).toHaveBeenCalledWith('puuid-1', 'puuid-2');
  });
});

describe('Leaderboard (_Requirements: 4.6, 4.7_)', () => {
  const STATS = [
    { puuid: 'puuid-1', riotId: 'Me#EUW', games: 100, avgPlacement: 4.3, top4Rate: 0.5 },
    { puuid: 'puuid-2', riotId: 'Friend#EUW', games: 100, avgPlacement: 3.8, top4Rate: 0.6 },
  ];

  it('ranks the circle and marks the viewer', async () => {
    const { app, headers } = await start({ ...IN, friendStats: STATS });
    const body = json(await app.inject({ url: '/v1/friends/leaderboard', headers }));

    expect(body.rows[0].riotId).toBe('Friend#EUW');
    expect(body.rows.find((row: { isYou: boolean }) => row.isYou).riotId).toBe('Me#EUW');
    expect(body.standing).toContain('better average placement');
  });

  it('sends no PUUID for anyone, including the viewer', async () => {
    // A PUUID is Riot's permanent cross-service identifier. The client has no
    // need of one — `isYou` and the Riot ID cover every operation.
    const { app, headers } = await start({ ...IN, friendStats: STATS });
    const body = json(await app.inject({ url: '/v1/friends/leaderboard', headers }));

    expect(JSON.stringify(body)).not.toContain('puuid');

    const list = json(await app.inject({ url: '/v1/friends', headers }));
    expect(JSON.stringify(list)).not.toContain('puuid');
  });

  it('exposes no per-match or augment data about a friend', async () => {
    // R4.7 gates augment-by-placement even for your own data; a friend's is
    // plainly out. Asserted on the serialized response, not just the type.
    const { app, headers } = await start({ ...IN, friendStats: STATS });
    const body = json(await app.inject({ url: '/v1/friends/leaderboard', headers }));

    expect(JSON.stringify(body)).not.toMatch(/augment|matchId|match_id|placements/i);
    expect(Object.keys(body.rows[0]).sort()).toEqual([
      'avgPlacement',
      'games',
      'isYou',
      'provisional',
      'rank',
      'riotId',
      'top4Rate',
    ]);
  });

  it('never caches a personal board', async () => {
    const { app, headers } = await start({ ...IN, friendStats: STATS });
    const result = await app.inject({ url: '/v1/friends/leaderboard', headers });

    expect(result.headers['cache-control']).toBe('no-store');
  });
});
