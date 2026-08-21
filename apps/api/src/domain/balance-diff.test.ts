/**
 * Balance-change diffing tests (task 6.1).
 *
 * _Requirements: 8.1, 12.1_
 */
import type { DataDragonEntry, DataDragonSnapshot } from '@tft-codex/riot-client';
import type { BalanceChange } from '@tft-codex/shared-types';
import { describe, expect, it } from 'vitest';

import { diffGameData, mergeBalanceChanges } from './balance-diff.js';

const OPTIONS = { setPrefix: 'TFT17' };

const snapshot = (parts: Partial<Omit<DataDragonSnapshot, 'version'>>): DataDragonSnapshot => ({
  version: 'v',
  champions: [],
  traits: [],
  items: [],
  ...parts,
});

const champion = (id: string, cost: number, name = id.split('_')[1]!): DataDragonEntry => ({
  id,
  name,
  cost,
  tier: cost,
});

describe('Roster changes (_Requirements: 8.1_)', () => {
  it('reports a champion added to the set', () => {
    const changes = diffGameData(
      snapshot({ champions: [] }),
      snapshot({ champions: [champion('TFT17_Zoe', 4)] }),
      OPTIONS,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entityType: 'champion',
      entityId: 'TFT17_Zoe',
      source: 'data-dragon',
    });
    expect(changes[0]!.summary).toContain('Zoe');
  });

  it('reports a champion removed from the set', () => {
    const changes = diffGameData(
      snapshot({ champions: [champion('TFT17_Zoe', 4)] }),
      snapshot({ champions: [] }),
      OPTIONS,
    );

    expect(changes[0]!.summary).toContain('removed');
  });

  it('says nothing when nothing changed', () => {
    const units = [champion('TFT17_Zoe', 4), champion('TFT17_Leona', 2)];
    expect(
      diffGameData(snapshot({ champions: units }), snapshot({ champions: units }), OPTIONS),
    ).toHaveLength(0);
  });

  it('diffs traits and items as well as champions', () => {
    const changes = diffGameData(
      snapshot({}),
      snapshot({
        traits: [{ id: 'TFT17_Vanguard', name: 'Vanguard' }],
        items: [{ id: 'TFT17_Item_Deathcap', name: 'Deathcap' }],
      }),
      OPTIONS,
    );

    expect(changes.map((change) => change.entityType).sort()).toEqual(['item', 'trait']);
  });
});

describe('Set filtering (_Requirements: 8.1_)', () => {
  it('ignores entities from other sets', () => {
    // Data Dragon ships tutorial, current and several past sets in one file.
    // Without the filter, adding a new set reports all of last set arriving.
    const changes = diffGameData(
      snapshot({ champions: [champion('TFT17_Zoe', 4)] }),
      snapshot({
        champions: [
          champion('TFT17_Zoe', 4),
          champion('TFT16_Jinx', 4),
          champion('TFTTutorial_Zed', 2),
        ],
      }),
      OPTIONS,
    );

    expect(changes).toHaveLength(0);
  });

  it('does not treat a prefix that merely starts the same as in-set', () => {
    // "TFT1" must not swallow "TFT17_" — the separator is part of the match.
    const changes = diffGameData(
      snapshot({}),
      snapshot({ champions: [champion('TFT171_Odd', 3)] }),
      OPTIONS,
    );

    expect(changes).toHaveLength(0);
  });
});

describe('Numeric changes Data Dragon does expose (_Requirements: 8.1_)', () => {
  it('reports a shop cost increase with both numbers', () => {
    const changes = diffGameData(
      snapshot({ champions: [champion('TFT17_Sett', 4)] }),
      snapshot({ champions: [{ id: 'TFT17_Sett', name: 'Sett', cost: 5, tier: 4 }] }),
      OPTIONS,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]!.summary).toBe('Sett shop cost increased from 4 to 5.');
  });

  it('names a reduction as a reduction', () => {
    const changes = diffGameData(
      snapshot({ champions: [{ id: 'TFT17_Sett', name: 'Sett', cost: 5, tier: 5 }] }),
      snapshot({ champions: [{ id: 'TFT17_Sett', name: 'Sett', cost: 4, tier: 5 }] }),
      OPTIONS,
    );

    expect(changes[0]!.summary).toBe('Sett shop cost reduced from 5 to 4.');
  });

  it('reports a rarity tier move separately from a cost move', () => {
    const changes = diffGameData(
      snapshot({ champions: [{ id: 'TFT17_Sett', name: 'Sett', cost: 4, tier: 4 }] }),
      snapshot({ champions: [{ id: 'TFT17_Sett', name: 'Sett', cost: 5, tier: 5 }] }),
      OPTIONS,
    );

    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.summary)).toEqual([
      'Sett shop cost increased from 4 to 5.',
      'Sett rarity tier changed from 4 to 5.',
    ]);
  });

  it('emits nothing for a field the source does not carry', () => {
    // Traits have no numeric fields in Data Dragon at all. A trait that exists
    // in both versions must produce no record, not an empty-valued one — the
    // diff never guesses at a change it cannot see.
    const trait = { id: 'TFT17_Vanguard', name: 'Vanguard' };
    expect(
      diffGameData(snapshot({ traits: [trait] }), snapshot({ traits: [trait] }), OPTIONS),
    ).toHaveLength(0);
  });
});

describe('Merging with editorial records (_Requirements: 8.1_)', () => {
  const editorial: BalanceChange = {
    entityType: 'champion',
    entityId: 'TFT17_Zoe',
    summary: 'Spell damage 280/420/900 → 260/390/850.',
    source: 'editorial',
  };

  const detected: BalanceChange = {
    entityType: 'champion',
    entityId: 'TFT17_Leona',
    summary: 'Leona shop cost increased from 1 to 2.',
    source: 'data-dragon',
  };

  it('keeps hand-written records when the job re-runs', () => {
    // The failure this prevents: a scheduled job quietly deleting the numeric
    // changes a person typed, every time it runs.
    const merged = mergeBalanceChanges([editorial], [detected]);

    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual(editorial);
  });

  it('replaces the previous automatic records rather than duplicating them', () => {
    const stale: BalanceChange = { ...detected, summary: 'Leona shop cost increased from 1 to 3.' };
    const merged = mergeBalanceChanges([stale], [detected]);

    expect(merged).toEqual([detected]);
  });

  it('lets an editorial record win over an automatic one for the same entity', () => {
    // A person's description of the change is the more informative half;
    // overwriting it with "shop cost reduced from 5 to 4" is a downgrade even
    // though the automatic line is accurate.
    const automatic: BalanceChange = { ...editorial, source: 'data-dragon', summary: 'auto' };
    const merged = mergeBalanceChanges([editorial], [automatic]);

    expect(merged).toEqual([editorial]);
  });

  it('puts editorial records first, because they read better', () => {
    const merged = mergeBalanceChanges([editorial], [detected]);
    expect(merged[0]).toEqual(editorial);
  });

  it('treats an unlabelled legacy record as editorial and preserves it', () => {
    // Rows written before this job existed carry the schema default. Keeping
    // them is the safe direction: declining to overwrite costs nothing,
    // discarding an unrecoverable hand-written record costs a lot.
    const legacy = { ...editorial, source: 'editorial' as const };
    expect(mergeBalanceChanges([legacy], [])).toEqual([legacy]);
  });
});
