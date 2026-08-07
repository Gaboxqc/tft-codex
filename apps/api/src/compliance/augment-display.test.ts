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
 * Currently only the synthetic leaky routes below exercise this; the real
 * `/v1/augments/*` and `/v1/recommendations` land in Phase 2. The list is
 * declared now so adding those routes without adding them here is a visible
 * omission rather than a silent gap.
 */
const GUARDED_ROUTES: string[] = [];

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
  it('holds absolutely on augment-bearing routes', async () => {
    const { context } = buildTestContext();
    app = await buildApp({ context });

    for (const url of GUARDED_ROUTES) {
      const result = await app.inject({ url });
      assertNoForbiddenStatFields(result.json(), `GET ${url}`);
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
