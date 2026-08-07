import { describe, expect, it } from 'vitest';

import {
  NARRATIVE_MAX_SENTENCES,
  buildNarrative,
  reviewMatch,
  type MatchReviewInput,
} from './coaching.js';

const curve = (entries: [string, number][]) => entries.map(([round, value]) => ({ round, value }));

/** A game that tracked the baseline closely. */
const cleanGame = (overrides: Partial<MatchReviewInput> = {}): MatchReviewInput => ({
  placement: 3,
  compName: 'Vanguard Zoe',
  levelCurve: curve([
    ['2-1', 4],
    ['3-2', 6],
    ['4-1', 8],
  ]),
  goldCurve: curve([
    ['2-1', 12],
    ['3-2', 32],
    ['4-1', 50],
  ]),
  baselineLevelCurve: curve([
    ['2-1', 4],
    ['3-2', 6],
    ['4-1', 8],
  ]),
  baselineGoldCurve: curve([
    ['2-1', 12],
    ['3-2', 32],
    ['4-1', 50],
  ]),
  ...overrides,
});

describe('reviewMatch (_Requirements: 4.5_)', () => {
  it('always produces at least one suggestion', () => {
    // R4.5 is unconditional: every reviewed match gets something actionable.
    expect(reviewMatch(cleanGame()).suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('names the round where leveling first slipped, not where the gap peaked', () => {
    // The first slip is the decision; the peak is its consequence several
    // rounds later. Pointing at the consequence is how advice becomes useless.
    const review = reviewMatch(
      cleanGame({
        levelCurve: curve([
          ['2-1', 4],
          ['3-2', 5],
          ['4-1', 6],
        ]),
      }),
    );

    const leveling = review.suggestions.find((s) => s.signal === 'leveling-timing');
    expect(leveling?.round).toBe('3-2');
    expect(review.keyDeviationRound).toBe('3-2');
  });

  it('cites the actual level-8 timings when both sides reached it', () => {
    const review = reviewMatch(
      cleanGame({
        levelCurve: curve([
          ['2-1', 4],
          ['3-2', 5],
          ['4-5', 8],
        ]),
        baselineLevelCurve: curve([
          ['2-1', 4],
          ['3-2', 6],
          ['4-1', 8],
        ]),
      }),
    );

    const leveling = review.suggestions.find((s) => s.signal === 'leveling-timing');
    expect(leveling?.message).toContain('level 8 at 4-5');
    expect(leveling?.message).toContain('4-1');
  });

  it('flags an econ dip with the concrete gold numbers from that round', () => {
    const review = reviewMatch(
      cleanGame({
        goldCurve: curve([
          ['2-1', 12],
          ['3-2', 4],
          ['4-1', 50],
        ]),
      }),
    );

    const econ = review.suggestions.find((s) => s.signal === 'econ-deviation');
    expect(econ?.round).toBe('3-2');
    expect(econ?.message).toContain('4 at 3-2');
    expect(econ?.message).toContain('32');
  });

  it('ignores an econ wobble too small to be worth mentioning', () => {
    const review = reviewMatch(
      cleanGame({
        goldCurve: curve([
          ['2-1', 12],
          ['3-2', 28],
          ['4-1', 50],
        ]),
      }),
    );
    expect(review.suggestions.find((s) => s.signal === 'econ-deviation')).toBeUndefined();
  });

  it('flags incomplete itemisation with the shortfall', () => {
    const review = reviewMatch(cleanGame({ completedItemCount: 3, expectedItemCount: 5 }));
    const items = review.suggestions.find((s) => s.signal === 'itemization-completeness');
    expect(items?.message).toContain('3 completed items');
    expect(items?.message).toContain('2 component pairs');
  });

  it('headlines leveling over econ, because leveling is upstream', () => {
    // Falling behind on level often causes the gold dip that follows.
    const review = reviewMatch(
      cleanGame({
        levelCurve: curve([
          ['2-1', 4],
          ['3-2', 5],
          ['4-1', 6],
        ]),
        goldCurve: curve([
          ['2-1', 12],
          ['3-2', 2],
          ['4-1', 50],
        ]),
      }),
    );
    expect(review.suggestions[0]!.signal).toBe('leveling-timing');
  });

  it('is honest when nothing went wrong rather than inventing a fault', () => {
    const review = reviewMatch(cleanGame());
    expect(review.keyDeviationRound).toBeNull();
    expect(review.suggestions[0]!.message).toMatch(/tracked the top-4 baseline/);
  });

  it('gives different closing advice for a top-4 than for a bottom-4 clean game', () => {
    expect(reviewMatch(cleanGame({ placement: 2 })).suggestions[0]!.message).toMatch(
      /positioning and item choice/,
    );
    expect(reviewMatch(cleanGame({ placement: 7 })).suggestions[0]!.message).toMatch(
      /did not come from leveling or econ/,
    );
  });
});

describe('buildNarrative (_Requirements: 15.1, 15.2_)', () => {
  const sentenceCount = (text: string) => text.split(/(?<=\.)\s+/).filter(Boolean).length;

  it('stays inside the 3-5 sentence budget even when every signal fires', () => {
    // Suggestion messages are two sentences each, so a naive "one suggestion,
    // one sentence" assembly overruns the limit. The budget is enforced by
    // construction rather than by trimming afterwards.
    const input = cleanGame({
      levelCurve: curve([
        ['2-1', 4],
        ['3-2', 5],
        ['4-1', 6],
      ]),
      goldCurve: curve([
        ['2-1', 12],
        ['3-2', 2],
        ['4-1', 50],
      ]),
      completedItemCount: 2,
      expectedItemCount: 5,
    });
    const count = sentenceCount(buildNarrative(input, reviewMatch(input)));

    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(NARRATIVE_MAX_SENTENCES);
  });

  it('stays inside the budget for a clean game too', () => {
    const input = cleanGame();
    const count = sentenceCount(buildNarrative(input, reviewMatch(input)));
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(NARRATIVE_MAX_SENTENCES);
  });

  it('cites the specific round of the biggest deviation', () => {
    const input = cleanGame({
      levelCurve: curve([
        ['2-1', 4],
        ['3-2', 5],
        ['4-1', 6],
      ]),
    });
    expect(buildNarrative(input, reviewMatch(input))).toContain('3-2');
  });

  it('opens with the placement and the detected comp', () => {
    const input = cleanGame({ placement: 2 });
    expect(buildNarrative(input, reviewMatch(input))).toMatch(
      /^You finished 2nd on Vanguard Zoe\./,
    );
  });

  it('says so plainly when the comp was not recognised', () => {
    const input = cleanGame({ compName: null });
    expect(buildNarrative(input, reviewMatch(input))).toContain('an untracked board');
  });

  it('handles a win without calling it a finish', () => {
    const input = cleanGame({ placement: 1 });
    expect(buildNarrative(input, reviewMatch(input))).toMatch(/^You won this one/);
  });
});

describe('R3.1 / R4.7 — coaching never surfaces augment outcome data', () => {
  it('produces no augment win rate or placement-by-augment claim', () => {
    // R4.7 gates "your placement broken down by augment picked" on Riot's
    // written answer (task 3.12). Until that lands, nothing here may imply it —
    // the augment-fit signal talks about board fit, never outcome.
    const input = cleanGame({
      levelCurve: curve([
        ['2-1', 4],
        ['3-2', 5],
        ['4-1', 6],
      ]),
      completedItemCount: 2,
      expectedItemCount: 5,
    });
    const review = reviewMatch(input);
    const text = [buildNarrative(input, review), ...review.suggestions.map((s) => s.message)]
      .join(' ')
      .toLowerCase();

    expect(text).not.toMatch(/win rate|winrate/);
    expect(text).not.toMatch(/average placement|avg placement/);
    // No "augment X placed you Nth" shape.
    expect(text).not.toMatch(/augment.{0,40}(placement|placed|win)/);
  });
});
