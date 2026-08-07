/**
 * Test doubles for building an `AppContext` without Postgres, Redis or
 * ClickHouse.
 *
 * Shared by the route integration tests and the compliance suite so both drive
 * the same app assembly the server uses — a test that stubbed the routes
 * themselves would happily pass while the real gateway leaked.
 */
import { vi } from 'vitest';
import type { TierList } from '@tft-codex/shared-types';

import type { AppConfig } from '../config.js';
import { CACHE_KEYS, type Cache } from '../db/redis.js';
import type { CompMetadata, CompRepository } from '../repositories/comp-repository.js';
import type { IngestionRepository } from '../repositories/ingestion-repository.js';
import type { OlapReadRepository } from '../repositories/olap-repository.js';
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

export interface TestContextOptions {
  config?: Partial<AppConfig>;
  snapshot?: TierList | null;
  comps?: CompMetadata[];
  currentPatch?: string | null;
  lastPublishedAt?: Date | null;
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
    patchesWithStats: vi.fn(async () => (patch ? [patch] : [])),
  } as unknown as OlapReadRepository;

  return {
    store,
    context: {
      config: testConfig(options.config),
      cache,
      comps,
      ingestion,
      olap,
      log: () => undefined,
    },
  };
}
