/**
 * Integration tests for the Phase 2 endpoints.
 *
 * The compliance assertions live in `src/compliance/` so they can run as their
 * own CI gate. These cover the behaviour a client depends on.
 *
 * _Requirements: 3.2, 3.3, 3.4, 3.5, 3.7, 17.1, 17.2_
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { augmentRecord, buildTestContext } from '../test-context.js';

let app: FastifyInstance | undefined;

const start = async (options: Parameters<typeof buildTestContext>[0] = {}) => {
  const { context } = buildTestContext(options);
  app = await buildApp({ context });
  return { app, context };
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (result: { json: () => unknown }): any => result.json();

describe('GET /v1/augments/tier-list (_Requirements: 3.2, 3.3_)', () => {
  it('returns categorical tiers and play rates', async () => {
    const { app } = await start();
    const body = json(await app.inject({ url: '/v1/augments/tier-list' }));

    expect(body.patch).toBe('17.9');
    expect(body.augments).toHaveLength(3);
    expect(body.augments[0].tier).toBe('S');
    expect(body.augments[0].playRate).toBeCloseTo(0.094);
  });

  it('exposes exactly the allowlisted fields and nothing else', async () => {
    // The response shape is the contract. Asserting the full key set means a
    // new field cannot appear without this test being updated deliberately.
    const { app } = await start();
    const [augment] = json(await app.inject({ url: '/v1/augments/tier-list' })).augments;

    expect(Object.keys(augment).sort()).toEqual(
      [
        'category',
        'curatedForCompIds',
        'description',
        'id',
        'name',
        'patch',
        'playRate',
        'provisional',
        'qualitativeNotes',
        'roundsOffered',
        'tier',
      ].sort(),
    );
  });

  it('filters by tier', async () => {
    const { app } = await start();
    const body = json(await app.inject({ url: '/v1/augments/tier-list?tier=S' }));
    expect(body.augments).toHaveLength(1);
    expect(body.augments[0].tier).toBe('S');
  });

  it('rejects an unknown tier value rather than ignoring it', async () => {
    const { app } = await start();
    const result = await app.inject({ url: '/v1/augments/tier-list?tier=SSS' });
    expect(result.statusCode).toBe(400);
  });

  it('serves Legends through the same route and the same restrictions (R3.6)', async () => {
    // R3.6 requires Legends be handled identically with no code change. Same
    // table, same allowlist, same guard — only the `kind` filter differs.
    const { app } = await start({
      augments: [
        augmentRecord({ id: 'TFT17_Legend_Poro', name: 'Poro', kind: 'legend', tier: 'A' }),
      ],
    });

    expect(
      json(await app.inject({ url: '/v1/augments/tier-list?kind=legend' })).augments,
    ).toHaveLength(1);
    expect(json(await app.inject({ url: '/v1/augments/tier-list' })).augments).toHaveLength(0);
  });

  it('reports a cache hit on a repeated request', async () => {
    const { app } = await start();
    await app.inject({ url: '/v1/augments/tier-list' });
    const second = await app.inject({ url: '/v1/augments/tier-list' });
    expect(second.headers['x-cache']).toBe('hit');
  });
});

describe('GET /v1/augments/:id (_Requirements: 3.2_)', () => {
  it('returns a single augment with its qualitative notes', async () => {
    const { app } = await start();
    const body = json(await app.inject({ url: '/v1/augments/TFT17_Augment_SorcererHeart' }));

    expect(body.name).toBe('Sorcerer Heart');
    expect(body.qualitativeNotes).toContain('Sorcerer core');
    expect(body.curatedForCompIds).toContain('vanguard-zoe');
  });

  it('404s for an unknown augment', async () => {
    const { app } = await start();
    const result = await app.inject({ url: '/v1/augments/nope' });
    expect(result.statusCode).toBe(404);
    expect(result.json().error).toBe('augment_not_found');
  });
});

describe('POST /v1/recommendations (_Requirements: 3.4, 3.5, 3.7_)', () => {
  const post = (app: FastifyInstance, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v1/recommendations', payload });

  it('ranks the offered options with qualitative reasons', async () => {
    const { app } = await start();
    const body = json(
      await post(app, {
        source: 'web',
        boardUnits: ['TFT17_Zoe'],
        augmentOptions: [
          'TFT17_Augment_BigFriend',
          'TFT17_Augment_SorcererHeart',
          'TFT17_Augment_PandorasItems',
        ],
      }),
    );

    expect(body.augmentAdvice).toHaveLength(3);
    expect(body.augmentAdvice[0].augmentId).toBe('TFT17_Augment_SorcererHeart');
    expect(body.augmentAdvice.map((entry: { rank: number }) => entry.rank)).toEqual([1, 2, 3]);
    for (const entry of body.augmentAdvice) {
      expect(entry.reason).not.toMatch(/\d/);
    }
  });

  it('downgrades a Tier-3 request and says so in modeServed (R3.7)', async () => {
    const { app } = await start();
    const body = json(
      await post(app, {
        source: 'overwolf-overlay',
        mode: 'tier3-adaptive',
        boardUnits: ['TFT17_Zoe', 'TFT17_Leona'],
        augmentOptions: ['TFT17_Augment_SorcererHeart'],
      }),
    );

    expect(body.modeServed).toBe('tier2-lookup');
    expect(body.contextAware).toBe(false);
  });

  it('serves Tier-3 only when the deployment holds written confirmation', async () => {
    const { app } = await start({
      config: {
        compliance: {
          tier3RecommendationsConfirmed: true,
          tier3ConfirmationRef: 'riot-ticket-fixture',
        },
      },
    });

    const body = json(
      await post(app, {
        source: 'overwolf-overlay',
        mode: 'tier3-adaptive',
        boardUnits: ['TFT17_Zoe', 'TFT17_Leona'],
        augmentOptions: ['TFT17_Augment_SorcererHeart'],
      }),
    );

    expect(body.modeServed).toBe('tier3-adaptive');
    expect(body.contextAware).toBe(true);
  });

  it('suggests closest comps from the board', async () => {
    const { app } = await start();
    const body = json(await post(app, { source: 'web', boardUnits: ['TFT17_Zoe'] }));

    expect(body.suggestedComps.length).toBeGreaterThan(0);
    expect(body.suggestedComps[0].compId).toBe('vanguard-zoe');
    expect(body.augmentAdvice).toBeUndefined();
  });

  it('is never cached', async () => {
    // Caching a recommendation keyed by board state would be a stored record
    // of what a player was holding.
    const { app } = await start();
    const result = await post(app, { source: 'web', boardUnits: ['TFT17_Zoe'] });
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('rejects a malformed body', async () => {
    const { app } = await start();
    const result = await post(app, { source: 'not-a-client' });
    expect(result.statusCode).toBe(400);
  });
});

describe('GET /v1/reference/breakpoints (_Requirements: 17.1, 17.2_)', () => {
  it('returns the static table with interest thresholds', async () => {
    const { app } = await start();
    const body = json(await app.inject({ url: '/v1/reference/breakpoints' }));

    expect(body.patch).toBe('17.9');
    expect(body.rows).toHaveLength(2);
    expect(body.interestThresholds).toEqual([10, 20, 30, 40, 50]);
  });

  it('accepts no player-state parameter, which is what keeps it Tier-1', async () => {
    // R17.2 — a chart, not a calculator. Passing gold must not change anything.
    const { app } = await start();
    const plain = json(await app.inject({ url: '/v1/reference/breakpoints' }));
    const withGold = json(await app.inject({ url: '/v1/reference/breakpoints?gold=42&level=7' }));

    expect(withGold).toEqual(plain);
  });

  it('is cacheable for far longer than match-derived data', async () => {
    const { app } = await start();
    const result = await app.inject({ url: '/v1/reference/breakpoints' });
    expect(result.headers['cache-control']).toContain('max-age=3600');
  });
});
