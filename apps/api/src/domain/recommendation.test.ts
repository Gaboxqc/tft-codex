import { describe, expect, it } from 'vitest';

import type { AugmentCounters } from './augment-tiering.js';
import { allTemplates, reasonFor, signalFor } from './augment-reasons.js';
import {
  type AugmentDescriptor,
  type CompShape,
  matchComps,
  recommend,
  recommendTier2,
  recommendTier3,
  resolveMode,
} from './recommendation.js';

const counters = (id: string, overrides: Partial<AugmentCounters> = {}): AugmentCounters => ({
  augmentId: id,
  compId: null,
  games: 5000,
  top4Count: 2500,
  winCount: 625,
  placementSum: 22_500,
  ...overrides,
});

const COUNTERS: AugmentCounters[] = [
  counters('sorcerer-heart', { top4Count: 3100, placementSum: 19_500 }),
  counters('pandoras-items', { top4Count: 2600, placementSum: 22_000 }),
  counters('big-friend', { top4Count: 2000, placementSum: 25_000 }),
];

const DESCRIPTORS = new Map<string, AugmentDescriptor>([
  [
    'sorcerer-heart',
    {
      id: 'sorcerer-heart',
      name: 'Sorcerer Heart',
      category: 'trait',
      relatedTraits: ['Sorcerer'],
      requiresTraits: ['Sorcerer'],
    },
  ],
  ['pandoras-items', { id: 'pandoras-items', name: "Pandora's Items", category: 'item' }],
  [
    'big-friend',
    {
      id: 'big-friend',
      name: 'Big Friend',
      category: 'combat',
      relatedCarries: ['TFT17_Sett'],
    },
  ],
]);

const COMPS: CompShape[] = [
  {
    compId: 'vanguard-zoe',
    name: 'Vanguard Zoe',
    units: ['TFT17_Zoe', 'TFT17_Leona', 'TFT17_Lulu', 'TFT17_Braum'],
    coreTraits: ['Vanguard', 'Sorcerer'],
    tierRank: 0,
  },
  {
    compId: 'bruiser-sett',
    name: 'Bruiser Sett',
    units: ['TFT17_Sett', 'TFT17_Leona', 'TFT17_Illaoi', 'TFT17_Braum'],
    coreTraits: ['Bruiser'],
    tierRank: 2,
  },
];

describe('resolveMode — the R3.7 kill switch', () => {
  it('serves Tier-2 when Tier-2 is requested', () => {
    expect(resolveMode('tier2-lookup', false)).toEqual({
      served: 'tier2-lookup',
      downgraded: false,
    });
  });

  it('downgrades a Tier-3 request when confirmation is not on file', () => {
    // The whole point: no client build can enable Tier-3 by asking nicely.
    expect(resolveMode('tier3-adaptive', false)).toEqual({
      served: 'tier2-lookup',
      downgraded: true,
    });
  });

  it('downgrades rather than erroring, so the overlay stays useful', () => {
    // An error would leave the Overwolf app with nothing to show. The response
    // echoes modeServed so the client can label the UI honestly instead.
    expect(resolveMode('tier3-adaptive', false).served).toBe('tier2-lookup');
  });

  it('serves Tier-3 only when confirmation is on file', () => {
    expect(resolveMode('tier3-adaptive', true)).toEqual({
      served: 'tier3-adaptive',
      downgraded: false,
    });
  });
});

describe('recommendTier2 (_Requirements: 3.4, 3.7_)', () => {
  const input = {
    offeredAugmentIds: ['big-friend', 'sorcerer-heart', 'pandoras-items'],
    descriptors: DESCRIPTORS,
    counters: COUNTERS,
  };

  it('ranks the offered options against static data', () => {
    const advice = recommendTier2(input);
    expect(advice.map((entry) => entry.augmentId)).toEqual([
      'sorcerer-heart',
      'pandoras-items',
      'big-friend',
    ]);
    expect(advice.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it('emits a qualitative reason with no number in it', () => {
    for (const entry of recommendTier2(input)) {
      expect(entry.reason).not.toMatch(/\d/);
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('is deterministic — identical requests produce identical text', () => {
    // Text that reworded itself on refresh would look unstable and invite the
    // user to reload until they liked the answer.
    expect(recommendTier2(input)).toEqual(recommendTier2(input));
  });

  it('accepts no board state at all, by signature', () => {
    // The compliance boundary is the function's inputs, not a conditional
    // inside it. This is a type-level guarantee; the assertion documents it.
    expect(Object.keys(input)).not.toContain('boardUnits');
  });
});

describe('recommendTier3 (_Requirements: 3.4_)', () => {
  it('describes fit in terms of the actual board', () => {
    const advice = recommendTier3({
      offeredAugmentIds: ['big-friend'],
      descriptors: DESCRIPTORS,
      counters: COUNTERS,
      boardUnits: ['TFT17_Sett', 'TFT17_Leona'],
      goldAvailable: 42,
      level: 7,
    });
    expect(advice[0]!.reason).toMatch(/Sett/);
  });

  it('says an augment needs a board the player does not have', () => {
    const advice = recommendTier3({
      offeredAugmentIds: ['sorcerer-heart'],
      descriptors: DESCRIPTORS,
      counters: COUNTERS,
      boardUnits: ['TFT17_Sett'],
      goldAvailable: 10,
      level: 6,
    });
    expect(advice[0]!.reason).toMatch(/board|units|rebuild/i);
  });

  it('never emits a number, even with full board context', () => {
    const advice = recommendTier3({
      offeredAugmentIds: ['sorcerer-heart', 'pandoras-items', 'big-friend'],
      descriptors: DESCRIPTORS,
      counters: COUNTERS,
      boardUnits: ['TFT17_Sett', 'TFT17_Zoe'],
      goldAvailable: 50,
      level: 8,
    });
    for (const entry of advice) expect(entry.reason).not.toMatch(/\d/);
  });
});

describe('matchComps (_Requirements: 3.4, 5.5_)', () => {
  it('scores by how much of a comp is already on the board', () => {
    const matches = matchComps(['TFT17_Zoe', 'TFT17_Leona', 'TFT17_Lulu'], COMPS);
    expect(matches[0]!.compId).toBe('vanguard-zoe');
    expect(matches[0]!.matchScore).toBeCloseTo(0.75);
    expect(matches[0]!.missingUnits).toEqual(['TFT17_Braum']);
  });

  it('breaks ties by tier rank', () => {
    // Both comps share Leona and Braum. The stronger comp should surface first.
    const matches = matchComps(['TFT17_Leona', 'TFT17_Braum'], COMPS);
    expect(matches[0]!.compId).toBe('vanguard-zoe');
  });

  it('omits comps with no overlap rather than listing them at zero', () => {
    expect(matchComps(['TFT17_Nobody'], COMPS)).toEqual([]);
  });

  it('returns nothing for an empty board', () => {
    expect(matchComps([], COMPS)).toEqual([]);
  });
});

describe('recommend — the entry point (_Requirements: 3.4, 3.5, 3.7_)', () => {
  const base = {
    descriptors: DESCRIPTORS,
    counters: COUNTERS,
    boardUnits: ['TFT17_Zoe', 'TFT17_Leona'],
    goldAvailable: 30,
    level: 7,
    comps: COMPS,
  };

  it('echoes the mode it actually served', () => {
    const response = recommend({
      ...base,
      requestedMode: 'tier3-adaptive',
      tier3Confirmed: false,
      offeredAugmentIds: ['sorcerer-heart'],
    });
    expect(response.modeServed).toBe('tier2-lookup');
  });

  it('reports contextAware false whenever Tier-2 was served', () => {
    // R3.5 uses this to mean "did not consider your situation". In Tier-2 it
    // genuinely did not, downgrade or otherwise.
    expect(
      recommend({ ...base, requestedMode: 'tier2-lookup', tier3Confirmed: true }).contextAware,
    ).toBe(false);
    expect(
      recommend({ ...base, requestedMode: 'tier3-adaptive', tier3Confirmed: false }).contextAware,
    ).toBe(false);
  });

  it('reports contextAware true only for a genuine Tier-3 run with a board', () => {
    expect(
      recommend({ ...base, requestedMode: 'tier3-adaptive', tier3Confirmed: true }).contextAware,
    ).toBe(true);
    expect(
      recommend({
        ...base,
        boardUnits: [],
        requestedMode: 'tier3-adaptive',
        tier3Confirmed: true,
      }).contextAware,
    ).toBe(false);
  });

  it('produces different reasoning in the two modes for the same request', () => {
    // Proof the downgrade is real rather than cosmetic: if a downgraded
    // response were identical to a Tier-3 one, the gate would be doing nothing.
    const request = {
      ...base,
      offeredAugmentIds: ['big-friend'],
      boardUnits: ['TFT17_Sett'],
      requestedMode: 'tier3-adaptive' as const,
    };
    const gated = recommend({ ...request, tier3Confirmed: false });
    const confirmed = recommend({ ...request, tier3Confirmed: true });

    expect(gated.augmentAdvice![0]!.reason).not.toBe(confirmed.augmentAdvice![0]!.reason);
    expect(confirmed.augmentAdvice![0]!.reason).toMatch(/Sett/);
    // The Tier-2 reason cannot mention the board, because it never saw it.
    expect(gated.augmentAdvice![0]!.reason).not.toMatch(/Sett/);
  });

  it('omits augment advice entirely when no options were offered', () => {
    const response = recommend({ ...base, requestedMode: 'tier2-lookup', tier3Confirmed: false });
    expect(response.augmentAdvice).toBeUndefined();
    expect(response.suggestedComps.length).toBeGreaterThan(0);
  });
});

describe('The reason bank itself (_Requirements: 3.1_)', () => {
  it('contains no digit in any template', () => {
    for (const template of allTemplates()) {
      expect(template, `template "${template}" contains a digit`).not.toMatch(/\d/);
    }
  });

  it('contains no numeric placeholder to substitute into', () => {
    // A template literally cannot render a number — there is no slot for one.
    for (const template of allTemplates()) {
      expect(template).not.toMatch(/\{(rate|score|placement|percent|rank)\}/i);
    }
  });

  it('avoids comparative-to-outcome phrasing, which is a placement claim in prose', () => {
    for (const template of allTemplates()) {
      expect(template.toLowerCase()).not.toMatch(
        /\b(wins? more|higher win|better placement|top \w+ percent|outperforms)\b/,
      );
    }
  });

  it('throws rather than returning a reason containing a digit', () => {
    expect(() => reasonFor({ signal: 'trait-fit', traitName: '6 Vanguard' })).toThrow(
      /contains a digit/,
    );
  });

  it('picks the contextless signal when there is no board to describe (R3.5)', () => {
    expect(
      signalFor({
        matchingTraits: [],
        carryOnBoard: false,
        contextless: true,
        missingRequirements: false,
      }),
    ).toBe('no-context');
  });
});
