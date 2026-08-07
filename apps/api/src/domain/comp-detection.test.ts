import type { CompSignature } from '@tft-codex/shared-types';
import { describe, expect, it } from 'vitest';

import {
  boardFromParticipant,
  detectComp,
  scoreSignature,
  type BoardState,
} from './comp-detection.js';

const vanguardZoe: CompSignature = {
  compId: 'vanguard-zoe',
  patch: '17.9',
  coreTraits: ['Vanguard', 'Sorcerer'],
  minTraitCounts: { Vanguard: 4, Sorcerer: 4 },
  carryChampionIds: ['TFT17_Zoe'],
};

const vanguardJinx: CompSignature = {
  compId: 'vanguard-jinx',
  patch: '17.9',
  coreTraits: ['Vanguard', 'Sniper'],
  minTraitCounts: { Vanguard: 4, Sniper: 2 },
  carryChampionIds: ['TFT17_Jinx'],
};

/** A broader signature that overlaps Vanguard Zoe's trait core. */
const vanguardFlex: CompSignature = {
  compId: 'vanguard-flex',
  patch: '17.9',
  coreTraits: ['Vanguard'],
  minTraitCounts: { Vanguard: 4 },
  carryChampionIds: ['TFT17_Zoe', 'TFT17_Jinx', 'TFT17_Kaisa'],
};

const board = (overrides: Partial<BoardState> = {}): BoardState => ({
  traitCounts: { Vanguard: 4, Sorcerer: 4 },
  championIds: ['TFT17_Zoe', 'TFT17_Leona', 'TFT17_Lulu'],
  ...overrides,
});

describe('scoreSignature (_Requirements: 1.3, 4.2_)', () => {
  it('rejects a board missing a core trait minimum outright', () => {
    // A 2-Vanguard board is not a weak 4-Vanguard comp, it is a different comp.
    expect(
      scoreSignature(board({ traitCounts: { Vanguard: 2, Sorcerer: 4 } }), vanguardZoe),
    ).toBeNull();
  });

  it('rejects a board with the traits but none of the designated carries', () => {
    // Without this, every trait-sharing comp collapses into whichever
    // signature happened to be checked first.
    expect(
      scoreSignature(board({ championIds: ['TFT17_Leona', 'TFT17_Lulu'] }), vanguardZoe),
    ).toBeNull();
  });

  it('scores a board that hits every minimum with the carry present', () => {
    // 0.875: full carry credit (0.5) plus the base trait credit for meeting
    // every minimum exactly (0.5 × 0.75). Headroom above this is reserved for
    // boards that went deeper than the signature requires.
    const score = scoreSignature(board(), vanguardZoe);
    expect(score).toBeCloseTo(0.875);
  });

  it('rewards exceeding a trait minimum, but not without limit', () => {
    const exact = scoreSignature(board(), vanguardZoe)!;
    const deep = scoreSignature(board({ traitCounts: { Vanguard: 6, Sorcerer: 6 } }), vanguardZoe)!;
    expect(deep).toBeGreaterThanOrEqual(exact);
    expect(deep).toBeLessThanOrEqual(1);
  });

  it('treats a starred-up carry as evidence of intent, but not decisively', () => {
    const oneStar = scoreSignature(board({ starLevels: { TFT17_Zoe: 1 } }), vanguardZoe)!;
    const threeStar = scoreSignature(board({ starLevels: { TFT17_Zoe: 3 } }), vanguardZoe)!;
    expect(threeStar).toBeGreaterThan(oneStar);
    expect(threeStar - oneStar).toBeLessThanOrEqual(0.1);
  });
});

describe('detectComp (_Requirements: 1.3, 4.2_)', () => {
  const registry = [vanguardZoe, vanguardJinx, vanguardFlex];

  it('distinguishes two comps that share a trait core by their carry', () => {
    // "Vanguard Zoe" and "Vanguard Jinx" have overlapping trait signatures and
    // completely different game plans. Getting this wrong produces a tier list
    // that looks plausible and is wrong.
    const zoe = detectComp(
      { traitCounts: { Vanguard: 4, Sorcerer: 4 }, championIds: ['TFT17_Zoe', 'TFT17_Leona'] },
      registry,
    );
    const jinx = detectComp(
      { traitCounts: { Vanguard: 4, Sniper: 2 }, championIds: ['TFT17_Jinx', 'TFT17_Leona'] },
      registry,
    );

    expect(zoe?.compId).toBe('vanguard-zoe');
    expect(jinx?.compId).toBe('vanguard-jinx');
  });

  it('prefers the more specific signature over a broad one that also matches', () => {
    // Both vanguard-zoe and vanguard-flex match this board. The specific one
    // must win, or generic comps swallow their own specialisations.
    const match = detectComp(
      { traitCounts: { Vanguard: 4, Sorcerer: 4 }, championIds: ['TFT17_Zoe'] },
      registry,
    );
    expect(match?.compId).toBe('vanguard-zoe');
  });

  it('returns null for an unrecognised board rather than force-fitting it', () => {
    // Unmatched boards feed the new-comp editorial queue (design.md §3). A
    // forced assignment would silently pollute the tier list instead.
    const match = detectComp(
      { traitCounts: { Bruiser: 6 }, championIds: ['TFT17_Sett'] },
      registry,
    );
    expect(match).toBeNull();
  });

  it('returns null against an empty registry', () => {
    expect(detectComp(board(), [])).toBeNull();
  });
});

describe('boardFromParticipant', () => {
  it('ignores traits that are on the board but inactive', () => {
    // tier_current === 0 means no breakpoint was hit. Counting those would
    // match comps the player never actually had.
    const state = boardFromParticipant({
      traits: [
        { name: 'Vanguard', num_units: 4, tier_current: 2 },
        { name: 'Sorcerer', num_units: 1, tier_current: 0 },
      ],
      units: [
        { character_id: 'TFT17_Leona', tier: 2 },
        { character_id: 'TFT17_Zoe', tier: 3 },
      ],
    });

    expect(state.traitCounts).toEqual({ Vanguard: 4 });
    expect(state.championIds).toEqual(['TFT17_Leona', 'TFT17_Zoe']);
    expect(state.starLevels).toEqual({ TFT17_Leona: 2, TFT17_Zoe: 3 });
  });

  it('keeps the highest star level when a champion appears twice', () => {
    const state = boardFromParticipant({
      traits: [],
      units: [
        { character_id: 'TFT17_Zoe', tier: 1 },
        { character_id: 'TFT17_Zoe', tier: 2 },
      ],
    });
    expect(state.starLevels?.['TFT17_Zoe']).toBe(2);
  });
});
