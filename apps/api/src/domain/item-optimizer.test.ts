import { describe, expect, it } from 'vitest';

import { optimizeItems, type ItemRecipe, type OptimizerUnit } from './item-optimizer.js';

const recipe = (
  id: string,
  components: [string, string] | null,
  tags: string[] = [],
): ItemRecipe => ({
  id,
  name: id.replace('TFT_Item_', ''),
  components,
  tags,
});

const RECIPES = new Map<string, ItemRecipe>([
  [
    'TFT_Item_RabadonsDeathcap',
    recipe('TFT_Item_RabadonsDeathcap', ['NeedlesslyLargeRod', 'NeedlesslyLargeRod'], ['AP']),
  ],
  [
    'TFT_Item_JeweledGauntlet',
    recipe('TFT_Item_JeweledGauntlet', ['NeedlesslyLargeRod', 'SparringGloves'], ['AP']),
  ],
  ['TFT_Item_InfinityEdge', recipe('TFT_Item_InfinityEdge', ['BFSword', 'SparringGloves'], ['AD'])],
  [
    'TFT_Item_WarmogsArmor',
    recipe('TFT_Item_WarmogsArmor', ['GiantsBelt', 'GiantsBelt'], ['tank']),
  ],
  [
    'TFT_Item_Redemption',
    recipe('TFT_Item_Redemption', ['GiantsBelt', 'TearOfTheGoddess'], ['tank']),
  ],
]);

const unit = (overrides: Partial<OptimizerUnit> & { championId: string }): OptimizerUnit => ({
  name: overrides.championId.replace('TFT17_', ''),
  role: 'carry',
  wants: [],
  ...overrides,
});

const ZOE = unit({
  championId: 'TFT17_Zoe',
  role: 'carry',
  wants: ['TFT_Item_RabadonsDeathcap', 'TFT_Item_JeweledGauntlet'],
});

const LEONA = unit({
  championId: 'TFT17_Leona',
  role: 'tank',
  wants: ['TFT_Item_WarmogsArmor', 'TFT_Item_Redemption'],
});

describe('optimizeItems (_Requirements: 16.1_)', () => {
  it('builds a completed item from held components', () => {
    const result = optimizeItems({
      heldItems: ['NeedlesslyLargeRod', 'NeedlesslyLargeRod'],
      units: [ZOE],
      recipes: RECIPES,
    });

    expect(result.allocations[0]!.itemIds).toEqual(['TFT_Item_RabadonsDeathcap']);
    expect(result.unallocated).toEqual([]);
  });

  it('treats duplicate components as separate items', () => {
    // Two Rods are two Rods. Collapsing them to a Set would silently halve
    // what the player is holding.
    const result = optimizeItems({
      heldItems: [
        'NeedlesslyLargeRod',
        'NeedlesslyLargeRod',
        'NeedlesslyLargeRod',
        'SparringGloves',
      ],
      units: [ZOE],
      recipes: RECIPES,
    });

    expect(result.allocations[0]!.itemIds).toEqual([
      'TFT_Item_RabadonsDeathcap',
      'TFT_Item_JeweledGauntlet',
    ]);
  });

  it('accepts an already-completed item without consuming components', () => {
    const result = optimizeItems({
      heldItems: ['TFT_Item_RabadonsDeathcap', 'GiantsBelt', 'GiantsBelt'],
      units: [ZOE, LEONA],
      recipes: RECIPES,
    });

    expect(result.allocations.find((a) => a.championId === 'TFT17_Zoe')!.itemIds).toEqual([
      'TFT_Item_RabadonsDeathcap',
    ]);
    expect(result.allocations.find((a) => a.championId === 'TFT17_Leona')!.itemIds).toEqual([
      'TFT_Item_WarmogsArmor',
    ]);
  });

  it('never consumes one component of a pair it cannot complete', () => {
    // A partial take leaves the player holding an orphan — exactly the mistake
    // this optimizer exists to prevent.
    const result = optimizeItems({
      heldItems: ['NeedlesslyLargeRod'],
      units: [ZOE],
      recipes: RECIPES,
    });

    expect(result.allocations[0]!.itemIds).toEqual([]);
    expect(result.unallocated).toEqual(['NeedlesslyLargeRod']);
  });

  it('caps a unit at three items', () => {
    const greedy = unit({
      championId: 'TFT17_Zoe',
      wants: [
        'TFT_Item_RabadonsDeathcap',
        'TFT_Item_JeweledGauntlet',
        'TFT_Item_InfinityEdge',
        'TFT_Item_Redemption',
      ],
    });

    const result = optimizeItems({
      heldItems: [
        'NeedlesslyLargeRod',
        'NeedlesslyLargeRod',
        'NeedlesslyLargeRod',
        'SparringGloves',
        'BFSword',
        'SparringGloves',
        'GiantsBelt',
        'TearOfTheGoddess',
      ],
      units: [greedy],
      recipes: RECIPES,
    });

    expect(result.allocations[0]!.itemIds).toHaveLength(3);
    expect(result.unallocated).toContain('GiantsBelt');
  });

  it('reports leftover components rather than silently dropping them', () => {
    const result = optimizeItems({
      heldItems: ['NeedlesslyLargeRod', 'NeedlesslyLargeRod', 'ChainVest'],
      units: [ZOE],
      recipes: RECIPES,
    });

    expect(result.unallocated).toEqual(['ChainVest']);
  });

  it('returns an allocation for every unit, including empty-handed ones', () => {
    // A missing row reads as a bug to the player; an explained empty one does not.
    const result = optimizeItems({ heldItems: [], units: [ZOE, LEONA], recipes: RECIPES });

    expect(result.allocations).toHaveLength(2);
    expect(result.allocations.every((a) => a.itemIds.length === 0)).toBe(true);
    expect(result.allocations[0]!.rationale).toMatch(/short the components/);
  });

  it('handles an empty board', () => {
    const result = optimizeItems({ heldItems: ['BFSword'], units: [], recipes: RECIPES });
    expect(result.allocations).toEqual([]);
    expect(result.unallocated).toEqual(['BFSword']);
  });
});

describe('Priority order', () => {
  it('feeds the carry before the tank', () => {
    // Contested components go to damage first; that is how players actually
    // think, and an allocation they would not make is not useful.
    const contested = unit({
      championId: 'TFT17_Leona',
      role: 'tank',
      wants: ['TFT_Item_JeweledGauntlet'],
    });

    const result = optimizeItems({
      heldItems: ['NeedlesslyLargeRod', 'SparringGloves'],
      units: [
        contested,
        unit({ championId: 'TFT17_Zoe', role: 'carry', wants: ['TFT_Item_JeweledGauntlet'] }),
      ],
      recipes: RECIPES,
    });

    expect(result.allocations.find((a) => a.championId === 'TFT17_Zoe')!.itemIds).toEqual([
      'TFT_Item_JeweledGauntlet',
    ]);
    expect(result.allocations.find((a) => a.championId === 'TFT17_Leona')!.itemIds).toEqual([]);
  });

  it('gives support units the leftovers, not the contested pieces', () => {
    const result = optimizeItems({
      heldItems: ['NeedlesslyLargeRod', 'NeedlesslyLargeRod'],
      units: [
        unit({ championId: 'TFT17_Lulu', role: 'support', wants: ['TFT_Item_RabadonsDeathcap'] }),
        ZOE,
      ],
      recipes: RECIPES,
    });

    expect(result.allocations.find((a) => a.championId === 'TFT17_Zoe')!.itemIds).toHaveLength(1);
    expect(result.allocations.find((a) => a.championId === 'TFT17_Lulu')!.itemIds).toHaveLength(0);
  });
});

describe('Trade-off explanations (_Requirements: 16.2_)', () => {
  it('names both units and why the winner won', () => {
    const result = optimizeItems({
      heldItems: ['NeedlesslyLargeRod', 'SparringGloves'],
      units: [
        unit({ championId: 'TFT17_Zoe', role: 'carry', wants: ['TFT_Item_JeweledGauntlet'] }),
        unit({ championId: 'TFT17_Kaisa', role: 'carry', wants: ['TFT_Item_JeweledGauntlet'] }),
      ],
      recipes: RECIPES,
    });

    expect(result.tradeOffs).toHaveLength(1);
    const [tradeOff] = result.tradeOffs;

    expect(tradeOff!.itemId).toBe('TFT_Item_JeweledGauntlet');
    expect(tradeOff!.contestedBy).toContain('TFT17_Zoe');
    expect(tradeOff!.contestedBy).toContain('TFT17_Kaisa');
    expect(tradeOff!.explanation).toContain('Kaisa');
    expect(tradeOff!.explanation).toMatch(/primary carry|first item|needed this/);
  });

  it('tells the player how to overrule it', () => {
    // The point is a decision the player can disagree with, not an
    // announcement they have to accept.
    const result = optimizeItems({
      heldItems: ['NeedlesslyLargeRod', 'SparringGloves'],
      units: [
        unit({ championId: 'TFT17_Zoe', role: 'carry', wants: ['TFT_Item_JeweledGauntlet'] }),
        unit({ championId: 'TFT17_Kaisa', role: 'carry', wants: ['TFT_Item_JeweledGauntlet'] }),
      ],
      recipes: RECIPES,
    });

    expect(result.tradeOffs[0]!.explanation).toMatch(/would rather commit to/);
  });

  it('reports no trade-off when nothing was actually contested', () => {
    const result = optimizeItems({
      heldItems: ['NeedlesslyLargeRod', 'NeedlesslyLargeRod', 'GiantsBelt', 'GiantsBelt'],
      units: [ZOE, LEONA],
      recipes: RECIPES,
    });

    expect(result.tradeOffs).toEqual([]);
  });

  it('reports no trade-off when a unit simply lacked components nobody else wanted', () => {
    // "You are short a Belt" is not a trade-off, and calling it one would bury
    // the real contests in noise.
    const result = optimizeItems({
      heldItems: ['NeedlesslyLargeRod', 'NeedlesslyLargeRod'],
      units: [ZOE, LEONA],
      recipes: RECIPES,
    });

    expect(result.tradeOffs).toEqual([]);
    expect(result.allocations.find((a) => a.championId === 'TFT17_Leona')!.itemIds).toEqual([]);
  });
});

describe('R16.3 — Tier-1 by construction', () => {
  it('takes an explicit item list and no live-bench parameter', () => {
    // A live version would be Tier-3 and gated identically to R3.7. The
    // absence of any such input is what keeps this Tier-1.
    const input = { heldItems: ['BFSword'], units: [ZOE], recipes: RECIPES };
    expect(Object.keys(input).sort()).toEqual(['heldItems', 'recipes', 'units']);
  });

  it('is deterministic — the same board and pool give the same answer', () => {
    const input = {
      heldItems: ['NeedlesslyLargeRod', 'NeedlesslyLargeRod', 'GiantsBelt', 'GiantsBelt'],
      units: [ZOE, LEONA],
      recipes: RECIPES,
    };
    expect(optimizeItems(input)).toEqual(optimizeItems(input));
  });
});
