/**
 * Builder endpoint tests (task 4.7).
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 7.4, 16.1, 16.2, 16.3_
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

const post = (
  instance: FastifyInstance,
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) => instance.inject({ method: 'POST', url, payload, headers });

const VANGUARD_BOARD = {
  name: 'Vanguard test',
  level: 6,
  units: [
    { championId: 'TFT17_Leona', starLevel: 2, itemIds: [] },
    { championId: 'TFT17_Braum', starLevel: 2, itemIds: [] },
    { championId: 'TFT17_Zoe', starLevel: 2, itemIds: ['TFT_Item_RabadonsDeathcap'] },
  ],
};

describe('POST /v1/builder/analyze (_Requirements: 6.2_)', () => {
  it('resolves traits with active breakpoints', async () => {
    const { app } = await start();
    const body = json(await post(app, '/v1/builder/analyze', VANGUARD_BOARD));

    const vanguard = body.traits.find((t: { traitId: string }) => t.traitId === 'Vanguard');
    expect(vanguard.count).toBe(2);
    expect(vanguard.activeBreakpoint).toBe(2);
  });

  it('flags a trait one unit from its next breakpoint', async () => {
    const { app } = await start();
    const body = json(
      await post(app, '/v1/builder/analyze', {
        ...VANGUARD_BOARD,
        units: [{ championId: 'TFT17_Zoe', starLevel: 2, itemIds: [] }],
      }),
    );

    const sorcerer = body.traits.find((t: { traitId: string }) => t.traitId === 'Sorcerer');
    expect(sorcerer.oneAway).toBe(true);
    expect(sorcerer.unitsToNext).toBe(1);
  });

  it('returns a board estimate with its caveats', async () => {
    const { app } = await start();
    const body = json(await post(app, '/v1/builder/analyze', VANGUARD_BOARD));

    expect(body.estimate.index).toBeGreaterThan(0);
    expect(body.estimate.caveats.length).toBeGreaterThan(0);
    expect(['low', 'medium']).toContain(body.estimate.confidence);
  });

  it('counts emblem-granted traits', async () => {
    const { app } = await start();
    const body = json(
      await post(app, '/v1/builder/analyze', {
        ...VANGUARD_BOARD,
        units: [
          { championId: 'TFT17_Leona', starLevel: 2, itemIds: [] },
          { championId: 'TFT17_Zoe', starLevel: 2, itemIds: ['TFT_Item_VanguardEmblem'] },
        ],
      }),
    );

    expect(body.traits.find((t: { traitId: string }) => t.traitId === 'Vanguard').count).toBe(2);
  });

  it('works signed out (R7.4)', async () => {
    const { app } = await start();
    expect((await post(app, '/v1/builder/analyze', VANGUARD_BOARD)).statusCode).toBe(200);
  });

  it('rejects a board over the size cap', async () => {
    const { app } = await start();
    const result = await post(app, '/v1/builder/analyze', {
      ...VANGUARD_BOARD,
      units: Array.from({ length: 13 }, () => ({
        championId: 'TFT17_Zoe',
        starLevel: 1,
        itemIds: [],
      })),
    });
    expect(result.statusCode).toBe(400);
  });

  it('handles an empty board without erroring', async () => {
    const { app } = await start();
    const body = json(await post(app, '/v1/builder/analyze', { ...VANGUARD_BOARD, units: [] }));
    expect(body.estimate.index).toBe(0);
    expect(body.traits).toEqual([]);
  });
});

describe('POST /v1/builder/comps (_Requirements: 6.3, 7.4_)', () => {
  it('saves anonymously and returns a share link', async () => {
    // R7.4 — the builder is fully usable logged out.
    const { app } = await start();
    const result = await post(app, '/v1/builder/comps', VANGUARD_BOARD);
    const body = json(result);

    expect(result.statusCode).toBe(201);
    expect(body.puuid).toBeNull();
    expect(body.shareUrl).toContain(`/builder/${body.id}`);
  });

  it('attributes the save when signed in', async () => {
    const { app, headers } = await start();
    const body = json(await post(app, '/v1/builder/comps', VANGUARD_BOARD, headers));
    expect(body.puuid).toBe('puuid-1');
  });

  it('round-trips the exact board through the share link (R6.3)', async () => {
    const { app } = await start();
    const saved = json(await post(app, '/v1/builder/comps', VANGUARD_BOARD));

    const loaded = json(await app.inject({ url: `/v1/builder/comps/${saved.id}` }));
    expect(loaded.board.units).toEqual(VANGUARD_BOARD.units);
    expect(loaded.board.level).toBe(6);
  });

  it('404s an unknown share id', async () => {
    const { app } = await start();
    const result = await app.inject({ url: '/v1/builder/comps/does-not-exist' });
    expect(result.statusCode).toBe(404);
    expect(result.json().error).toBe('board_not_found');
  });
});

describe('Ownership', () => {
  it('requires a session to list your boards', async () => {
    const { app } = await start();
    expect((await app.inject({ url: '/v1/builder/comps' })).statusCode).toBe(401);
  });

  it('404s rather than 403s when updating someone else’s board', async () => {
    // Confirming a board exists but is not yours leaks that the id is real.
    const { app, headers } = await start();
    const anonymous = json(await post(app, '/v1/builder/comps', VANGUARD_BOARD));

    const result = await app.inject({
      method: 'PUT',
      url: `/v1/builder/comps/${anonymous.id}`,
      headers,
      payload: { name: 'Hijacked' },
    });
    expect(result.statusCode).toBe(404);
  });

  it('lets an owner update their own board', async () => {
    const { app, headers } = await start();
    const saved = json(await post(app, '/v1/builder/comps', VANGUARD_BOARD, headers));

    const result = await app.inject({
      method: 'PUT',
      url: `/v1/builder/comps/${saved.id}`,
      headers,
      payload: { name: 'Renamed' },
    });
    expect(result.statusCode).toBe(200);
  });
});

describe('Comp matching (_Requirements: 6.4_)', () => {
  it('surfaces the tracked comp a saved board matches', async () => {
    // Reuses the ingestion path's detectComp, so a builder board is matched
    // exactly the way a real match is rather than by a parallel implementation.
    const { app, context } = await start();
    const { vi } = await import('vitest');
    vi.mocked(context.comps.listSignatures).mockResolvedValue([
      {
        compId: 'vanguard-zoe',
        patch: '17.9',
        coreTraits: ['Vanguard'],
        minTraitCounts: { Vanguard: 2 },
        carryChampionIds: ['TFT17_Zoe'],
      },
    ]);

    const saved = json(await post(app, '/v1/builder/comps', VANGUARD_BOARD));
    const loaded = json(await app.inject({ url: `/v1/builder/comps/${saved.id}` }));

    expect(loaded.matchedComp.compId).toBe('vanguard-zoe');
    expect(loaded.matchedComp.name).toBe('Vanguard Zoe');
  });

  it('reports no match rather than forcing one', async () => {
    const { app } = await start();
    const saved = json(await post(app, '/v1/builder/comps', VANGUARD_BOARD));
    const loaded = json(await app.inject({ url: `/v1/builder/comps/${saved.id}` }));

    expect(loaded.matchedComp).toBeNull();
  });
});

describe('POST /v1/items/optimize (_Requirements: 16.1, 16.2, 16.3_)', () => {
  it('allocates components across the board', async () => {
    const { app } = await start();
    const body = json(
      await post(app, '/v1/items/optimize', {
        heldItems: ['Rod', 'Rod', 'Belt', 'Belt'],
        boardUnits: ['TFT17_Zoe', 'TFT17_Leona'],
        compId: 'vanguard-zoe',
      }),
    );

    expect(body.allocations).toHaveLength(2);
    expect(body.allocations.every((a: { rationale: string }) => a.rationale.length > 0)).toBe(true);
  });

  it('reports leftover components rather than dropping them', async () => {
    const { app } = await start();
    const body = json(
      await post(app, '/v1/items/optimize', {
        heldItems: ['Rod', 'ChainVest'],
        boardUnits: ['TFT17_Zoe'],
      }),
    );
    expect(body.unallocated).toContain('ChainVest');
  });

  it('is never cached', async () => {
    // R16.3 — a builder/post-game tool, not something keyed to a player.
    const { app } = await start();
    const result = await post(app, '/v1/items/optimize', {
      heldItems: ['Rod'],
      boardUnits: ['TFT17_Zoe'],
    });
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('rejects a request with no board units', async () => {
    const { app } = await start();
    const result = await post(app, '/v1/items/optimize', { heldItems: ['Rod'], boardUnits: [] });
    expect(result.statusCode).toBe(400);
  });

  it('works signed out', async () => {
    const { app } = await start();
    const result = await post(app, '/v1/items/optimize', {
      heldItems: ['Rod', 'Rod'],
      boardUnits: ['TFT17_Zoe'],
    });
    expect(result.statusCode).toBe(200);
  });
});
