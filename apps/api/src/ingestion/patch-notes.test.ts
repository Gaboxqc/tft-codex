/**
 * Patch-notes ingestion job tests (task 6.1).
 *
 * _Requirements: 8.1, 12.1_
 */
import type { DataDragonClient, DataDragonSnapshot } from '@tft-codex/riot-client';
import type { BalanceChange, PatchVersion } from '@tft-codex/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PatchRepository } from '../repositories/patch-repository.js';
import { PatchNotesJob } from './patch-notes.js';

const PATCH: PatchVersion = {
  id: '17.9',
  setNumber: 17,
  setName: 'Into the Arcane',
  releaseDate: '2026-07-30',
  isCurrentPatch: true,
  archived: false,
  balanceChanges: [],
  metaImpactSummary: null,
};

const snapshot = (
  version: string,
  champions: DataDragonSnapshot['champions'],
): DataDragonSnapshot => ({ version, champions, traits: [], items: [] });

interface Harness {
  job: PatchNotesJob;
  patches: {
    findById: ReturnType<typeof vi.fn>;
    latest: ReturnType<typeof vi.fn>;
    dataDragonVersion: ReturnType<typeof vi.fn>;
    saveBalanceChanges: ReturnType<typeof vi.fn>;
  };
}

const build = (
  overrides: {
    patch?: PatchVersion;
    ingestedVersion?: string | null;
    versions?: string[];
    byVersion?: Record<string, DataDragonSnapshot>;
  } = {},
): Harness => {
  const patch = overrides.patch ?? PATCH;
  const versions = overrides.versions ?? ['16.16.1', '16.15.1'];
  const byVersion = overrides.byVersion ?? {
    '16.15.1': snapshot('16.15.1', []),
    '16.16.1': snapshot('16.16.1', [{ id: 'TFT17_Zoe', name: 'Zoe', cost: 4, tier: 4 }]),
  };

  const patches = {
    findById: vi.fn(async () => patch),
    latest: vi.fn(async () => patch),
    dataDragonVersion: vi.fn(async () => overrides.ingestedVersion ?? null),
    saveBalanceChanges: vi.fn(async () => undefined),
  };

  const dataDragon = {
    versions: vi.fn(async () => versions),
    snapshot: vi.fn(async (version: string) => byVersion[version] ?? snapshot(version, [])),
  };

  return {
    job: new PatchNotesJob({
      dataDragon: dataDragon as unknown as DataDragonClient,
      patches: patches as unknown as PatchRepository,
    }),
    patches,
  };
};

describe('Version selection (_Requirements: 8.1_)', () => {
  it('diffs the two newest versions by default', async () => {
    const { job } = build();
    const result = await job.run();

    expect(result.fromVersion).toBe('16.15.1');
    expect(result.toVersion).toBe('16.16.1');
  });

  it('accepts pinned versions for a backfill', async () => {
    const { job } = build({ versions: ['16.16.1', '16.15.1', '16.14.1'] });
    const result = await job.run({ from: '16.14.1', to: '16.15.1' });

    expect(result.fromVersion).toBe('16.14.1');
    expect(result.toVersion).toBe('16.15.1');
  });

  it('refuses to run when Data Dragon has fewer than two versions', async () => {
    const { job } = build({ versions: ['16.16.1'] });
    await expect(job.run()).rejects.toThrow(/fewer than two versions/);
  });

  it('refuses to run when there is no patch to write to', async () => {
    const { job, patches } = build();
    patches.latest.mockResolvedValueOnce(null);

    await expect(job.run()).rejects.toThrow(/no patch to ingest into/);
  });
});

describe('Idempotence (_Requirements: 8.1_)', () => {
  it('skips a version it has already ingested', async () => {
    const { job, patches } = build({ ingestedVersion: '16.16.1' });
    const result = await job.run();

    expect(result.written).toBe(false);
    expect(result.reason).toBe('already-ingested');
    expect(patches.saveBalanceChanges).not.toHaveBeenCalled();
  });

  it('still runs an explicitly pinned version that was already ingested', async () => {
    // A backfill or a correction has to be able to override the skip.
    const { job, patches } = build({ ingestedVersion: '16.16.1' });
    const result = await job.run({ to: '16.16.1', from: '16.15.1' });

    expect(result.written).toBe(true);
    expect(patches.saveBalanceChanges).toHaveBeenCalled();
  });

  it('records the version it diffed up to', async () => {
    const { job, patches } = build();
    await job.run();

    expect(patches.saveBalanceChanges).toHaveBeenCalledWith('17.9', expect.anything(), '16.16.1');
  });
});

describe('Writing changes (_Requirements: 8.1_)', () => {
  it('writes the detected changes', async () => {
    const { job, patches } = build();
    const result = await job.run();

    expect(result.detected).toBe(1);
    const written = patches.saveBalanceChanges.mock.calls[0]![1] as BalanceChange[];
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ entityId: 'TFT17_Zoe', source: 'data-dragon' });
  });

  it('preserves editorial records through a run', async () => {
    // The failure this guards: a scheduled job silently deleting the numeric
    // changes a person typed in, on every run, forever.
    const editorial: BalanceChange = {
      entityType: 'champion',
      entityId: 'TFT17_Sett',
      summary: 'Spell damage 280/420/900 → 260/390/850.',
      source: 'editorial',
    };

    const { job, patches } = build({ patch: { ...PATCH, balanceChanges: [editorial] } });
    const result = await job.run();

    expect(result.editorialPreserved).toBe(1);
    const written = patches.saveBalanceChanges.mock.calls[0]![1] as BalanceChange[];
    expect(written).toContainEqual(editorial);
  });

  it('scopes the diff to the patch’s own set', async () => {
    // The set prefix comes from the patch record rather than configuration, so
    // a unit from a neighbouring set in the same Data Dragon file is ignored.
    const { job, patches } = build({
      byVersion: {
        '16.15.1': snapshot('16.15.1', []),
        '16.16.1': snapshot('16.16.1', [
          { id: 'TFT17_Zoe', name: 'Zoe', cost: 4, tier: 4 },
          { id: 'TFT16_Jinx', name: 'Jinx', cost: 4, tier: 4 },
        ]),
      },
    });

    await job.run();

    const written = patches.saveBalanceChanges.mock.calls[0]![1] as BalanceChange[];
    expect(written.map((change) => change.entityId)).toEqual(['TFT17_Zoe']);
  });

  it('writes an empty list rather than failing when nothing moved', async () => {
    // Data Dragon carries no ability values, so a real numeric patch produces
    // an empty diff. That is a legitimate outcome, not an error.
    const same = [{ id: 'TFT17_Zoe', name: 'Zoe', cost: 4, tier: 4 }];
    const { job, patches } = build({
      byVersion: {
        '16.15.1': snapshot('16.15.1', same),
        '16.16.1': snapshot('16.16.1', same),
      },
    });

    const result = await job.run();

    expect(result.detected).toBe(0);
    expect(result.written).toBe(true);
    expect(patches.saveBalanceChanges).toHaveBeenCalledWith('17.9', [], '16.16.1');
  });
});

describe('Target selection (_Requirements: 8.1_)', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = build();
  });

  it('defaults to the latest patch', async () => {
    await harness.job.run();
    expect(harness.patches.latest).toHaveBeenCalled();
    expect(harness.patches.findById).not.toHaveBeenCalled();
  });

  it('accepts an explicit patch id', async () => {
    await harness.job.run({ patchId: '17.8' });
    expect(harness.patches.findById).toHaveBeenCalledWith('17.8');
  });
});
