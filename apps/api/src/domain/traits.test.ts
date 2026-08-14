import type { Trait } from '@tft-codex/shared-types';
import { describe, expect, it } from 'vitest';

import {
  activeTraits,
  resolveTraits,
  toTraitCounts,
  type BoardUnit,
  type TraitContext,
} from './traits.js';

const trait = (id: string, breakpoints: number[]): Trait => ({
  id,
  name: id.replace(/^TFT\d*_/, ''),
  type: 'origin',
  breakpoints,
});

const context: TraitContext = {
  traitsByChampion: new Map([
    ['TFT17_Leona', ['Vanguard', 'Radiant']],
    ['TFT17_Braum', ['Vanguard']],
    ['TFT17_Illaoi', ['Vanguard']],
    ['TFT17_Sett', ['Vanguard', 'Bruiser']],
    ['TFT17_Zoe', ['Sorcerer']],
    ['TFT17_Lulu', ['Sorcerer']],
  ]),
  traits: new Map([
    ['Vanguard', trait('Vanguard', [2, 4, 6])],
    ['Sorcerer', trait('Sorcerer', [2, 4, 6])],
    ['Bruiser', trait('Bruiser', [2, 4])],
    ['Radiant', trait('Radiant', [1])],
  ]),
  emblemGrants: new Map([
    ['TFT_Item_VanguardEmblem', 'Vanguard'],
    ['TFT_Item_SorcererEmblem', 'Sorcerer'],
  ]),
};

const board = (...championIds: string[]): BoardUnit[] =>
  championIds.map((championId) => ({ championId }));

const find = (resolved: ReturnType<typeof resolveTraits>, traitId: string) =>
  resolved.find((entry) => entry.traitId === traitId);

describe('resolveTraits (_Requirements: 6.2_)', () => {
  it('counts distinct champions per trait', () => {
    const resolved = resolveTraits(board('TFT17_Leona', 'TFT17_Braum'), context);
    expect(find(resolved, 'Vanguard')?.count).toBe(2);
    expect(find(resolved, 'Vanguard')?.activeBreakpoint).toBe(2);
  });

  it('counts a champion once however many copies are on the board', () => {
    // Two Leonas do not give 2 Vanguard. Every TFT player knows this, and a
    // builder that got it wrong would be discarded immediately.
    const resolved = resolveTraits(board('TFT17_Leona', 'TFT17_Leona'), context);
    expect(find(resolved, 'Vanguard')?.count).toBe(1);
    expect(find(resolved, 'Vanguard')?.activeBreakpoint).toBeNull();
  });

  it('counts a champion toward every trait it has', () => {
    const resolved = resolveTraits(board('TFT17_Sett'), context);
    expect(find(resolved, 'Vanguard')?.count).toBe(1);
    expect(find(resolved, 'Bruiser')?.count).toBe(1);
  });

  it('reports the highest breakpoint reached, not the first', () => {
    const resolved = resolveTraits(
      board('TFT17_Leona', 'TFT17_Braum', 'TFT17_Illaoi', 'TFT17_Sett'),
      context,
    );
    expect(find(resolved, 'Vanguard')?.activeBreakpoint).toBe(4);
    expect(find(resolved, 'Vanguard')?.nextBreakpoint).toBe(6);
  });

  it('keeps sub-breakpoint traits in the panel, marked inactive', () => {
    // "You have 1 Vanguard, one more unlocks it" is the most useful thing the
    // panel says. Dropping inactive traits would hide exactly that.
    const resolved = resolveTraits(board('TFT17_Leona'), context);
    const vanguard = find(resolved, 'Vanguard')!;

    expect(vanguard.count).toBe(1);
    expect(vanguard.activeBreakpoint).toBeNull();
    expect(vanguard.unitsToNext).toBe(1);
  });

  it('flags a trait one unit from its next breakpoint (R6.2)', () => {
    const resolved = resolveTraits(board('TFT17_Leona', 'TFT17_Braum', 'TFT17_Illaoi'), context);
    const vanguard = find(resolved, 'Vanguard')!;

    expect(vanguard.count).toBe(3);
    expect(vanguard.oneAway).toBe(true);
    expect(vanguard.unitsToNext).toBe(1);
  });

  it('reports no next breakpoint once the trait is maxed', () => {
    const resolved = resolveTraits(
      board('TFT17_Leona', 'TFT17_Braum', 'TFT17_Illaoi', 'TFT17_Sett', 'TFT17_Zoe', 'TFT17_Lulu'),
      { ...context, traitsByChampion: allVanguard() },
    );
    const vanguard = find(resolved, 'Vanguard')!;

    expect(vanguard.activeBreakpoint).toBe(6);
    expect(vanguard.nextBreakpoint).toBeNull();
    expect(vanguard.oneAway).toBe(false);
  });

  it('returns nothing for an empty board', () => {
    expect(resolveTraits([], context)).toEqual([]);
  });

  it('falls back to the trait id when the definition is unknown', () => {
    // Static game data lags a patch sometimes; showing a raw id beats crashing
    // the panel a player is actively editing against.
    const resolved = resolveTraits(board('TFT17_Mystery'), {
      ...context,
      traitsByChampion: new Map([['TFT17_Mystery', ['BrandNewTrait']]]),
    });
    expect(find(resolved, 'BrandNewTrait')?.name).toBe('BrandNewTrait');
    expect(find(resolved, 'BrandNewTrait')?.activeBreakpoint).toBeNull();
  });
});

describe('Emblems', () => {
  it('grants a trait the unit does not natively have', () => {
    const resolved = resolveTraits(
      [
        { championId: 'TFT17_Leona' },
        { championId: 'TFT17_Zoe', itemIds: ['TFT_Item_VanguardEmblem'] },
      ],
      context,
    );
    expect(find(resolved, 'Vanguard')?.count).toBe(2);
  });

  it('adds nothing when the unit already has the trait', () => {
    const resolved = resolveTraits(
      [{ championId: 'TFT17_Leona', itemIds: ['TFT_Item_VanguardEmblem'] }],
      context,
    );
    expect(find(resolved, 'Vanguard')?.count).toBe(1);
  });

  it('ignores a non-emblem item', () => {
    const resolved = resolveTraits(
      [{ championId: 'TFT17_Zoe', itemIds: ['TFT_Item_RabadonsDeathcap'] }],
      context,
    );
    expect(find(resolved, 'Vanguard')).toBeUndefined();
  });
});

describe('Panel ordering', () => {
  it('puts one-away traits first, then active ones', () => {
    // A player scanning mid-edit is looking for "what can I turn on now".
    const resolved = resolveTraits(
      board('TFT17_Zoe', 'TFT17_Lulu', 'TFT17_Leona', 'TFT17_Braum', 'TFT17_Illaoi'),
      context,
    );
    expect(resolved[0]!.traitId).toBe('Vanguard');
    expect(resolved[0]!.oneAway).toBe(true);
  });
});

describe('toTraitCounts (_Requirements: 6.4_)', () => {
  it('emits only active traits, matching how real matches are read', () => {
    // detectComp treats a count as evidence the trait is online. Passing
    // inactive counts would match comps the board has not assembled.
    const resolved = resolveTraits(board('TFT17_Leona', 'TFT17_Braum', 'TFT17_Zoe'), context);
    const counts = toTraitCounts(resolved);

    expect(counts).toEqual({ Vanguard: 2, Radiant: 1 });
    expect(counts['Sorcerer']).toBeUndefined();
  });
});

describe('activeTraits', () => {
  it('filters to traits granting a bonus', () => {
    const resolved = resolveTraits(board('TFT17_Leona', 'TFT17_Braum', 'TFT17_Zoe'), context);
    expect(
      activeTraits(resolved)
        .map((entry) => entry.traitId)
        .sort(),
    ).toEqual(['Radiant', 'Vanguard']);
  });
});

function allVanguard(): Map<string, string[]> {
  return new Map(
    ['TFT17_Leona', 'TFT17_Braum', 'TFT17_Illaoi', 'TFT17_Sett', 'TFT17_Zoe', 'TFT17_Lulu'].map(
      (id) => [id, ['Vanguard']],
    ),
  );
}
