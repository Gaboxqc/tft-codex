import { describe, expect, it } from 'vitest';

import {
  averageCurves,
  biggestShortfall,
  compareCurves,
  firstShortfall,
  roundOrdinal,
  roundReaching,
  sortCurve,
} from './curves.js';

const curve = (entries: [string, number][]) => entries.map(([round, value]) => ({ round, value }));

describe('roundOrdinal (_Requirements: 4.3_)', () => {
  it('orders rounds across stage boundaries', () => {
    // Stage 1 has 3 rounds, every later stage has 7. Getting this wrong makes
    // 2-1 sort before 1-3, which silently misaligns every comparison.
    expect(roundOrdinal('1-1')).toBeLessThan(roundOrdinal('1-3')!);
    expect(roundOrdinal('1-3')).toBeLessThan(roundOrdinal('2-1')!);
    expect(roundOrdinal('2-7')).toBeLessThan(roundOrdinal('3-1')!);
    expect(roundOrdinal('3-2')).toBeLessThan(roundOrdinal('4-1')!);
  });

  it('spaces stages by their real round counts, not evenly', () => {
    // 2-1 is the 4th round of the game, not the 8th.
    expect(roundOrdinal('2-1')).toBe(4);
    expect(roundOrdinal('3-1')).toBe(11);
  });

  it('returns null for an unparseable label rather than guessing', () => {
    // A mislabelled round that sorted somewhere plausible would corrupt every
    // downstream comparison silently.
    expect(roundOrdinal('carousel')).toBeNull();
    expect(roundOrdinal('0-1')).toBeNull();
    expect(roundOrdinal('')).toBeNull();
  });
});

describe('sortCurve', () => {
  it('sorts into true round order and drops unparseable points', () => {
    const sorted = sortCurve(
      curve([
        ['3-1', 7],
        ['1-2', 2],
        ['nonsense', 99],
        ['2-5', 5],
      ]),
    );
    expect(sorted.map((point) => point.round)).toEqual(['1-2', '2-5', '3-1']);
  });
});

describe('averageCurves (_Requirements: 4.3_)', () => {
  it('averages per round, not per index', () => {
    const averaged = averageCurves([
      curve([
        ['2-1', 4],
        ['3-1', 6],
      ]),
      curve([
        ['2-1', 6],
        ['3-1', 8],
      ]),
    ]);
    expect(averaged).toEqual(
      curve([
        ['2-1', 5],
        ['3-1', 7],
      ]),
    );
  });

  it('does not let an early exit drag down the late rounds', () => {
    // A player eliminated at 2-1 has no 4-1 data. Treating that as a zero
    // would understate the baseline exactly where it matters most.
    const averaged = averageCurves([
      curve([['2-1', 4]]),
      curve([
        ['2-1', 4],
        ['4-1', 8],
      ]),
    ]);
    expect(averaged.find((point) => point.round === '4-1')?.value).toBe(8);
  });

  it('returns an empty curve for no input', () => {
    expect(averageCurves([])).toEqual([]);
  });
});

describe('compareCurves (_Requirements: 4.3_)', () => {
  it('pairs by round and reports the delta', () => {
    const deviations = compareCurves(
      curve([
        ['2-1', 4],
        ['3-1', 6],
      ]),
      curve([
        ['2-1', 5],
        ['3-1', 6],
      ]),
    );
    expect(deviations).toEqual([
      { round: '2-1', actual: 4, baseline: 5, delta: -1 },
      { round: '3-1', actual: 6, baseline: 6, delta: 0 },
    ]);
  });

  it('ignores rounds the player never reached', () => {
    // They were eliminated — the placement already says that. Reporting it as
    // a curve deficit double-counts it and yields absurd advice.
    const deviations = compareCurves(
      curve([['2-1', 4]]),
      curve([
        ['2-1', 5],
        ['6-5', 40],
      ]),
    );
    expect(deviations).toHaveLength(1);
  });
});

describe('biggestShortfall (_Requirements: 15.2_)', () => {
  it('measures severity relative to the baseline, not in absolute units', () => {
    // 6 behind when the baseline is 12 is a bigger deal than 10 behind when it
    // is 60. An absolute comparison always points at the late game, where the
    // numbers are simply larger.
    const worst = biggestShortfall([
      { round: '2-1', actual: 6, baseline: 12, delta: -6 },
      { round: '4-5', actual: 50, baseline: 60, delta: -10 },
    ]);
    expect(worst?.round).toBe('2-1');
  });

  it('returns null when the player was never behind', () => {
    // Inventing a "worst moment" for a clean game is advice-shaped noise.
    expect(biggestShortfall([{ round: '2-1', actual: 10, baseline: 8, delta: 2 }])).toBeNull();
  });
});

describe('firstShortfall', () => {
  it('finds the first round meeting the gap threshold, not the largest gap', () => {
    const first = firstShortfall(
      [
        { round: '2-1', actual: 4, baseline: 4, delta: 0 },
        { round: '3-1', actual: 5, baseline: 6, delta: -1 },
        { round: '4-1', actual: 6, baseline: 9, delta: -3 },
      ],
      1,
    );
    expect(first?.round).toBe('3-1');
  });

  it('returns null when nothing crosses the threshold', () => {
    expect(firstShortfall([{ round: '2-1', actual: 4, baseline: 4.5, delta: -0.5 }], 1)).toBeNull();
  });
});

describe('roundReaching', () => {
  it('finds the first round hitting a target level', () => {
    expect(
      roundReaching(
        curve([
          ['3-1', 6],
          ['4-1', 8],
          ['4-5', 9],
        ]),
        8,
      ),
    ).toBe('4-1');
  });

  it('returns null when the target was never reached', () => {
    expect(roundReaching(curve([['3-1', 6]]), 9)).toBeNull();
  });
});
