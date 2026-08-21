import type { TierList } from '@tft-codex/shared-types';
import { describe, expect, it, vi } from 'vitest';

import { CACHE_KEYS, type Cache } from '../db/redis.js';
import type { CompMetadata, CompRepository } from '../repositories/comp-repository.js';
import type { IngestionRepository } from '../repositories/ingestion-repository.js';
import type { OlapReadRepository } from '../repositories/olap-repository.js';
import type { PatchRepository } from '../repositories/patch-repository.js';
import { TierListPublisher, isStale } from './publisher.js';

/** Minimal in-memory Redis covering only get/set with EX. */
function fakeCache() {
  const store = new Map<string, string>();
  return {
    store,
    cache: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    } as unknown as Cache,
  };
}

const metadata = (id: string, name: string): CompMetadata => ({
  id,
  patch: '17.9',
  name,
  altName: null,
  playstyle: 'Fast 8',
  difficulty: 'Medium',
  coreTraits: ['Vanguard'],
  carries: ['TFT17_Zoe'],
  units: [],
  formation: { front: [], back: [] },
  augmentPriority: ['Items'],
  curatedAugments: [],
  explanation: '',
  stageGuides: { stage2: '', stage3: '', stage4: '' },
  flexSlots: [],
});

function setup(
  options: {
    counters?: Parameters<OlapReadRepository['compCounters']> extends never ? never : unknown;
  } = {},
) {
  void options;
  const { cache, store } = fakeCache();

  const olap = {
    compCounters: vi.fn(async () => [
      { compId: 'strong', games: 1000, top4Count: 620, winCount: 200, placementSum: 3900 },
      { compId: 'mid', games: 1000, top4Count: 500, winCount: 125, placementSum: 4500 },
      { compId: 'weak', games: 1000, top4Count: 380, winCount: 60, placementSum: 5100 },
      { compId: 'newcomer', games: 10, top4Count: 5, winCount: 1, placementSum: 45 },
      // Has stats but no registry metadata — an unconfirmed signature.
      { compId: 'unregistered', games: 1000, top4Count: 500, winCount: 100, placementSum: 4500 },
    ]),
  } as unknown as OlapReadRepository;

  const comps = {
    listMetadata: vi.fn(async () => [
      metadata('strong', 'Vanguard Zoe'),
      metadata('mid', 'Sniper Jinx'),
      metadata('weak', 'Bruiser Sett'),
      metadata('newcomer', 'Experimental Kaisa'),
    ]),
  } as unknown as CompRepository;

  const repository = {
    startRun: vi.fn(async () => 7),
    finishRun: vi.fn(async () => undefined),
  } as unknown as IngestionRepository;

  return { cache, store, olap, comps, repository };
}

describe('TierListPublisher (_Requirements: 1.3, 1.4, 1.5_)', () => {
  it('publishes a scored, sorted snapshot with the formula version attached', async () => {
    const { cache, olap, comps, repository } = setup();
    const publisher = new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      minSampleSize: 200,
      now: () => new Date('2026-08-07T12:00:00.000Z'),
    });

    const snapshot = await publisher.publish('17.9');

    expect(snapshot.patch).toBe('17.9');
    expect(snapshot.scoringFormulaVersion).toBe('1.0.0');
    expect(snapshot.lastRefreshedAt).toBe('2026-08-07T12:00:00.000Z');
    // Descending by composite score, with provisional comps last regardless of
    // their score — `newcomer` outscores `weak` on 10 games, and surfacing it
    // higher would assert a confidence R1.4 explicitly withholds.
    expect(snapshot.entries.map((entry) => entry.compId)).toEqual([
      'strong',
      'mid',
      'weak',
      'newcomer',
    ]);
    expect(snapshot.entries[0]!.tier).toBe('S');
    expect(snapshot.entries.at(-1)!.tier).toBe('provisional');
  });

  it('omits comps that have stats but no confirmed signature', async () => {
    // design.md §3: a comp with no registry metadata belongs in the editorial
    // queue, not on a public tier list.
    const { cache, olap, comps, repository } = setup();
    const snapshot = await new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      minSampleSize: 200,
    }).publish('17.9');

    expect(snapshot.entries.map((entry) => entry.compId)).not.toContain('unregistered');
  });

  it('marks a low-sample comp provisional (R1.4)', async () => {
    const { cache, olap, comps, repository } = setup();
    const snapshot = await new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      minSampleSize: 200,
    }).publish('17.9');

    const newcomer = snapshot.entries.find((entry) => entry.compId === 'newcomer');
    expect(newcomer?.tier).toBe('provisional');
  });

  it('is never stale at the moment it is written', async () => {
    const { cache, olap, comps, repository } = setup();
    const snapshot = await new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      minSampleSize: 200,
    }).publish('17.9');
    expect(snapshot.stale).toBe(false);
  });
});

describe('TierListPublisher two-phase publish (_Requirements: 1.2_)', () => {
  it('writes the snapshot before flipping the pointer', async () => {
    // A pointer flipped before its payload exists makes every reader 404 until
    // the write lands (design.md §9).
    const { cache, store, olap, comps, repository } = setup();
    const setCalls: string[] = [];
    vi.mocked(cache.set).mockImplementation(async (key: string, value: string) => {
      setCalls.push(String(key));
      store.set(String(key), String(value));
      return 'OK' as never;
    });

    await new TierListPublisher({ olap, comps, repository, cache, minSampleSize: 200 }).publish(
      '17.9',
    );

    const snapshotIndex = setCalls.findIndex((key) => key.includes(':v:'));
    const pointerIndex = setCalls.findIndex((key) => key.endsWith(':current'));
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeLessThan(pointerIndex);
  });

  it('records the published version on the pipeline run', async () => {
    const { cache, olap, comps, repository } = setup();
    await new TierListPublisher({ olap, comps, repository, cache, minSampleSize: 200 }).publish(
      '17.9',
    );

    expect(repository.finishRun).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: 'succeeded', publishedVersion: expect.any(String) }),
    );
  });

  it('records a failed run and rethrows when scoring blows up', async () => {
    const { cache, comps, repository } = setup();
    const olap = {
      compCounters: vi.fn(async () => {
        throw new Error('clickhouse unreachable');
      }),
    } as unknown as OlapReadRepository;

    await expect(
      new TierListPublisher({ olap, comps, repository, cache, minSampleSize: 200 }).publish('17.9'),
    ).rejects.toThrow('clickhouse unreachable');

    expect(repository.finishRun).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: 'failed' }),
    );
  });
});

describe('TierListPublisher trend detection (_Requirements: 8.3_)', () => {
  it('derives trend and meta-shift flags from the previous snapshot', async () => {
    const { cache, store, olap, comps, repository } = setup();

    const previous: TierList = {
      patch: '17.9',
      lastRefreshedAt: '2026-08-07T11:00:00.000Z',
      stale: false,
      scoringFormulaVersion: '1.0.0',
      entries: [
        {
          compId: 'strong',
          name: 'Vanguard Zoe',
          // Was bottom tier, now S — more than one full tier, so a meta shift.
          tier: 'C',
          trend: 'stable',
          playstyle: 'Fast 8',
          difficulty: 'Medium',
          coreTraits: [],
          carries: [],
          compositeScore: 0.1,
          stats: {
            avgPlacement: 5,
            top4Rate: 0.3,
            winRate: 0.05,
            playRate: 0.01,
            sampleSize: 500,
            computedAt: '2026-08-07T11:00:00.000Z',
          },
          metaShift: false,
        },
      ],
    };
    store.set(CACHE_KEYS.tierListVersion('17.9'), 'prev');
    store.set(CACHE_KEYS.tierListSnapshot('17.9', 'prev'), JSON.stringify(previous));

    const snapshot = await new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      minSampleSize: 200,
    }).publish('17.9');

    const strong = snapshot.entries.find((entry) => entry.compId === 'strong')!;
    expect(strong.trend).toBe('rising');
    expect(strong.metaShift).toBe(true);

    // A comp with no previous entry gets no invented trend.
    const mid = snapshot.entries.find((entry) => entry.compId === 'mid')!;
    expect(mid.trend).toBe('stable');
    expect(mid.metaShift).toBe(false);
  });

  it('still publishes when the previous snapshot cannot be read', async () => {
    // Losing trend arrows for one cycle is acceptable; failing to publish is not.
    const { olap, comps, repository } = setup();
    const cache = {
      get: vi.fn(async () => {
        throw new Error('redis down');
      }),
      set: vi.fn(async () => 'OK'),
    } as unknown as Cache;

    const snapshot = await new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      minSampleSize: 200,
    }).publish('17.9');

    expect(snapshot.entries.length).toBeGreaterThan(0);
    expect(snapshot.entries.every((entry) => entry.trend === 'stable')).toBe(true);
  });
});

describe('isStale (_Requirements: 1.6_)', () => {
  const now = new Date('2026-08-07T12:00:00.000Z');

  it('is not stale inside 2x the refresh interval', () => {
    expect(isStale('2026-08-07T11:15:00.000Z', 30, now)).toBe(false);
  });

  it('is stale beyond 2x the refresh interval', () => {
    expect(isStale('2026-08-07T10:30:00.000Z', 30, now)).toBe(true);
  });

  it('treats a missing or unparseable timestamp as stale', () => {
    // Failing closed: better to warn unnecessarily than to present unknown-age
    // data as current.
    expect(isStale(null, 30, now)).toBe(true);
    expect(isStale('not-a-date', 30, now)).toBe(true);
  });
});

describe('Snapshot archival (_Requirements: 8.3, 8.4_)', () => {
  const fakePatches = () =>
    ({
      saveSnapshot: vi.fn(async () => undefined),
      recordMetaShifts: vi.fn(async () => 1),
    }) as unknown as PatchRepository;

  it('archives the published snapshot with its formula version', async () => {
    // A historical snapshot has to be readable in the context of the formula
    // of its day, not today's.
    const { cache, olap, comps, repository } = setup();
    const patches = fakePatches();

    await new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      patches,
      minSampleSize: 200,
    }).publish('17.9');

    expect(patches.saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ patch: '17.9', formulaVersion: '1.0.0' }),
    );
  });

  it('records a meta shift against the previous snapshot', async () => {
    const { cache, store, olap, comps, repository } = setup();
    const patches = fakePatches();

    const previous: TierList = {
      patch: '17.9',
      lastRefreshedAt: '2026-08-14T11:00:00.000Z',
      stale: false,
      scoringFormulaVersion: '1.0.0',
      entries: [
        {
          compId: 'strong',
          name: 'Vanguard Zoe',
          tier: 'C',
          trend: 'stable',
          playstyle: 'Fast 8',
          difficulty: 'Medium',
          coreTraits: [],
          carries: [],
          compositeScore: 0.1,
          stats: {
            avgPlacement: 5,
            top4Rate: 0.3,
            winRate: 0.05,
            playRate: 0.01,
            sampleSize: 500,
            computedAt: '2026-08-14T11:00:00.000Z',
          },
          metaShift: false,
        },
      ],
    };
    store.set(CACHE_KEYS.tierListVersion('17.9'), 'prev');
    store.set(CACHE_KEYS.tierListSnapshot('17.9', 'prev'), JSON.stringify(previous));

    await new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      patches,
      minSampleSize: 200,
    }).publish('17.9');

    expect(patches.recordMetaShifts).toHaveBeenCalledWith([
      expect.objectContaining({ compId: 'strong', fromTier: 'C', toTier: 'S' }),
    ]);
  });

  it('records nothing on the very first publish', async () => {
    // No predecessor means no movement, not movement from nowhere.
    const { cache, olap, comps, repository } = setup();
    const patches = fakePatches();

    await new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      patches,
      minSampleSize: 200,
    }).publish('17.9');

    expect(patches.recordMetaShifts).not.toHaveBeenCalled();
  });

  it('still publishes when archiving fails', async () => {
    // The tier list is already live by this point. Losing one entry of history
    // is a much smaller problem than a run that reports failure and retries.
    const { cache, olap, comps, repository } = setup();
    const patches = {
      saveSnapshot: vi.fn(async () => {
        throw new Error('postgres down');
      }),
      recordMetaShifts: vi.fn(async () => 0),
    } as unknown as PatchRepository;

    const snapshot = await new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      patches,
      minSampleSize: 200,
    }).publish('17.9');

    expect(snapshot.entries.length).toBeGreaterThan(0);
    expect(repository.finishRun).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('publishes normally when no archive repository is configured', async () => {
    const { cache, olap, comps, repository } = setup();
    const snapshot = await new TierListPublisher({
      olap,
      comps,
      repository,
      cache,
      minSampleSize: 200,
    }).publish('17.9');

    expect(snapshot.entries.length).toBeGreaterThan(0);
  });
});
