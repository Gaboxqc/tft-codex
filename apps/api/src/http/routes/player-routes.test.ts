/**
 * Personal analytics endpoint tests (task 3.13).
 *
 * Authentication is exercised for real — `authHeaderFor` issues a genuine
 * signed token against a seeded session, so these cover the actual
 * verification path rather than stubbing it out.
 *
 * _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 7.3, 7.4, 15.1, 15.3, 15.4_
 */
import type { FastifyInstance } from 'fastify';
import type { MatchSummary } from '@tft-codex/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.js';
import { authHeaderFor, buildTestContext } from '../test-context.js';
import { safeRedirect } from './auth.js';

let app: FastifyInstance | undefined;

const SESSION = { puuid: 'puuid-1', sessionId: 'sid-1' };

const match = (overrides: Partial<MatchSummary> = {}): MatchSummary => ({
  matchId: 'EUW1_1',
  puuid: 'puuid-1',
  patch: '17.9',
  placement: 6,
  detectedCompId: 'vanguard-zoe',
  augmentsPicked: ['TFT17_Augment_SorcererHeart'],
  levelCurve: [
    { round: '3-2', value: 5 },
    { round: '5-6', value: 8 },
  ],
  goldCurve: [
    { round: '3-2', value: 4 },
    { round: '5-6', value: 10 },
  ],
  timestamp: '2026-08-07T10:00:00.000Z',
  ...overrides,
});

const start = async (options: Parameters<typeof buildTestContext>[0] = {}) => {
  const { context } = buildTestContext({ session: SESSION, matches: [match()], ...options });
  app = await buildApp({ context });
  return { app, context, headers: authHeaderFor(context, SESSION) };
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (result: { json: () => unknown }): any => result.json();

describe('Authentication (_Requirements: 7.4_)', () => {
  const PROTECTED = [
    '/v1/players/me',
    '/v1/players/me/matches',
    '/v1/players/me/matches/EUW1_1',
    '/v1/players/me/analytics',
    '/v1/matches/EUW1_1/coaching',
  ];

  it('401s every personal route without a session', async () => {
    const { app } = await start();
    for (const url of PROTECTED) {
      expect((await app.inject({ url })).statusCode, url).toBe(401);
    }
  });

  it('gives the same 401 for a forged token as for a missing one', async () => {
    // Distinguishing them tells an attacker which half of the check they passed.
    const { app } = await start();
    const forged = await app.inject({
      url: '/v1/players/me',
      headers: { authorization: 'Bearer not.a.token' },
    });
    const missing = await app.inject({ url: '/v1/players/me' });

    expect(forged.statusCode).toBe(401);
    expect(forged.json()).toEqual(missing.json());
  });

  it('rejects a validly signed token whose session was revoked', async () => {
    // A JWT alone cannot be revoked, which is exactly the problem unlinking
    // creates — hence the database lookup on every request.
    const { context } = buildTestContext({ session: SESSION });
    vi.mocked(context.auth.findSession).mockResolvedValue(null);
    app = await buildApp({ context });

    const result = await app.inject({
      url: '/v1/players/me',
      headers: authHeaderFor(context, SESSION),
    });
    expect(result.statusCode).toBe(401);
  });

  it('leaves public routes reachable without a session (R7.4)', async () => {
    const { app } = await start();
    for (const url of ['/v1/meta/tier-list', '/v1/comps', '/v1/augments/tier-list']) {
      expect((await app.inject({ url })).statusCode, url).toBe(200);
    }
  });
});

describe('GET /v1/players/me/matches (_Requirements: 4.1_)', () => {
  it('returns the caller’s own matches', async () => {
    const { app, headers } = await start();
    const body = json(await app.inject({ url: '/v1/players/me/matches', headers }));

    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].matchId).toBe('EUW1_1');
  });

  it('is never cached', async () => {
    const { app, headers } = await start();
    const result = await app.inject({ url: '/v1/players/me/matches', headers });
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('clamps an absurd limit rather than trusting it', async () => {
    const { app, headers, context } = await start();
    await app.inject({ url: '/v1/players/me/matches?limit=100000', headers });

    expect(vi.mocked(context.players.listMatches).mock.calls[0]![1]).toMatchObject({ limit: 50 });
  });
});

describe('GET /v1/players/me/matches/:matchId (_Requirements: 4.3, 4.5_)', () => {
  it('compares the player’s curves against the top-4 baseline', async () => {
    const { app, headers } = await start();
    const body = json(await app.inject({ url: '/v1/players/me/matches/EUW1_1', headers }));

    expect(body.baseline.compName).toBe('Vanguard Zoe');
    expect(body.levelDeviations.length).toBeGreaterThan(0);
    expect(body.levelDeviations[0]).toMatchObject({ round: '3-2', actual: 5, baseline: 6 });
  });

  it('produces at least one actionable suggestion (R4.5)', async () => {
    const { app, headers } = await start();
    const body = json(await app.inject({ url: '/v1/players/me/matches/EUW1_1', headers }));

    expect(body.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(body.keyDeviationRound).toBe('3-2');
  });

  it('declares the curve source rather than implying a full trace', async () => {
    // Riot exposes no TFT match timeline; saying so beats drawing a line
    // through a single point.
    const { app, headers } = await start();
    expect(
      json(await app.inject({ url: '/v1/players/me/matches/EUW1_1', headers })).curveSource,
    ).toBe('final-state');
  });

  it('404s for a match the caller does not own', async () => {
    const { app, headers } = await start();
    expect(
      (await app.inject({ url: '/v1/players/me/matches/SOMEONE_ELSE', headers })).statusCode,
    ).toBe(404);
  });
});

describe('GET /v1/matches/:matchId/coaching (_Requirements: 15.1, 15.3, 15.4_)', () => {
  it('generates a narrative citing the deviation round', async () => {
    const { app, headers } = await start();
    const body = json(await app.inject({ url: '/v1/matches/EUW1_1/coaching', headers }));

    expect(body.narrative).toContain('3-2');
    expect(body.keyDeviationRound).toBe('3-2');
    expect(body.suggestions.length).toBeGreaterThan(0);
  });

  it('caches the generated narrative rather than regenerating on every open', async () => {
    const { app, headers, context } = await start();
    await app.inject({ url: '/v1/matches/EUW1_1/coaching', headers });
    expect(context.players.saveCoaching).toHaveBeenCalled();
  });

  it('honours the raw-stats opt-out at the API, not just in the UI (R15.4)', async () => {
    // A client that ignored the preference would otherwise still get the text.
    const { context } = buildTestContext({
      session: SESSION,
      matches: [match()],
      profile: {
        puuid: 'puuid-1',
        region: 'euw1',
        riotId: 'Codex#EUW',
        linkedAt: '2026-08-01T00:00:00.000Z',
        lastSyncedAt: null,
        notificationPrefs: [],
        coachingNarrativeOptOut: true,
      },
    });
    app = await buildApp({ context });

    const result = await app.inject({
      url: '/v1/matches/EUW1_1/coaching',
      headers: authHeaderFor(context, SESSION),
    });

    expect(result.statusCode).toBe(409);
    expect(result.json().error).toBe('coaching_opted_out');
  });

  it('emits no augment outcome claim (R3.1, R4.7)', async () => {
    const { app, headers } = await start();
    const body = json(await app.inject({ url: '/v1/matches/EUW1_1/coaching', headers }));
    const text = JSON.stringify(body).toLowerCase();

    expect(text).not.toMatch(/win\s*rate|winrate/);
    expect(text).not.toMatch(/average placement|avgplacement/);
  });
});

describe('GET /v1/players/me/analytics (_Requirements: 4.4, 4.7_)', () => {
  it('aggregates by comp with readable names', async () => {
    const { app, headers } = await start();
    const body = json(await app.inject({ url: '/v1/players/me/analytics', headers }));

    expect(body.totalGames).toBe(12);
    expect(body.byComp[0].compName).toBe('Vanguard Zoe');
  });

  it('exposes no augment breakdown at all (R4.7)', async () => {
    // Gated on Riot's written answer via task 3.12. The data exists in the
    // same table, so its absence here is the enforcement.
    const { app, headers } = await start();
    const body = json(await app.inject({ url: '/v1/players/me/analytics', headers }));

    expect(Object.keys(body).sort()).toEqual(['byComp', 'overallAvgPlacement', 'totalGames']);
    expect(JSON.stringify(body).toLowerCase()).not.toContain('augment');
  });
});

describe('DELETE /v1/players/me (_Requirements: 7.3, 12.4_)', () => {
  it('stops serving immediately and revokes every session', async () => {
    // The 30-day window exists for auditability and accidental-unlink
    // recovery, not to keep serving data the user asked us to forget.
    const { app, headers, context } = await start();
    const result = await app.inject({ method: 'DELETE', url: '/v1/players/me', headers });

    expect(result.statusCode).toBe(202);
    expect(context.players.requestDeletion).toHaveBeenCalledWith('puuid-1');
    expect(context.auth.deleteSessionsFor).toHaveBeenCalledWith('puuid-1');
  });

  it('clears the session cookie', async () => {
    const { app, headers } = await start();
    const result = await app.inject({ method: 'DELETE', url: '/v1/players/me', headers });
    expect(result.headers['set-cookie']).toBeDefined();
  });
});

describe('PUT /v1/players/me/preferences (_Requirements: 15.4_)', () => {
  it('stores the opt-out', async () => {
    const { app, headers, context } = await start();
    const result = await app.inject({
      method: 'PUT',
      url: '/v1/players/me/preferences',
      headers,
      payload: { coachingNarrativeOptOut: true },
    });

    expect(result.statusCode).toBe(200);
    expect(context.players.setCoachingOptOut).toHaveBeenCalledWith('puuid-1', true);
  });

  it('rejects a non-boolean rather than coercing it', async () => {
    const { app, headers } = await start();
    const result = await app.inject({
      method: 'PUT',
      url: '/v1/players/me/preferences',
      headers,
      payload: { coachingNarrativeOptOut: 'yes' },
    });
    expect(result.statusCode).toBe(400);
  });
});

describe('safeRedirect (_Requirements: 7.1_)', () => {
  it('allows a rooted same-origin path', () => {
    expect(safeRedirect('/dashboard', '/')).toBe('/dashboard');
  });

  it('rejects an absolute URL, which would be an open redirect', () => {
    // An attacker sends a victim through our own login and lands them on a
    // phishing page that looks like it came from us.
    expect(safeRedirect('https://evil.example/steal', '/')).toBe('/');
  });

  it('rejects a protocol-relative URL, which browsers treat as absolute', () => {
    expect(safeRedirect('//evil.example', '/')).toBe('/');
  });

  it('falls back when nothing was requested', () => {
    expect(safeRedirect(undefined, '/')).toBe('/');
  });
});

describe('RSO configuration (_Requirements: 7.1_)', () => {
  it('503s account linking when RSO credentials are not yet issued', async () => {
    // Riot issues these only on approval; the rest of the API must still boot.
    const { context } = buildTestContext({ config: { rso: null } });
    app = await buildApp({ context });

    const result = await app.inject({ url: '/v1/auth/riot/start' });
    expect(result.statusCode).toBe(503);
    expect(result.json().detail).toContain('approvals.md');
  });

  it('redirects to Riot when configured', async () => {
    const { app } = await start();
    const result = await app.inject({ url: '/v1/auth/riot/start' });

    expect(result.statusCode).toBe(302);
    expect(result.headers['location']).toContain('auth.riotgames.com/authorize');
    expect(result.headers['location']).toContain('code_challenge_method=S256');
  });
});
