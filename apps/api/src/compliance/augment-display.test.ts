/**
 * RELEASE-BLOCKING. Do not skip, do not weaken, do not mark `.todo`.
 *
 * tasks.md 2.6 and X.6 make this a standing CI gate: augment win rates and
 * average placements must never appear in a response body, on any route, in any
 * client. R13.6 makes it a Riot approval blocker rather than a quality issue.
 *
 * Run in isolation by `npm run test:compliance`, which CI invokes as its own
 * named check so a red build reads "this leaks augment win rates" rather than
 * "a test failed".
 *
 * _Requirements: 3.1, 3.6, 13.6_
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { FORBIDDEN_STAT_FIELDS, assertNoForbiddenStatFields } from '@tft-codex/shared-types';

import { buildApp } from '../http/app.js';
import { isGuardedRoute, stripForbiddenStatFields } from '../http/compliance-plugin.js';
import { buildTestContext } from '../http/test-context.js';
import { findForbiddenStatFields } from '@tft-codex/shared-types';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/**
 * Routes carrying augment-derived data. Everything they return must be clean,
 * with no exceptions — a blanket assertion is correct here.
 *
 * Adding a route under `/v1/augments/*` or `/v1/recommendations` without adding
 * it to this list is the gap that lets a leak ship. There is a test below that
 * cross-checks this list against the app's actual route table, so the omission
 * fails CI rather than going unnoticed.
 */
const GUARDED_ROUTES: string[] = [
  '/v1/augments/tier-list',
  '/v1/augments/tier-list?tier=S',
  '/v1/augments/tier-list?kind=legend',
  '/v1/augments/TFT17_Augment_SorcererHeart',
];

/** POST routes need a body, so they're exercised separately. */
const GUARDED_POSTS = [
  {
    url: '/v1/recommendations',
    payload: {
      source: 'web',
      boardUnits: ['TFT17_Zoe', 'TFT17_Leona'],
      augmentOptions: [
        'TFT17_Augment_SorcererHeart',
        'TFT17_Augment_PandorasItems',
        'TFT17_Augment_BigFriend',
      ],
    },
  },
  {
    url: '/v1/recommendations',
    payload: {
      source: 'overwolf-overlay',
      mode: 'tier3-adaptive',
      boardUnits: ['TFT17_Zoe'],
      augmentOptions: ['TFT17_Augment_SorcererHeart'],
    },
  },
];

/**
 * Public routes that legitimately carry COMP statistics.
 *
 * Riot's restriction names augments and Legends — not comps. A blanket scan
 * here would flag `entries[].stats.winRate` on the tier list, and "fixing"
 * that by stripping it would quietly zero out the product's headline numbers
 * with nobody noticing. So the assertion is narrower and more precise: a
 * forbidden field must never appear anywhere *augment-scoped*.
 */
const COMP_STAT_ROUTES = [
  '/v1/meta/tier-list',
  '/v1/meta/tier-list?tier=S',
  '/v1/meta/health',
  '/v1/comps',
  '/v1/comps?carry=TFT17_Zoe',
  '/v1/comps/vanguard-zoe',
];

describe('R3.1 — no forbidden augment stat reaches any client', () => {
  it('holds absolutely on augment-bearing GET routes', async () => {
    const { context } = buildTestContext();
    app = await buildApp({ context });

    for (const url of GUARDED_ROUTES) {
      const result = await app.inject({ url });
      assertNoForbiddenStatFields(result.json(), `GET ${url}`);
    }
  });

  it('holds absolutely on the recommendation route, in both modes', async () => {
    // Run once with Tier-3 gated and once with it confirmed. The numbers
    // restriction (R3.1) and the timing restriction (R3.7) are independent —
    // enabling Tier-3 must not loosen the first one.
    for (const tier3Confirmed of [false, true]) {
      const { context } = buildTestContext({
        config: {
          compliance: {
            tier3RecommendationsConfirmed: tier3Confirmed,
            tier3ConfirmationRef: tier3Confirmed ? 'fixture' : null,
          },
        },
      });
      const instance = await buildApp({ context });

      try {
        for (const { url, payload } of GUARDED_POSTS) {
          const result = await instance.inject({ method: 'POST', url, payload });
          assertNoForbiddenStatFields(
            result.json(),
            `POST ${url} (tier3Confirmed=${tier3Confirmed})`,
          );
        }
      } finally {
        await instance.close();
      }
    }
  });

  it('emits no numeric justification in any augment reason', async () => {
    // R3.4: the reason must be qualitative. A number here would be a win rate
    // in prose, which the field-name scan above would not catch.
    const { context } = buildTestContext();
    app = await buildApp({ context });

    const result = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: GUARDED_POSTS[0]!.payload,
    });

    const body = result.json() as { augmentAdvice: { reason: string }[] };
    expect(body.augmentAdvice.length).toBeGreaterThan(0);
    for (const advice of body.augmentAdvice) {
      expect(advice.reason, `reason "${advice.reason}" contains a digit`).not.toMatch(/\d/);
    }
  });

  it('covers every registered route under a guarded prefix', async () => {
    // The list above is only as good as its completeness. This walks Fastify's
    // actual route table and fails if a guarded-prefix route was added without
    // a corresponding entry — which is exactly how a leak would ship.
    const { context } = buildTestContext();
    app = await buildApp({ context });

    const registered = app
      .printRoutes({ commonPrefix: false })
      .split('\n')
      .map((line) => line.replace(/^[\s│├└─]+/, '').trim())
      .filter((line) => line.startsWith('/v1/'))
      .map((line) => line.replace(/\s*\(.*$/, ''))
      .filter((route) => isGuardedRoute(route));

    // Guards against the parsing above silently matching nothing. A coverage
    // check that finds no routes passes forever while covering nothing, which
    // is worse than having no check at all.
    expect(
      registered.length,
      'Route-table parsing found no guarded routes — the check is passing vacuously. ' +
        "Fix the parser before trusting this suite's green.",
    ).toBeGreaterThanOrEqual(3);

    const covered = new Set(
      [...GUARDED_ROUTES.map((url) => url.split('?')[0]!), ...GUARDED_POSTS.map((p) => p.url)].map(
        (url) => url.replace(/\/TFT17_Augment_\w+$/, '/:id'),
      ),
    );

    for (const route of registered) {
      expect(
        covered.has(route),
        `Route ${route} is under a guarded prefix but has no case in this suite. ` +
          'Add one — an uncovered augment route is how an R3.1 leak reaches production.',
      ).toBe(true);
    }
  });

  it('holds for anything augment-scoped on comp-stat routes', async () => {
    const { context } = buildTestContext();
    app = await buildApp({ context });

    for (const url of COMP_STAT_ROUTES) {
      const hits = findForbiddenStatFields((await app.inject({ url })).json());
      const augmentScoped = hits.filter((hit) => /augment|legend/i.test(hit.path));

      expect(
        augmentScoped,
        `GET ${url} exposes augment-scoped restricted stats at ` +
          augmentScoped.map((hit) => hit.path).join(', '),
      ).toEqual([]);
    }
  });

  it('permits comp win rate and average placement, which are not restricted', async () => {
    // The counterpart to the test above, and the reason the scan is scoped
    // rather than global: an over-broad filter would strip these and the tier
    // list would silently read zero.
    const { context } = buildTestContext();
    app = await buildApp({ context });

    const body = (await app.inject({ url: '/v1/meta/tier-list' })).json() as {
      entries: { stats: { winRate: number; avgPlacement: number } }[];
    };

    expect(body.entries[0]!.stats.winRate).toBeGreaterThan(0);
    expect(body.entries[0]!.stats.avgPlacement).toBeGreaterThan(0);
  });
});

describe('The gateway guard is the third layer, and it works', () => {
  it('identifies the compliance-sensitive routes', () => {
    expect(isGuardedRoute('/v1/augments/tier-list')).toBe(true);
    expect(isGuardedRoute('/v1/augments/TFT17_Augment_Test')).toBe(true);
    expect(isGuardedRoute('/v1/recommendations')).toBe(true);
    // Comps are not guarded — their win rates are permitted.
    expect(isGuardedRoute('/v1/comps')).toBe(false);
    expect(isGuardedRoute('/v1/meta/tier-list')).toBe(false);
  });

  it('strips forbidden fields at any depth while leaving everything else', () => {
    const cleaned = stripForbiddenStatFields({
      augmentAdvice: [{ augmentId: 'a1', rank: 1, reason: 'Fits your front line.', winRate: 0.3 }],
      nested: { deeper: { avg_placement: 4.1, playRate: 0.09 } },
      modeServed: 'tier2-lookup',
    });

    expect(() => assertNoForbiddenStatFields(cleaned)).not.toThrow();
    // Permitted data survives intact.
    expect(cleaned.augmentAdvice[0]!.reason).toBe('Fits your front line.');
    expect(cleaned.nested.deeper.playRate).toBe(0.09);
    expect(cleaned.modeServed).toBe('tier2-lookup');
  });

  it('throws outside production so the engineer who caused it finds it', async () => {
    const { context } = buildTestContext({ config: { isProduction: false } });
    app = await buildApp({ context });

    // A route that leaks, registered after the guard — exactly the shape of the
    // future mistake this layer exists to catch.
    app.get('/v1/augments/leaky', async () => ({
      id: 'a1',
      tier: 'S',
      winRate: 0.31,
    }));

    const result = await app.inject({ url: '/v1/augments/leaky' });
    expect(result.statusCode).toBe(500);
  });

  it('strips rather than 500s in production, and the response stays clean', async () => {
    // A stripped response beats an outage for the user, and beats a policy
    // breach for us.
    const { context } = buildTestContext({ config: { isProduction: true } });
    app = await buildApp({ context });

    app.get('/v1/augments/leaky', async () => ({
      id: 'a1',
      name: 'Test',
      tier: 'S',
      playRate: 0.1,
      winRate: 0.31,
      avgPlacement: 3.9,
    }));

    const result = await app.inject({ url: '/v1/augments/leaky' });
    expect(result.statusCode).toBe(200);

    const body = result.json();
    assertNoForbiddenStatFields(body, 'production-stripped response');
    // Permitted fields are untouched.
    expect(body.playRate).toBe(0.1);
    expect(body.tier).toBe('S');
  });
});

describe('R3.7 — Tier-3 stays off without written Riot confirmation', () => {
  it('defaults to disabled in the test configuration', () => {
    const { context } = buildTestContext();
    expect(context.config.compliance.tier3RecommendationsConfirmed).toBe(false);
  });
});

describe('The forbidden-field list itself', () => {
  it('covers the two terms Riot names, plus the obvious synonyms', () => {
    expect(FORBIDDEN_STAT_FIELDS).toContain('winRate');
    expect(FORBIDDEN_STAT_FIELDS).toContain('avgPlacement');
    expect(FORBIDDEN_STAT_FIELDS).toContain('averagePlacement');
  });
});
