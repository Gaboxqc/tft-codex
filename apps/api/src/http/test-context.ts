/**
 * Test doubles for building an `AppContext` without Postgres, Redis or
 * ClickHouse.
 *
 * Shared by the route integration tests and the compliance suite so both drive
 * the same app assembly the server uses — a test that stubbed the routes
 * themselves would happily pass while the real gateway leaked.
 */
import { vi } from 'vitest';
import type { MatchSummary, PlayerProfile, TierList } from '@tft-codex/shared-types';

import { issueAccessToken } from '../auth/session.js';
import type { AppConfig } from '../config.js';
import type { AuthRepository } from '../repositories/auth-repository.js';
import type { BuilderComp, BuilderRepository } from '../repositories/builder-repository.js';
import type { GameDataRepository } from '../repositories/game-data-repository.js';
import type { NotificationRepository } from '../repositories/notification-repository.js';
import type { PatchRepository } from '../repositories/patch-repository.js';
import type { PlayerRepository } from '../repositories/player-repository.js';
import { CACHE_KEYS, type Cache } from '../db/redis.js';
import type { AugmentCounters } from '../domain/augment-tiering.js';
import type { AugmentInternalRepository } from '../repositories/augment-internal-repository.js';
import type { AugmentRepository, PublicAugmentRecord } from '../repositories/augment-repository.js';
import type { CompMetadata, CompRepository } from '../repositories/comp-repository.js';
import type { IngestionRepository } from '../repositories/ingestion-repository.js';
import type { OlapReadRepository } from '../repositories/olap-repository.js';
import type { ReferenceRepository } from '../repositories/reference-repository.js';
import type { AppContext } from './context.js';

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  env: 'test',
  isProduction: false,
  server: { port: 0, host: '127.0.0.1' },
  riot: { apiKey: 'RGAPI-test', platform: 'euw1', regional: 'europe' },
  postgres: { connectionString: 'postgres://test' },
  redis: { url: 'redis://test' },
  clickhouse: {
    url: 'http://test',
    database: 'tftcodex',
    admin: { username: 'admin', password: '' },
    gateway: { username: 'gateway', password: '' },
  },
  meta: { refreshIntervalMinutes: 30, compMinSampleSize: 200 },
  jwtSecret: 'test-secret-value-long-enough',
  webBaseUrl: 'http://localhost:3000',
  rso: { clientId: 'test', clientSecret: 'secret', redirectUri: 'http://localhost:4000/cb' },
  privacy: { profileRetentionDays: 30 },
  compliance: { tier3RecommendationsConfirmed: false, tier3ConfirmationRef: null },
  ...overrides,
});

/** In-memory Redis covering get/set with an EX argument. */
export function memoryCache(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
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

export const compMetadata = (overrides: Partial<CompMetadata> = {}): CompMetadata => ({
  id: 'vanguard-zoe',
  patch: '17.9',
  name: 'Vanguard Zoe',
  altName: null,
  playstyle: 'Fast 8',
  difficulty: 'Medium',
  coreTraits: ['Vanguard', 'Sorcerer'],
  carries: ['TFT17_Zoe'],
  units: [
    { championId: 'TFT17_Zoe', role: 'carry', starTarget: 2, items: ['TFT_Item_RabadonsDeathcap'] },
  ],
  formation: { front: ['TFT17_Leona'], back: ['TFT17_Zoe'] },
  augmentPriority: ['Items', 'Combat', 'Econ'],
  curatedAugments: ['TFT17_Augment_SorcererHeart'],
  explanation: 'Vanguard buys time for Zoe to reach her three-item spike.',
  stageGuides: { stage2: 'Slam components.', stage3: 'Stabilise at 6.', stage4: 'Level to 8.' },
  flexSlots: [],
  ...overrides,
});

export const tierListSnapshot = (overrides: Partial<TierList> = {}): TierList => ({
  patch: '17.9',
  lastRefreshedAt: new Date().toISOString(),
  stale: false,
  scoringFormulaVersion: '1.0.0',
  entries: [
    {
      compId: 'vanguard-zoe',
      name: 'Vanguard Zoe',
      tier: 'S',
      trend: 'rising',
      playstyle: 'Fast 8',
      difficulty: 'Medium',
      coreTraits: ['Vanguard', 'Sorcerer'],
      carries: ['TFT17_Zoe'],
      compositeScore: 0.91,
      stats: {
        avgPlacement: 4.1,
        top4Rate: 0.55,
        winRate: 0.15,
        playRate: 0.08,
        sampleSize: 24_000,
        computedAt: new Date().toISOString(),
      },
      metaShift: false,
    },
    {
      compId: 'bruiser-sett',
      name: 'Bruiser Sett',
      tier: 'C',
      trend: 'falling',
      playstyle: 'Reroll',
      difficulty: 'Easy',
      coreTraits: ['Bruiser'],
      carries: ['TFT17_Sett'],
      compositeScore: 0.21,
      stats: {
        avgPlacement: 4.9,
        top4Rate: 0.42,
        winRate: 0.08,
        playRate: 0.05,
        sampleSize: 9_000,
        computedAt: new Date().toISOString(),
      },
      metaShift: false,
    },
    {
      compId: 'experimental-kaisa',
      name: 'Experimental Kaisa',
      tier: 'provisional',
      trend: 'stable',
      playstyle: 'Fast 9',
      difficulty: 'Hard',
      coreTraits: ['Prodigy'],
      carries: ['TFT17_Kaisa'],
      compositeScore: 0.4,
      stats: {
        avgPlacement: 4.4,
        top4Rate: 0.5,
        winRate: 0.1,
        playRate: 0.002,
        sampleSize: 40,
        computedAt: new Date().toISOString(),
      },
      metaShift: false,
    },
  ],
  ...overrides,
});

export const augmentRecord = (
  overrides: Partial<PublicAugmentRecord> = {},
): PublicAugmentRecord => ({
  id: 'TFT17_Augment_SorcererHeart',
  patch: '17.9',
  name: 'Sorcerer Heart',
  kind: 'augment',
  tier: 'S',
  playRate: 0.094,
  provisional: false,
  roundsOffered: [2, 3],
  description: 'Gain a Sorcerer emblem and a Rabadon’s Deathcap.',
  category: 'trait',
  relatedTraits: ['Sorcerer'],
  relatedCarries: [],
  requiresTraits: ['Sorcerer'],
  curatedForCompIds: ['vanguard-zoe'],
  qualitativeNotes: 'Wants a Sorcerer core already on board.',
  ...overrides,
});

/**
 * Counters for the restricted table.
 *
 * Present in the test harness only because the recommendation engine needs
 * something to *order* by. No test asserts these values reach a response —
 * several assert the opposite.
 */
export const augmentCounters = (overrides: Partial<AugmentCounters> = {}): AugmentCounters => ({
  augmentId: 'TFT17_Augment_SorcererHeart',
  compId: null,
  games: 5000,
  top4Count: 3100,
  winCount: 900,
  placementSum: 19_500,
  ...overrides,
});

export interface TestContextOptions {
  config?: Partial<AppConfig>;
  snapshot?: TierList | null;
  comps?: CompMetadata[];
  augments?: PublicAugmentRecord[];
  augmentStats?: AugmentCounters[];
  currentPatch?: string | null;
  lastPublishedAt?: Date | null;
  /** Seeds a live session so route tests can authenticate for real. */
  session?: { puuid: string; sessionId: string };
  profile?: PlayerProfile | null;
  matches?: MatchSummary[];
  /** R8.2 — null means the draft summary is still awaiting review. */
  metaImpactSummary?: string | null;
  prefs?: { channel: string; category: string; enabled: boolean }[];
}

export function buildTestContext(options: TestContextOptions = {}): {
  context: AppContext;
  store: Map<string, string>;
} {
  const patch = options.currentPatch === undefined ? '17.9' : options.currentPatch;
  const snapshot = options.snapshot === undefined ? tierListSnapshot() : options.snapshot;
  const metadata = options.comps ?? [
    compMetadata(),
    compMetadata({
      id: 'bruiser-sett',
      name: 'Bruiser Sett',
      playstyle: 'Reroll',
      difficulty: 'Easy',
      coreTraits: ['Bruiser'],
      carries: ['TFT17_Sett'],
    }),
  ];

  const seed: Record<string, string> = {};
  if (patch && snapshot) {
    seed[CACHE_KEYS.tierListVersion(patch)] = 'v1';
    seed[CACHE_KEYS.tierListSnapshot(patch, 'v1')] = JSON.stringify(snapshot);
  }

  const { cache, store } = memoryCache(seed);

  const comps = {
    currentPatch: vi.fn(async () => patch),
    listMetadata: vi.fn(async () => metadata),
    findById: vi.fn(async (id: string) => metadata.find((comp) => comp.id === id) ?? null),
    search: vi.fn(
      async (query: {
        carry?: string;
        trait?: string;
        query?: string;
        playstyle?: string;
        difficulty?: string;
      }) =>
        metadata.filter((comp) => {
          if (query.carry && !comp.carries.includes(query.carry)) return false;
          if (query.trait && !comp.coreTraits.includes(query.trait)) return false;
          if (query.playstyle && comp.playstyle !== query.playstyle) return false;
          if (query.difficulty && comp.difficulty !== query.difficulty) return false;
          if (query.query && !comp.name.toLowerCase().includes(query.query.toLowerCase())) {
            return false;
          }
          return true;
        }),
    ),
    listSignatures: vi.fn(async () => []),
    signaturesByPatch: vi.fn(async () => new Map()),
  } as unknown as CompRepository;

  const ingestion = {
    lastSuccessfulRunAt: vi.fn(async () =>
      options.lastPublishedAt === undefined ? new Date() : options.lastPublishedAt,
    ),
  } as unknown as IngestionRepository;

  const olap = {
    compCounters: vi.fn(async () => []),
    augmentPlayRates: vi.fn(async () => []),
    patchesWithStats: vi.fn(async () => (patch ? [patch] : [])),
  } as unknown as OlapReadRepository;

  const augmentRecords = options.augments ?? [
    augmentRecord(),
    augmentRecord({
      id: 'TFT17_Augment_PandorasItems',
      name: "Pandora's Items",
      tier: 'A',
      playRate: 0.061,
      category: 'item',
      relatedTraits: [],
      requiresTraits: [],
      curatedForCompIds: [],
    }),
    augmentRecord({
      id: 'TFT17_Augment_BigFriend',
      name: 'Big Friend',
      tier: 'C',
      playRate: 0.022,
      provisional: true,
      category: 'combat',
      relatedTraits: [],
      relatedCarries: ['TFT17_Sett'],
      requiresTraits: [],
      curatedForCompIds: [],
    }),
  ];

  const augments = {
    list: vi.fn(async (_patch: string, kind: string = 'augment') =>
      augmentRecords.filter((record) => record.kind === kind),
    ),
    findById: vi.fn(
      async (id: string) => augmentRecords.find((record) => record.id === id) ?? null,
    ),
    descriptorsFor: vi.fn(async (_patch: string, ids: readonly string[]) =>
      augmentRecords.filter((record) => ids.includes(record.id)),
    ),
    upsertTiers: vi.fn(async () => 0),
  } as unknown as AugmentRepository;

  const stats =
    options.augmentStats ??
    augmentRecords.map((record, index) =>
      augmentCounters({
        augmentId: record.id,
        // Descending quality so ranking assertions have a stable expectation.
        top4Count: 3100 - index * 500,
        placementSum: 19_500 + index * 2500,
      }),
    );

  const augmentStats = {
    countersForPatch: vi.fn(async () => stats),
    countersForAugments: vi.fn(async (_patch: string, ids: readonly string[]) =>
      stats.filter((entry) => ids.includes(entry.augmentId)),
    ),
  } as unknown as AugmentInternalRepository;

  const reference = {
    breakpoints: vi.fn(async (forPatch: string) => ({
      patch: forPatch,
      rows: [
        { level: 7, xpToReach: 48, goldToBuyXp: 28, note: '' },
        { level: 8, xpToReach: 84, goldToBuyXp: 56, note: 'Reachable at 4-1 on a clean streak.' },
      ],
      interestThresholds: [10, 20, 30, 40, 50],
    })),
  } as unknown as ReferenceRepository;

  const storedMatches = options.matches ?? [];
  const sessions = new Map<string, { id: string; puuid: string }>(
    options.session
      ? [
          [
            options.session.sessionId,
            { id: options.session.sessionId, puuid: options.session.puuid },
          ],
        ]
      : [],
  );

  const players = {
    findProfile: vi.fn(async (puuid: string) => options.profile ?? defaultProfile(puuid)),
    upsertProfile: vi.fn(async () => defaultProfile('puuid-1')),
    setCoachingOptOut: vi.fn(async () => undefined),
    requestDeletion: vi.fn(async () => undefined),
    purgeExpired: vi.fn(async () => []),
    listMatches: vi.fn(async () => storedMatches),
    findMatch: vi.fn(
      async (_puuid: string, matchId: string) =>
        storedMatches.find((match) => match.matchId === matchId) ?? null,
    ),
    knownMatchIds: vi.fn(async () => new Set<string>()),
    upsertMatches: vi.fn(async () => 0),
    markSynced: vi.fn(async () => undefined),
    baselineFor: vi.fn(async () => ({
      levelCurves: [
        [
          { round: '3-2', value: 6 },
          { round: '5-6', value: 9 },
        ],
      ],
      goldCurves: [
        [
          { round: '3-2', value: 32 },
          { round: '5-6', value: 30 },
        ],
      ],
      sampleSize: 1,
    })),
    saveCoaching: vi.fn(async () => undefined),
    findCoaching: vi.fn(async () => null),
    analytics: vi.fn(async () => ({
      byComp: [{ compId: 'vanguard-zoe', games: 12, avgPlacement: 3.8 }],
      totalGames: 12,
      overallAvgPlacement: 3.8,
    })),
  } as unknown as PlayerRepository;

  const auth = {
    saveFlow: vi.fn(async () => undefined),
    consumeFlow: vi.fn(async () => null),
    purgeExpiredFlows: vi.fn(async () => 0),
    createSession: vi.fn(async () => undefined),
    findSession: vi.fn(async (id: string) => sessions.get(id) ?? null),
    touchSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async (id: string) => {
      sessions.delete(id);
    }),
    deleteSessionsFor: vi.fn(async () => 0),
  } as unknown as AuthRepository;

  const boards = new Map<string, BuilderComp>();

  const builder = {
    save: vi.fn(async (input: Omit<BuilderComp, 'id' | 'createdAt' | 'updatedAt'>) => {
      const saved: BuilderComp = {
        ...input,
        id: `board-${boards.size + 1}`,
        createdAt: '2026-08-14T00:00:00.000Z',
        updatedAt: '2026-08-14T00:00:00.000Z',
      };
      boards.set(saved.id, saved);
      return saved;
    }),
    findById: vi.fn(async (id: string) => boards.get(id) ?? null),
    update: vi.fn(async (id: string, puuid: string) => {
      const existing = boards.get(id);
      // Mirrors the real WHERE clause: ownership is the authorization check.
      return existing && existing.puuid === puuid ? existing : null;
    }),
    listForPlayer: vi.fn(async (puuid: string) =>
      [...boards.values()].filter((board) => board.puuid === puuid),
    ),
    delete: vi.fn(async () => true),
  } as unknown as BuilderRepository;

  /**
   * A small but internally consistent slice of game data: Vanguard/Sorcerer
   * champions, two recipes, and one emblem, so builder tests exercise real
   * trait resolution rather than a stub that always agrees.
   */
  const gameData = {
    forPatch: vi.fn(async (forPatchId: string) => ({
      patch: forPatchId,
      championNames: new Map([
        ['TFT17_Zoe', 'Zoe'],
        ['TFT17_Leona', 'Leona'],
        ['TFT17_Braum', 'Braum'],
        ['TFT17_Lulu', 'Lulu'],
      ]),
      costs: new Map([
        ['TFT17_Zoe', 4],
        ['TFT17_Leona', 2],
        ['TFT17_Braum', 2],
        ['TFT17_Lulu', 1],
      ]),
      traitsByChampion: new Map([
        ['TFT17_Zoe', ['Sorcerer']],
        ['TFT17_Leona', ['Vanguard']],
        ['TFT17_Braum', ['Vanguard']],
        ['TFT17_Lulu', ['Sorcerer']],
      ]),
      traits: new Map([
        [
          'Vanguard',
          { id: 'Vanguard', name: 'Vanguard', type: 'class' as const, breakpoints: [2, 4] },
        ],
        [
          'Sorcerer',
          { id: 'Sorcerer', name: 'Sorcerer', type: 'origin' as const, breakpoints: [2, 4] },
        ],
      ]),
      recipes: new Map([
        [
          'TFT_Item_RabadonsDeathcap',
          {
            id: 'TFT_Item_RabadonsDeathcap',
            name: 'Rabadons',
            components: ['Rod', 'Rod'] as [string, string],
            tags: ['AP'],
          },
        ],
        [
          'TFT_Item_WarmogsArmor',
          {
            id: 'TFT_Item_WarmogsArmor',
            name: 'Warmogs',
            components: ['Belt', 'Belt'] as [string, string],
            tags: ['tank'],
          },
        ],
      ]),
      emblemGrants: new Map([['TFT_Item_VanguardEmblem', 'Vanguard']]),
      roles: new Map([
        ['TFT17_Zoe', 'carry' as const],
        ['TFT17_Leona', 'tank' as const],
        ['TFT17_Braum', 'tank' as const],
        ['TFT17_Lulu', 'support' as const],
      ]),
    })),
    invalidate: vi.fn(),
  } as unknown as GameDataRepository;

  /**
   * Patch history with two archived snapshots, so diff and meta-shift routes
   * exercise a real comparison rather than an empty one.
   */
  const snapshotEntries = (tier: 'S' | 'A' | 'B' | 'C') => [
    { ...tierListSnapshot().entries[0]!, tier },
  ];

  const archived = new Map([
    [
      'v1',
      {
        version: 'v1',
        patch: patch ?? '17.9',
        formulaVersion: '1.0.0',
        publishedAt: '2026-08-14T00:00:00.000Z',
        compCount: 1,
        entries: snapshotEntries('C'),
      },
    ],
    [
      'v2',
      {
        version: 'v2',
        patch: patch ?? '17.9',
        formulaVersion: '1.0.0',
        publishedAt: '2026-08-14T01:00:00.000Z',
        compCount: 1,
        entries: snapshotEntries('S'),
      },
    ],
  ]);

  const patches = {
    list: vi.fn(async () => [
      {
        id: '17.9',
        setNumber: 17,
        setName: 'Into the Arcane',
        releaseDate: '2026-07-30',
        isCurrentPatch: true,
        archived: false,
        balanceChanges: [
          { entityType: 'champion', entityId: 'TFT17_Zoe', summary: 'Spell damage reduced.' },
        ],
        metaImpactSummary: options.metaImpactSummary ?? null,
      },
    ]),
    findById: vi.fn(async () => null),
    latest: vi.fn(async () => ({
      id: '17.9',
      setNumber: 17,
      setName: 'Into the Arcane',
      releaseDate: '2026-07-30',
      isCurrentPatch: true,
      archived: false,
      balanceChanges: [],
      metaImpactSummary: options.metaImpactSummary ?? null,
    })),
    approveMetaSummary: vi.fn(async () => undefined),
    saveSnapshot: vi.fn(async () => undefined),
    listSnapshots: vi.fn(async () =>
      [...archived.values()].map(({ entries: _entries, ...summary }) => summary),
    ),
    findSnapshot: vi.fn(async (_patch: string, version: string) => archived.get(version) ?? null),
    previousSnapshot: vi.fn(async (_patch: string, version: string) =>
      version === 'v2' ? (archived.get('v1') ?? null) : null,
    ),
    recordMetaShifts: vi.fn(async () => 0),
    recentMetaShifts: vi.fn(async () => [
      {
        patch: '17.9',
        compId: 'vanguard-zoe',
        fromTier: 'C',
        toTier: 'S',
        fromVersion: 'v1',
        toVersion: 'v2',
        detectedAt: '2026-08-14T01:00:00.000Z',
      },
    ]),
  } as unknown as PatchRepository;

  const storedPrefs = new Map<string, unknown[]>();
  const storedBookmarks = new Map<string, { kind: string; targetId: string }[]>();

  const notifications = {
    prefsFor: vi.fn(async (puuid: string) => storedPrefs.get(puuid) ?? options.prefs ?? []),
    replacePrefs: vi.fn(async (puuid: string, prefs: unknown[]) => {
      storedPrefs.set(puuid, prefs);
    }),
    unsubscribeCategory: vi.fn(async () => 1),
    bookmarksFor: vi.fn(async (puuid: string) => storedBookmarks.get(puuid) ?? []),
    addBookmark: vi.fn(async (puuid: string, bookmark: { kind: string; targetId: string }) => {
      const existing = storedBookmarks.get(puuid) ?? [];
      if (!existing.some((b) => b.kind === bookmark.kind && b.targetId === bookmark.targetId)) {
        storedBookmarks.set(puuid, [...existing, bookmark]);
      }
    }),
    removeBookmark: vi.fn(async (puuid: string, bookmark: { kind: string; targetId: string }) => {
      const existing = storedBookmarks.get(puuid) ?? [];
      const next = existing.filter(
        (b) => !(b.kind === bookmark.kind && b.targetId === bookmark.targetId),
      );
      storedBookmarks.set(puuid, next);
      return next.length !== existing.length;
    }),
    subscribers: vi.fn(async () => []),
    enqueue: vi.fn(async () => 0),
    claimPending: vi.fn(async () => []),
    markSent: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  } as unknown as NotificationRepository;

  return {
    store,
    context: {
      config: testConfig(options.config),
      cache,
      comps,
      augments,
      ingestion,
      olap,
      augmentStats,
      reference,
      players,
      auth,
      builder,
      gameData,
      patches,
      notifications,
      log: () => undefined,
    },
  };
}

const defaultProfile = (puuid: string): PlayerProfile => ({
  puuid,
  region: 'euw1',
  riotId: 'Codex#EUW',
  linkedAt: '2026-08-01T00:00:00.000Z',
  lastSyncedAt: null,
  notificationPrefs: [],
  coachingNarrativeOptOut: false,
});

/**
 * Issues a real token for a seeded session, so route tests exercise the actual
 * verification path rather than stubbing authentication out.
 */
export function authHeaderFor(
  context: AppContext,
  session: { puuid: string; sessionId: string },
): Record<string, string> {
  return {
    authorization: `Bearer ${issueAccessToken(
      { puuid: session.puuid, sessionId: session.sessionId },
      context.config.jwtSecret,
    )}`,
  };
}
