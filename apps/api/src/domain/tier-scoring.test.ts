import { describe, expect, it } from 'vitest';

import {
  SCORING_WEIGHTS,
  compositeScore,
  isMetaShift,
  normalize,
  percentile,
  scoreComps,
  toRates,
  trendFor,
  type CompCounters,
} from './tier-scoring.js';

const counters = (compId: string, overrides: Partial<CompCounters> = {}): CompCounters => ({
  compId,
  games: 1000,
  top4Count: 500,
  winCount: 125,
  placementSum: 4500,
  ...overrides,
});

describe('toRates', () => {
  it('derives rates from counters', () => {
    const rates = toRates(counters('a'), 10_000);
    expect(rates.avgPlacement).toBe(4.5);
    expect(rates.top4Rate).toBe(0.5);
    expect(rates.winRate).toBe(0.125);
    expect(rates.playRate).toBe(0.1);
  });

  it('divides play rate by participations, not matches', () => {
    // A TFT match has 8 participants. Dividing by match count would give rates
    // summing to 8 and a play-rate term that swamps the other two.
    const rates = toRates(counters('a', { games: 800 }), 8000);
    expect(rates.playRate).toBe(0.1);
  });

  it('returns zeroes rather than NaN for a comp with no games', () => {
    const rates = toRates(counters('a', { games: 0, placementSum: 0, top4Count: 0 }), 0);
    expect(rates.avgPlacement).toBe(0);
    expect(rates.playRate).toBe(0);
  });
});

describe('normalize', () => {
  it('maps a value into 0-1 against the population range', () => {
    expect(normalize(5, 0, 10)).toBe(0.5);
    expect(normalize(-1, 0, 10)).toBe(0);
    expect(normalize(11, 0, 10)).toBe(1);
  });

  it('returns 0.5 for a degenerate range instead of dividing by zero', () => {
    // Every comp identical: nothing distinguishes them, so nothing should be
    // ranked above another.
    expect(normalize(3, 3, 3)).toBe(0.5);
  });
});

describe('percentile', () => {
  it('interpolates between samples', () => {
    expect(percentile([0, 1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([0, 10], 0.9)).toBe(9);
  });

  it('handles empty and single-element inputs', () => {
    expect(percentile([], 0.9)).toBe(0);
    expect(percentile([7], 0.9)).toBe(7);
  });
});

describe('compositeScore (_Requirements: 1.3_)', () => {
  const ranges = {
    top4Rate: { min: 0.4, max: 0.6 },
    avgPlacement: { min: 4, max: 5 },
    playRate: { min: 0, max: 0.2 },
  };

  it('inverts average placement so lower is better', () => {
    // Placement 1 is the best outcome and 8 the worst. A raw min-max would
    // rank the worst comps highest, which is the single easiest way to ship a
    // completely inverted tier list.
    const good = compositeScore(
      { compId: 'a', games: 1, avgPlacement: 4, top4Rate: 0.5, winRate: 0.1, playRate: 0.1 },
      ranges,
    );
    const bad = compositeScore(
      { compId: 'b', games: 1, avgPlacement: 5, top4Rate: 0.5, winRate: 0.1, playRate: 0.1 },
      ranges,
    );
    expect(good).toBeGreaterThan(bad);
  });

  it('weights top-4 rate most heavily, per the published formula', () => {
    const best = compositeScore(
      { compId: 'a', games: 1, avgPlacement: 4, top4Rate: 0.6, winRate: 0, playRate: 0.2 },
      ranges,
    );
    expect(best).toBeCloseTo(
      SCORING_WEIGHTS.top4Rate + SCORING_WEIGHTS.avgPlacement + SCORING_WEIGHTS.playRate,
    );
    expect(SCORING_WEIGHTS.top4Rate).toBeGreaterThan(SCORING_WEIGHTS.avgPlacement);
  });

  it('sums its weights to exactly 1 so the score is bounded', () => {
    const total = Object.values(SCORING_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1);
  });
});

describe('scoreComps (_Requirements: 1.3, 1.4_)', () => {
  const population: CompCounters[] = [
    counters('strong', { top4Count: 620, placementSum: 3900, winCount: 200 }),
    counters('good', { top4Count: 560, placementSum: 4200, winCount: 160 }),
    counters('mid', { top4Count: 500, placementSum: 4500, winCount: 125 }),
    counters('weak', { top4Count: 440, placementSum: 4800, winCount: 90 }),
    counters('bad', { top4Count: 380, placementSum: 5100, winCount: 60 }),
  ];

  it('ranks better comps above worse ones', () => {
    const scored = scoreComps(population, { minSampleSize: 200 });
    const byId = Object.fromEntries(scored.map((comp) => [comp.compId, comp]));

    expect(byId['strong']!.compositeScore).toBeGreaterThan(byId['mid']!.compositeScore);
    expect(byId['mid']!.compositeScore).toBeGreaterThan(byId['bad']!.compositeScore);
    expect(byId['strong']!.tier).toBe('S');
    expect(byId['bad']!.tier).toBe('C');
  });

  it('marks a low-sample comp provisional instead of giving it a tier', () => {
    const scored = scoreComps([...population, counters('newcomer', { games: 12 })], {
      minSampleSize: 200,
    });
    const newcomer = scored.find((comp) => comp.compId === 'newcomer');
    expect(newcomer?.tier).toBe('provisional');
    expect(newcomer?.provisional).toBe(true);
  });

  it('excludes provisional comps from the percentile basis', () => {
    // A handful of 12-game outliers must not drag the thresholds around —
    // that noise is exactly what R1.4 exists to keep out of the tier list.
    const withoutOutlier = scoreComps(population, { minSampleSize: 200 });
    const withOutlier = scoreComps(
      [
        ...population,
        // An absurd 100% top-4 rate on 5 games. If this counted, it would
        // compress every real comp's normalised score.
        counters('outlier', { games: 5, top4Count: 5, placementSum: 5, winCount: 5 }),
      ],
      { minSampleSize: 200 },
    );

    const before = withoutOutlier.find((comp) => comp.compId === 'strong')!;
    const after = withOutlier.find((comp) => comp.compId === 'strong')!;
    expect(after.compositeScore).toBeCloseTo(before.compositeScore);
    expect(after.tier).toBe(before.tier);
  });

  it('marks everything provisional when nothing clears the sample floor', () => {
    const scored = scoreComps(population, { minSampleSize: 1_000_000 });
    expect(scored.every((comp) => comp.tier === 'provisional')).toBe(true);
  });

  it('handles an empty patch without throwing', () => {
    expect(scoreComps([], { minSampleSize: 200 })).toEqual([]);
  });

  it('recomputes thresholds per patch rather than against a fixed bar', () => {
    // Every comp weak in absolute terms, but one still has to be S: a tier
    // means "relative to what is being played right now".
    const weakMeta = population.map((entry) => ({
      ...entry,
      top4Count: Math.round(entry.top4Count * 0.6),
      placementSum: Math.round(entry.placementSum * 1.1),
    }));
    const scored = scoreComps(weakMeta, { minSampleSize: 200 });
    expect(scored.some((comp) => comp.tier === 'S')).toBe(true);
  });
});

describe('isMetaShift (_Requirements: 8.3_)', () => {
  it('flags a move of more than one full tier', () => {
    expect(isMetaShift('S', 'C')).toBe(true);
    expect(isMetaShift('C', 'S')).toBe(true);
  });

  it('does not flag a single-tier move', () => {
    expect(isMetaShift('S', 'A')).toBe(false);
    expect(isMetaShift('B', 'B')).toBe(false);
  });

  it('does not treat crossing the provisional threshold as a meta shift', () => {
    // That means the sample size changed, which says nothing about whether the
    // comp got better or worse.
    expect(isMetaShift('provisional', 'S')).toBe(false);
    expect(isMetaShift('A', 'provisional')).toBe(false);
  });
});

describe('trendFor', () => {
  it('reports direction of movement', () => {
    expect(trendFor('B', 'A')).toBe('rising');
    expect(trendFor('A', 'B')).toBe('falling');
    expect(trendFor('A', 'A')).toBe('stable');
  });

  it('is stable when there is no previous snapshot to compare against', () => {
    expect(trendFor(undefined, 'S')).toBe('stable');
  });
});
