import type { CompTier, TierListEntry } from '@tft-codex/shared-types';
import { describe, expect, it } from 'vitest';

import { describeChange, diffSnapshots } from './snapshot-diff.js';

const entry = (compId: string, tier: CompTier): TierListEntry => ({
  compId,
  name: compId.replace(/-/g, ' '),
  tier,
  trend: 'stable',
  playstyle: 'Standard',
  difficulty: 'Medium',
  coreTraits: [],
  carries: [],
  compositeScore: 0.5,
  stats: {
    avgPlacement: 4.5,
    top4Rate: 0.5,
    winRate: 0.12,
    playRate: 0.05,
    sampleSize: 1000,
    computedAt: '2026-08-14T00:00:00.000Z',
  },
  metaShift: false,
});

describe('diffSnapshots (_Requirements: 8.3_)', () => {
  it('reports a single-tier move as a change but not a meta shift', () => {
    // R8.3 says "more than one full tier" — S to A is movement, not a shift.
    const diff = diffSnapshots([entry('vanguard-zoe', 'S')], [entry('vanguard-zoe', 'A')]);

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]!.trend).toBe('falling');
    expect(diff.metaShifts).toHaveLength(0);
  });

  it('flags a move of more than one tier as a meta shift', () => {
    const diff = diffSnapshots([entry('vanguard-zoe', 'S')], [entry('vanguard-zoe', 'C')]);

    expect(diff.metaShifts).toHaveLength(1);
    expect(diff.metaShifts[0]!.from).toBe('S');
    expect(diff.metaShifts[0]!.to).toBe('C');
  });

  it('ignores a comp whose tier did not change', () => {
    const diff = diffSnapshots([entry('vanguard-zoe', 'A')], [entry('vanguard-zoe', 'A')]);
    expect(diff.changed).toEqual([]);
  });

  it('reports a new comp as added, not as having fallen from nowhere', () => {
    // A comp appearing for the first time at C has crossed the sample
    // threshold, not fallen. Treating it as a fall would produce a stream of
    // false meta shifts every time the registry grows.
    const diff = diffSnapshots([], [entry('brand-new', 'C')]);

    expect(diff.added).toHaveLength(1);
    expect(diff.changed).toEqual([]);
    expect(diff.metaShifts).toEqual([]);
  });

  it('reports a comp that dropped out of the list as removed', () => {
    const diff = diffSnapshots([entry('gone', 'B')], []);

    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]!.compId).toBe('gone');
    expect(diff.changed).toEqual([]);
  });

  it('does not treat crossing the provisional threshold as a meta shift', () => {
    // That means the sample size changed, which says nothing about whether the
    // comp got better or worse.
    const up = diffSnapshots([entry('newcomer', 'provisional')], [entry('newcomer', 'S')]);
    const down = diffSnapshots([entry('faded', 'A')], [entry('faded', 'provisional')]);

    expect(up.metaShifts).toEqual([]);
    expect(down.metaShifts).toEqual([]);
    // Still worth reporting as a change, just not as a shift.
    expect(up.changed).toHaveLength(1);
    expect(down.changed).toHaveLength(1);
  });

  it('handles two empty snapshots', () => {
    expect(diffSnapshots([], [])).toEqual({
      changed: [],
      metaShifts: [],
      added: [],
      removed: [],
    });
  });
});

describe('describeChange (_Requirements: 8.3, 9.1_)', () => {
  const change = (from: CompTier, to: CompTier) =>
    diffSnapshots([entry('vanguard-zoe', from)], [entry('vanguard-zoe', to)]).changed[0]!;

  it('names the comp and both tiers', () => {
    const text = describeChange(change('B', 'A'));
    expect(text).toContain('vanguard zoe');
    expect(text).toContain('B');
    expect(text).toContain('A');
    expect(text).toContain('up');
  });

  it('calls out a meta shift as a bigger-than-usual swing', () => {
    expect(describeChange(change('S', 'C'))).toMatch(/bigger swing/);
  });

  it('explains entering from provisional as a sample threshold, not a promotion', () => {
    expect(describeChange(change('provisional', 'A'))).toMatch(/enough games now/);
  });

  it('explains falling to provisional as a sample threshold, not a demotion', () => {
    expect(describeChange(change('A', 'provisional'))).toMatch(/below the sample threshold/);
  });
});
