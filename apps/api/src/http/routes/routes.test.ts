/**
 * Endpoint integration tests (task 1.13).
 *
 * Driven through `app.inject()` against the same `buildApp` the server uses, so
 * the routing, the compliance hook and the cache behaviour under test are the
 * real ones — only the datastores are faked.
 *
 * _Requirements: 1.4, 1.5, 1.6, 1.7, 2.1, 2.6, 11.1, 11.2_
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.js';
import { buildTestContext, compMetadata, tierListSnapshot } from '../test-context.js';

let app: FastifyInstance | undefined;

const start = async (options: Parameters<typeof buildTestContext>[0] = {}) => {
  const { context, store } = buildTestContext(options);
  app = await buildApp({ context });
  return { app, context, store };
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /v1/meta/tier-list (_Requirements: 1.5, 1.7_)', () => {
  it('serves the published snapshot with patch and refresh timestamp', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/v1/meta/tier-list' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.patch).toBe('17.9');
    expect(body.lastRefreshedAt).toEqual(expect.any(String));
    expect(body.scoringFormulaVersion).toBe('1.0.0');
    expect(body.entries).toHaveLength(3);
  });

  it('filters by tier, playstyle and difficulty', async () => {
    const { app } = await start();

    const byTier = await app.inject({ url: '/v1/meta/tier-list?tier=S' });
    expect(byTier.json().entries.map((entry: { compId: string }) => entry.compId)).toEqual([
      'vanguard-zoe',
    ]);

    const byPlaystyle = await app.inject({ url: '/v1/meta/tier-list?playstyle=Reroll' });
    expect(byPlaystyle.json().entries.map((entry: { compId: string }) => entry.compId)).toEqual([
      'bruiser-sett',
    ]);

    const byDifficulty = await app.inject({ url: '/v1/meta/tier-list?difficulty=Hard' });
    expect(byDifficulty.json().entries).toHaveLength(1);
  });

  it('can filter to provisional comps specifically (R1.4)', async () => {
    const { app } = await start();
    const response = await app.inject({ url: '/v1/meta/tier-list?tier=provisional' });
    expect(response.json().entries.map((entry: { compId: string }) => entry.compId)).toEqual([
      'experimental-kaisa',
    ]);
  });

  it('rejects an unknown filter value rather than silently ignoring it', async () => {
    // Silently ignoring it would return an unfiltered list that looks correct
    // and is not what the client asked for.
    const { app } = await start();
    const response = await app.inject({ url: '/v1/meta/tier-list?tier=SSS' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_query');
  });

  it('flags stale data but keeps serving it (R1.6, R11.2)', async () => {
    const stale = tierListSnapshot({
      lastRefreshedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    });
    const { app } = await start({ snapshot: stale });

    const response = await app.inject({ url: '/v1/meta/tier-list' });
    expect(response.statusCode).toBe(200);
    expect(response.json().stale).toBe(true);
    expect(response.json().entries.length).toBeGreaterThan(0);
  });

  it('computes staleness at read time, not from the stored snapshot', async () => {
    // The snapshot says stale:false because it was fresh when written. Read
    // hours later, it is not — that is the read-time computation working.
    const old = tierListSnapshot({
      stale: false,
      lastRefreshedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    });
    const { app } = await start({ snapshot: old });
    expect(response(await app.inject({ url: '/v1/meta/tier-list' })).stale).toBe(true);
  });

  it('returns 503 rather than an empty list when nothing has been published', async () => {
    // An empty tier list and "we have no data" mean different things to a
    // client; conflating them hides a broken pipeline.
    const { app } = await start({ snapshot: null });
    const result = await app.inject({ url: '/v1/meta/tier-list' });
    expect(result.statusCode).toBe(503);
    expect(result.json().error).toBe('no_snapshot');
  });

  it('returns 503 when no patch is marked current', async () => {
    const { app } = await start({ currentPatch: null, snapshot: null });
    expect((await app.inject({ url: '/v1/meta/tier-list' })).statusCode).toBe(503);
  });
});

describe('GET /v1/meta/health (_Requirements: 11.5_)', () => {
  it('reports ok and minutes since last publish', async () => {
    const { app } = await start();
    const body = response(await app.inject({ url: '/v1/meta/health' }));
    expect(body.status).toBe('ok');
    expect(body.stale).toBe(false);
    expect(body.minutesSinceLastPublish).toBe(0);
  });

  it('reports degraded but still returns 200 when the pipeline is behind', async () => {
    // 200 because the app is still serving last-known-good data (R11.2). The
    // `stale` flag is what alerting pages on.
    const { app } = await start({
      lastPublishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    });
    const result = await app.inject({ url: '/v1/meta/health' });
    expect(result.statusCode).toBe(200);
    expect(result.json().status).toBe('degraded');
  });

  it('reports degraded when the pipeline has never run', async () => {
    const { app } = await start({ lastPublishedAt: null });
    expect(response(await app.inject({ url: '/v1/meta/health' })).status).toBe('degraded');
  });
});

describe('GET /v1/comps (_Requirements: 2.1, 2.6_)', () => {
  it('joins Postgres metadata with the snapshot stats', async () => {
    const { app } = await start();
    const body = response(await app.inject({ url: '/v1/comps' }));

    const zoe = body.comps.find((comp: { id: string }) => comp.id === 'vanguard-zoe');
    expect(zoe.tier).toBe('S');
    expect(zoe.explanation).toContain('Vanguard buys time');
    expect(zoe.computedStats.sampleSize).toBe(24_000);
  });

  it('filters by carry, trait and playstyle', async () => {
    const { app } = await start();

    expect(response(await app.inject({ url: '/v1/comps?carry=TFT17_Sett' })).comps).toHaveLength(1);
    expect(response(await app.inject({ url: '/v1/comps?trait=Sorcerer' })).comps).toHaveLength(1);
    expect(response(await app.inject({ url: '/v1/comps?playstyle=Fast+8' })).comps).toHaveLength(1);
  });

  it('reports a cache hit on the second identical request (R11.1)', async () => {
    const { app } = await start();

    const first = await app.inject({ url: '/v1/comps?carry=TFT17_Zoe' });
    const second = await app.inject({ url: '/v1/comps?carry=TFT17_Zoe' });

    expect(first.headers['x-cache']).toBe('miss');
    expect(second.headers['x-cache']).toBe('hit');
  });

  it('does not share a cache entry between different filters', async () => {
    const { app } = await start();

    await app.inject({ url: '/v1/comps?carry=TFT17_Zoe' });
    const other = await app.inject({ url: '/v1/comps?carry=TFT17_Sett' });

    expect(other.headers['x-cache']).toBe('miss');
    expect(response(other).comps[0].id).toBe('bruiser-sett');
  });

  it('still serves when Redis is unreachable (R11.2)', async () => {
    // Degraded, not broken: a slow response beats a 500.
    const { context } = buildTestContext();
    vi.mocked(context.cache.get).mockRejectedValue(new Error('redis down'));
    vi.mocked(context.cache.set).mockRejectedValue(new Error('redis down'));
    app = await buildApp({ context });

    const result = await app.inject({ url: '/v1/comps' });
    expect(result.statusCode).toBe(200);
    expect(result.json().comps.length).toBeGreaterThan(0);
  });
});

describe('GET /v1/comps/:id (_Requirements: 2.1, 1.4_)', () => {
  it('returns full comp detail', async () => {
    const { app } = await start();
    const body = response(await app.inject({ url: '/v1/comps/vanguard-zoe' }));

    expect(body.name).toBe('Vanguard Zoe');
    expect(body.formation.front).toEqual(['TFT17_Leona']);
    expect(body.stageGuides.stage2).toBeTruthy();
    // Category labels only, never a win-rate-ranked augment list (R2.4).
    expect(body.augmentPriority).toEqual(['Items', 'Combat', 'Econ']);
  });

  it('404s for an unknown comp', async () => {
    const { app } = await start();
    const result = await app.inject({ url: '/v1/comps/does-not-exist' });
    expect(result.statusCode).toBe(404);
    expect(result.json().error).toBe('comp_not_found');
  });

  it('marks a comp with no snapshot entry provisional rather than tiering it', async () => {
    // It exists and is worth browsing, but has earned no rank (R1.4).
    const { app } = await start({
      comps: [compMetadata({ id: 'brand-new', name: 'Brand New' })],
    });
    const body = response(await app.inject({ url: '/v1/comps/brand-new' }));

    expect(body.tier).toBe('provisional');
    expect(body.computedStats.sampleSize).toBe(0);
  });
});

/**
 * Response bodies are asserted structurally rather than against a type. The
 * point of these tests is to catch the API drifting from what clients expect,
 * so typing the body here from the same source the route uses would make them
 * agree by construction and prove nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function response(result: { json: () => unknown }): any {
  return result.json();
}
