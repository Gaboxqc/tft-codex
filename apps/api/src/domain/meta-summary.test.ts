/**
 * Meta-summary prompt and draft-guard tests (task 6.2).
 *
 * _Requirements: 8.1, 8.2, 3.1_
 */
import { describe, expect, it } from 'vitest';

import {
  buildSummaryPrompt,
  hasEnoughToSay,
  MAX_DRAFT_SENTENCES,
  validateDraft,
  type MetaSummaryFacts,
} from './meta-summary.js';

const FACTS: MetaSummaryFacts = {
  patch: '17.9',
  setName: 'Into the Arcane',
  balanceChanges: [
    {
      entityType: 'champion',
      entityId: 'TFT17_Sett',
      summary: 'Sett shop cost increased from 4 to 5.',
      source: 'data-dragon',
    },
  ],
  tierMovements: [{ compId: 'vanguard-zoe', compName: 'Vanguard Zoe', from: 'S', to: 'B' }],
  newComps: [{ compId: 'bruiser-sett', compName: 'Bruiser Sett', tier: 'A' }],
};

const ok = (draft: string) => validateDraft(draft, FACTS);

describe('Prompt construction (_Requirements: 8.2, 3.1_)', () => {
  it('includes the balance changes, tier moves and new comps', () => {
    const { user } = buildSummaryPrompt(FACTS);

    expect(user).toContain('Sett shop cost increased');
    expect(user).toContain('Vanguard Zoe moved from S tier to B tier');
    expect(user).toContain('Bruiser Sett entered at A tier');
  });

  it('carries no augment data at all', () => {
    // R3.1 structurally: a model cannot leak an augment statistic it was never
    // shown. This is the guarantee the output guard is a second layer on.
    const { system, user } = buildSummaryPrompt({
      ...FACTS,
      balanceChanges: [
        {
          entityType: 'augment',
          entityId: 'TFT17_Augment_Portable',
          summary: 'Grants more gold.',
          source: 'editorial',
        },
      ],
    });

    // The augment balance record itself is game data and may appear; what must
    // never appear is a performance figure. Assert the prompt asks for none.
    expect(system).toContain('Never mention augments');
    expect(user).not.toMatch(/win rate|placement|pick rate/i);
  });

  it('says so explicitly when a section is empty', () => {
    const { user } = buildSummaryPrompt({
      ...FACTS,
      tierMovements: [],
      newComps: [],
      balanceChanges: [],
    });

    expect(user).toContain('None recorded.');
    expect(user).toContain('None.');
  });

  it('tells the model its output is a draft a human will read', () => {
    // R8.2's approval step only works if the drafter is not writing final copy.
    expect(buildSummaryPrompt(FACTS).system).toContain('draft');
  });
});

describe('Draft guards (_Requirements: 8.2, 3.1_)', () => {
  it('accepts a plain grounded summary', () => {
    const result = ok('Vanguard Zoe lost ground this patch. Bruiser Sett arrives to fill the gap.');
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it('allows the patch id even though it contains digits', () => {
    expect(ok('Patch 17.9 pushed Vanguard Zoe down a tier.').ok).toBe(true);
  });

  it('rejects an invented statistic', () => {
    // The failure this prevents: a number with no provenance sitting in the
    // same paragraph as numbers that have one.
    const result = ok('Vanguard Zoe fell to a 4.2 average placement.');

    expect(result.ok).toBe(false);
    expect(result.problems).toContain('Contains a number that is not the patch id.');
  });

  it('rejects a percentage', () => {
    const result = ok('Vanguard Zoe now wins 12% less often.');
    expect(result.problems).toContain('Contains a percentage.');
  });

  it('rejects any mention of augments', () => {
    const result = ok('Vanguard Zoe dropped, and the augment pool shifted with it.');
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/augment/i);
  });

  it('rejects a named augment even without the word "augment"', () => {
    const result = validateDraft('Vanguard Zoe fell once Portable Forge arrived.', FACTS, {
      augmentNames: ['Portable Forge'],
    });

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('Portable Forge');
  });

  it('ignores augment names too short to match safely', () => {
    // A three-letter augment name would match half the words in any sentence.
    const result = validateDraft('Vanguard Zoe fell this patch.', FACTS, {
      augmentNames: ['Big'],
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a draft about some other patch', () => {
    const result = ok('The meta settled down and nothing much moved.');

    expect(result.ok).toBe(false);
    expect(result.problems).toContain('Mentions nothing from the supplied facts.');
  });

  it('rejects an over-long draft', () => {
    const long = Array.from(
      { length: MAX_DRAFT_SENTENCES + 1 },
      () => 'Vanguard Zoe changed.',
    ).join(' ');

    expect(ok(long).problems).toContain(`Longer than ${MAX_DRAFT_SENTENCES} sentences.`);
  });

  it('rejects an empty draft without reporting every other problem too', () => {
    const result = ok('   ');

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['The draft is empty.']);
  });

  it('reports every problem at once so an editor sees the whole picture', () => {
    const result = ok('Augments moved and win rates hit 62%.');

    expect(result.problems.length).toBeGreaterThan(2);
  });

  it('skips the grounding check when there are no facts to ground against', () => {
    const empty: MetaSummaryFacts = {
      ...FACTS,
      balanceChanges: [],
      tierMovements: [],
      newComps: [],
    };

    expect(validateDraft('Nothing notable changed this patch.', empty).ok).toBe(true);
  });
});

describe('Deciding whether to draft at all (_Requirements: 8.2_)', () => {
  it('is worth drafting when anything moved', () => {
    expect(hasEnoughToSay(FACTS)).toBe(true);
  });

  it('is not worth drafting on an empty patch', () => {
    // Better to leave the summary null — and have the page say it is awaiting
    // review — than to spend a model call inventing significance.
    expect(hasEnoughToSay({ ...FACTS, balanceChanges: [], tierMovements: [], newComps: [] })).toBe(
      false,
    );
  });
});
