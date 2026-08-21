import { describe, expect, it } from 'vitest';

import {
  ESTIMATE_FORMULA_VERSION,
  ESTIMATE_WEIGHTS,
  estimateBoard,
  type EstimateUnit,
} from './board-estimate.js';

const unit = (overrides: Partial<EstimateUnit> = {}): EstimateUnit => ({
  championId: 'TFT17_Zoe',
  cost: 4,
  starLevel: 2,
  role: 'carry',
  completedItems: 0,
  ...overrides,
});

const board = (count: number, overrides: Partial<EstimateUnit> = {}): EstimateUnit[] =>
  Array.from({ length: count }, (_, index) => unit({ championId: `unit-${index}`, ...overrides }));

describe('estimateBoard (_Requirements: 6.1_)', () => {
  it('scores a stronger board above a weaker one', () => {
    const weak = estimateBoard({
      units: board(6, { cost: 1, starLevel: 1 }),
      activeBreakpoints: [2],
      level: 6,
    });
    const strong = estimateBoard({
      units: board(6, { cost: 5, starLevel: 2, completedItems: 1 }),
      activeBreakpoints: [6, 4],
      level: 6,
    });

    expect(strong.index).toBeGreaterThan(weak.index);
  });

  it('rewards a deep breakpoint over several shallow ones', () => {
    // 6 Vanguard beats three separate 2-traits. A linear sum would say the
    // opposite, which is the wrong advice for a builder to give.
    const deep = estimateBoard({ units: board(6), activeBreakpoints: [6], level: 6 });
    const shallow = estimateBoard({
      units: board(6),
      activeBreakpoints: [2, 2, 2],
      level: 6,
    });

    expect(deep.index).toBeGreaterThan(shallow.index);
  });

  it('normalises for level so a small board is judged against its own size', () => {
    // Otherwise the estimate just tells the player "more units is better",
    // which they already know.
    const early = estimateBoard({ units: board(5), activeBreakpoints: [4], level: 5 });
    const late = estimateBoard({ units: board(5), activeBreakpoints: [4], level: 9 });

    expect(early.index).toBeGreaterThan(late.index);
  });

  it('stays inside 0-100', () => {
    const absurd = estimateBoard({
      units: board(10, { cost: 5, starLevel: 3, completedItems: 3 }),
      activeBreakpoints: [10, 8, 6, 6],
      level: 10,
    });

    expect(absurd.index).toBeLessThanOrEqual(100);
    expect(absurd.index).toBeGreaterThanOrEqual(0);
  });

  it('returns zero for an empty board without dividing by zero', () => {
    const empty = estimateBoard({ units: [], activeBreakpoints: [], level: 1 });
    expect(empty.index).toBe(0);
    expect(empty.caveats).toContain('Empty board.');
  });

  it('ships the formula version with every result', () => {
    // A stored estimate has to be readable in the context of the formula that
    // produced it, the same way tier snapshots carry theirs.
    expect(
      estimateBoard({ units: board(4), activeBreakpoints: [2], level: 4 }).formulaVersion,
    ).toBe(ESTIMATE_FORMULA_VERSION);
  });

  it('sums its published weights to 1', () => {
    const total = Object.values(ESTIMATE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1);
  });
});

describe('Shape sub-scores', () => {
  it('reports a front-loaded board as high frontline, low damage', () => {
    const estimate = estimateBoard({
      units: board(6, { role: 'tank' }),
      activeBreakpoints: [4],
      level: 6,
    });

    expect(estimate.frontline).toBeGreaterThan(estimate.damage);
    expect(estimate.damage).toBe(0);
  });

  it('reports a back-loaded board as high damage, low frontline', () => {
    const estimate = estimateBoard({
      units: board(6, { role: 'carry' }),
      activeBreakpoints: [4],
      level: 6,
    });

    expect(estimate.damage).toBeGreaterThan(estimate.frontline);
    expect(estimate.frontline).toBe(0);
  });
});

describe('Honesty (_Requirements: 6.1, design.md §1 non-goals_)', () => {
  it('never claims high confidence, because this is a heuristic', () => {
    const best = estimateBoard({
      units: board(9, { cost: 5, starLevel: 3, completedItems: 3 }),
      activeBreakpoints: [8, 6],
      level: 9,
    });
    expect(['low', 'medium']).toContain(best.confidence);
  });

  it('drops to low confidence when the board has 1-star units', () => {
    const unstarred = estimateBoard({
      units: [...board(5, { starLevel: 2 }), unit({ starLevel: 1 })],
      activeBreakpoints: [4],
      level: 6,
    });
    expect(unstarred.confidence).toBe('low');
  });

  it('always states that it does not model a fight', () => {
    const estimate = estimateBoard({ units: board(6), activeBreakpoints: [4], level: 6 });
    expect(estimate.caveats[0]).toMatch(/not modelled|shape check/);
  });

  it('warns about a board with no front line', () => {
    const estimate = estimateBoard({
      units: board(6, { role: 'carry' }),
      activeBreakpoints: [4],
      level: 6,
    });
    expect(estimate.caveats.some((c) => /front line/i.test(c))).toBe(true);
  });

  it('warns about a board with no damage', () => {
    const estimate = estimateBoard({
      units: board(6, { role: 'tank' }),
      activeBreakpoints: [4],
      level: 6,
    });
    expect(estimate.caveats.some((c) => /cannot close a round/i.test(c))).toBe(true);
  });

  it('warns when no trait is active at all', () => {
    const estimate = estimateBoard({ units: board(6), activeBreakpoints: [], level: 6 });
    expect(estimate.caveats.some((c) => /No trait is active/i.test(c))).toBe(true);
  });

  it('points out unused board slots', () => {
    const estimate = estimateBoard({ units: board(5), activeBreakpoints: [4], level: 8 });
    expect(estimate.caveats.some((c) => /room for 3 more units/.test(c))).toBe(true);
  });

  it('exposes no placement or win-rate prediction', () => {
    // R6.1 and design.md §1: an estimate, not a simulator, and certainly not a
    // forecast dressed up as one.
    const estimate = estimateBoard({ units: board(6), activeBreakpoints: [4], level: 6 });
    expect(Object.keys(estimate).sort()).toEqual(
      ['caveats', 'confidence', 'damage', 'formulaVersion', 'frontline', 'index'].sort(),
    );
  });
});
