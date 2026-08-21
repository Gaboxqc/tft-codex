/**
 * Meta-summary drafting service tests (task 6.2).
 *
 * _Requirements: 8.2, 3.1_
 */
import { describe, expect, it, vi } from 'vitest';

import type { MetaSummaryFacts } from '../domain/meta-summary.js';
import type { PatchRepository } from '../repositories/patch-repository.js';
import { MetaSummaryService, type SummaryDrafter } from './meta-summary-drafter.js';

const FACTS: MetaSummaryFacts = {
  patch: '17.9',
  setName: 'Into the Arcane',
  balanceChanges: [],
  tierMovements: [{ compId: 'vanguard-zoe', compName: 'Vanguard Zoe', from: 'S', to: 'B' }],
  newComps: [],
};

const build = (draft: string | null) => {
  const patches = {
    saveMetaSummaryDraft: vi.fn(async () => undefined),
    approveMetaSummaryAs: vi.fn(async () => undefined),
  };

  const drafter: SummaryDrafter | undefined =
    draft === null ? undefined : { draft: vi.fn(async () => draft) };

  return {
    patches,
    drafter,
    service: new MetaSummaryService({
      patches: patches as unknown as PatchRepository,
      drafter,
    }),
  };
};

describe('Storing drafts (_Requirements: 8.2_)', () => {
  it('stores a valid draft as pending review', async () => {
    const { service, patches } = build('Vanguard Zoe lost a tier this patch.');
    const result = await service.draftFor(FACTS);

    expect(result.stored).toBe(true);
    expect(patches.saveMetaSummaryDraft).toHaveBeenCalledWith(
      '17.9',
      'Vanguard Zoe lost a tier this patch.',
    );
  });

  it('never writes the published column', async () => {
    // R8.2's whole point: there is no path from "the model answered" to "the
    // public sees it". Publishing is a separate, human-invoked method.
    const { service, patches } = build('Vanguard Zoe lost a tier this patch.');
    await service.draftFor(FACTS);

    expect(patches.approveMetaSummaryAs).not.toHaveBeenCalled();
  });

  it('discards a draft that fails its guards rather than storing it', async () => {
    // Stored-with-a-warning would rely on an editor noticing the warning,
    // which is exactly what the guards exist to avoid depending on.
    const { service, patches } = build('Vanguard Zoe fell to a 4.2 average placement.');
    const result = await service.draftFor(FACTS);

    expect(result.stored).toBe(false);
    expect(result.reason).toBe('rejected');
    expect(patches.saveMetaSummaryDraft).not.toHaveBeenCalled();
  });

  it('returns the rejected text and the reasons, for the log', async () => {
    const { service } = build('Augments changed and win rates hit 62%.');
    const result = await service.draftFor(FACTS);

    expect(result.draft).toContain('Augments');
    expect(result.problems?.length).toBeGreaterThan(1);
  });
});

describe('Declining to draft (_Requirements: 8.2_)', () => {
  it('no-ops without a configured drafter', async () => {
    const { service, patches } = build(null);
    const result = await service.draftFor(FACTS);

    expect(result.reason).toBe('no-drafter');
    expect(patches.saveMetaSummaryDraft).not.toHaveBeenCalled();
  });

  it('skips a patch where nothing moved', async () => {
    // Leaving the summary null is honest — the page already says it is
    // awaiting review, which beats prose written to fill the space.
    const { service, drafter } = build('Something happened, probably.');
    const result = await service.draftFor({
      ...FACTS,
      tierMovements: [],
      balanceChanges: [],
      newComps: [],
    });

    expect(result.reason).toBe('nothing-to-say');
    expect(drafter?.draft).not.toHaveBeenCalled();
  });

  it('treats an empty model response as a rejection, not a valid draft', async () => {
    // The Anthropic adapter returns '' on a refusal or an API error.
    const { service, patches } = build('');
    const result = await service.draftFor(FACTS);

    expect(result.stored).toBe(false);
    expect(patches.saveMetaSummaryDraft).not.toHaveBeenCalled();
  });
});

describe('Augment vocabulary (_Requirements: 3.1_)', () => {
  it('rejects a draft naming an augment supplied in the vocabulary', async () => {
    const { service, patches } = build('Vanguard Zoe fell once Portable Forge landed.');
    const result = await service.draftFor(FACTS, { augmentNames: ['Portable Forge'] });

    expect(result.stored).toBe(false);
    expect(patches.saveMetaSummaryDraft).not.toHaveBeenCalled();
  });
});
