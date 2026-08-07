import { describe, expect, it } from 'vitest';

import { type AugmentCounters, rankOfferedAugments, tierAugments } from './augment-tiering.js';

const counters = (
  augmentId: string,
  overrides: Partial<AugmentCounters> = {},
): AugmentCounters => ({
  augmentId,
  compId: null,
  games: 5000,
  top4Count: 2500,
  winCount: 625,
  placementSum: 22_500,
  ...overrides,
});

const population: AugmentCounters[] = [
  counters('strong', { top4Count: 3100, placementSum: 19_500 }),
  counters('good', { top4Count: 2800, placementSum: 21_000 }),
  counters('mid', { top4Count: 2500, placementSum: 22_500 }),
  counters('weak', { top4Count: 2200, placementSum: 24_000 }),
  counters('bad', { top4Count: 1900, placementSum: 25_500 }),
];

describe('tierAugments (_Requirements: 3.1, 3.2, 3.3_)', () => {
  const options = { minSampleSize: 500, totalPicks: 100_000 };

  it('returns only a letter, a play rate and a provisional flag', () => {
    // The public record must have no field that could be inverted back into a
    // win rate or placement. Asserting the exact key set is the check.
    const [first] = tierAugments(population, options);
    expect(Object.keys(first!).sort()).toEqual(
      ['augmentId', 'playRate', 'provisional', 'tier'].sort(),
    );
  });

  it('ranks better augments into better tiers', () => {
    const byId = Object.fromEntries(
      tierAugments(population, options).map((augment) => [augment.augmentId, augment]),
    );
    expect(byId['strong']!.tier).toBe('S');
    expect(byId['bad']!.tier).toBe('C');
  });

  it('computes play rate against total picks (R3.3)', () => {
    const [augment] = tierAugments([counters('a', { games: 9400 })], {
      minSampleSize: 500,
      totalPicks: 100_000,
    });
    expect(augment!.playRate).toBeCloseTo(0.094);
  });

  it('still assigns a letter to a thin-sample augment, but flags it', () => {
    // Unlike a comp, an augment with no grade is worse than a cautious one —
    // the player has to pick something this round. The flag lets the UI hedge.
    const result = tierAugments([...population, counters('rare', { games: 40 })], options);
    const rare = result.find((augment) => augment.augmentId === 'rare')!;
    expect(rare.provisional).toBe(true);
    expect(['S', 'A', 'B', 'C']).toContain(rare.tier);
  });

  it('ignores per-comp rows when building the global tier list', () => {
    // Per-comp rows exist for the recommendation engine. Letting them into the
    // global list would count popular comps' augments repeatedly.
    const withScoped = [
      ...population,
      counters('strong', { compId: 'vanguard-zoe', games: 900, top4Count: 800 }),
    ];
    expect(tierAugments(withScoped, options)).toHaveLength(population.length);
  });

  it('handles an empty patch without throwing', () => {
    expect(tierAugments([], options)).toEqual([]);
  });
});

describe('rankOfferedAugments (_Requirements: 3.4, 3.7_)', () => {
  it('orders only the options offered, best first', () => {
    // This is the Tier-2 primitive: a filter over static data by the options
    // presented, not a function of the board.
    const ranked = rankOfferedAugments(['bad', 'strong', 'mid'], population);
    expect(ranked.map((entry) => entry.augmentId)).toEqual(['strong', 'mid', 'bad']);
  });

  it('returns an entry for an unknown augment rather than dropping it', () => {
    // A player was offered three options; returning two would look like a bug
    // to them and leave the UI with a hole.
    const ranked = rankOfferedAugments(['strong', 'brand-new'], population);
    expect(ranked).toHaveLength(2);
    expect(ranked.find((entry) => entry.augmentId === 'brand-new')?.games).toBe(0);
  });

  it('prefers a comp-scoped row over the global one when scoping is requested', () => {
    // "Good in this comp" is a better signal than "good overall".
    const scoped = [
      ...population,
      counters('mid', { compId: 'vanguard-zoe', games: 1200, top4Count: 900, placementSum: 4200 }),
    ];
    const ranked = rankOfferedAugments(['mid'], scoped, { compId: 'vanguard-zoe' });
    expect(ranked[0]!.compId).toBe('vanguard-zoe');
  });

  it('falls back to global data when the comp has no row for an augment', () => {
    const ranked = rankOfferedAugments(['strong'], population, { compId: 'vanguard-zoe' });
    expect(ranked[0]!.compId).toBeNull();
    expect(ranked[0]!.games).toBeGreaterThan(0);
  });
});
