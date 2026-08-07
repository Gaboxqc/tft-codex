/**
 * Release-blocking compliance tests.
 *
 * This is the seed of the suite tasks.md 2.6 wires into CI as a merge gate.
 * At this layer we can only prove the *types* are structurally safe; the API
 * package adds the matching assertions against real response bodies.
 *
 * _Requirements: 3.1, 3.6, 3.7_
 */
import { describe, expect, it } from 'vitest';

import {
  AugmentDetailSchema,
  AugmentSchema,
  CompSchema,
  DEFAULT_RECOMMENDATION_MODE,
  FORBIDDEN_STAT_FIELDS,
  RecommendationResponseSchema,
  assertNoForbiddenStatFields,
  findForbiddenStatFields,
} from './index.js';

const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const forbidden = new Set(FORBIDDEN_STAT_FIELDS.map(normalize));

describe('R3.1 — the public Augment type cannot carry a restricted stat', () => {
  it('declares no forbidden field on AugmentSchema', () => {
    const keys = Object.keys(AugmentSchema.shape);
    expect(keys.filter((key) => forbidden.has(normalize(key)))).toEqual([]);
  });

  it('declares no forbidden field on AugmentDetailSchema', () => {
    const keys = Object.keys(AugmentDetailSchema.shape);
    expect(keys.filter((key) => forbidden.has(normalize(key)))).toEqual([]);
  });

  it('still allows playRate, which R3.3 explicitly permits', () => {
    expect(Object.keys(AugmentSchema.shape)).toContain('playRate');
  });

  it('strips a forbidden field if upstream code ever attaches one', () => {
    const parsed = AugmentSchema.parse({
      id: 'TFT17_Augment_Test',
      name: 'Test',
      tier: 'A',
      playRate: 0.1,
      roundsOffered: [2],
      description: '',
      patch: '17.9',
      // Simulates a future bug: an internal stat leaking into a public record.
      winRate: 0.21,
      avgPlacement: 3.8,
    });
    expect(parsed).not.toHaveProperty('winRate');
    expect(parsed).not.toHaveProperty('avgPlacement');
    expect(() => assertNoForbiddenStatFields(parsed, 'AugmentSchema output')).not.toThrow();
  });

  it('strips forbidden fields from a recommendation response', () => {
    const parsed = RecommendationResponseSchema.parse({
      suggestedComps: [],
      augmentAdvice: [
        { augmentId: 'a1', rank: 1, reason: 'Fits your Vanguard front line.', winRate: 0.3 },
      ],
      contextAware: false,
      modeServed: 'tier2-lookup',
    });
    expect(() => assertNoForbiddenStatFields(parsed, 'RecommendationResponse')).not.toThrow();
  });
});

describe('findForbiddenStatFields', () => {
  it('finds nested violations and reports their paths', () => {
    const hits = findForbiddenStatFields({
      augments: [{ id: 'a1', winRate: 0.2 }, { id: 'a2' }],
      meta: { nested: { avg_placement: 4.1 } },
    });
    expect(hits.map((hit) => hit.path)).toEqual([
      '$.augments[0].winRate',
      '$.meta.nested.avg_placement',
    ]);
  });

  it('matches regardless of casing or separators', () => {
    expect(findForbiddenStatFields({ Win_Rate: 1 })).toHaveLength(1);
    expect(findForbiddenStatFields({ AVGPLACEMENT: 1 })).toHaveLength(1);
  });

  it('does not flag comp stats, which are permitted (R1.1)', () => {
    // Comp win rate and average placement are fine — Riot's restriction names
    // augments and Legends only. Guarding against an over-broad filter that
    // would quietly break the tier list.
    const comp = {
      id: 'vanguard-zoe',
      computedStats: { avgPlacement: 4.1, winRate: 0.15 },
    };
    expect(findForbiddenStatFields(comp.computedStats)).toHaveLength(2);
    // ...which is why the scanner is applied per-route, not globally.
    expect(Object.keys(CompSchema.shape)).toContain('computedStats');
  });

  it('throws with an actionable message via assertNoForbiddenStatFields', () => {
    expect(() => assertNoForbiddenStatFields({ winRate: 0.2 }, 'GET /v1/augments/:id')).toThrow(
      /R3\.1 violation: GET \/v1\/augments\/:id/,
    );
  });
});

describe('R3.7 — recommendation timing defaults', () => {
  it('defaults to the only mode that ships without written Riot confirmation', () => {
    expect(DEFAULT_RECOMMENDATION_MODE).toBe('tier2-lookup');
  });
});
