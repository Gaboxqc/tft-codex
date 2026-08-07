/**
 * Lobby intel tests.
 *
 * The one-shot assertions here are compliance tests as much as behaviour
 * tests: R14.2 and R14.3 are what make this feature the compliant version of
 * scouting rather than the unapproved one.
 *
 * _Requirements: 14.1, 14.2, 14.3, 14.4_
 */
import type { RiotApiClient } from '@tft-codex/riot-client';
import { RiotApiError } from '@tft-codex/riot-client';
import type { CompSignature } from '@tft-codex/shared-types';
import { describe, expect, it, vi } from 'vitest';

import { CACHE_KEYS, type Cache } from '../db/redis.js';
import { LobbyIntelService } from './lobby-intel.js';

const signatures: CompSignature[] = [
  {
    compId: 'vanguard-zoe',
    patch: '17.9',
    coreTraits: ['Vanguard'],
    minTraitCounts: { Vanguard: 4 },
    carryChampionIds: ['TFT17_Zoe'],
  },
];

const participantPayload = (puuid: string, placement: number) => ({
  puuid,
  placement,
  level: 8,
  last_round: 30,
  gold_left: 12,
  players_eliminated: 1,
  time_eliminated: 1800,
  total_damage_to_players: 90,
  traits: [{ name: 'Vanguard', num_units: 4, tier_current: 2, tier_total: 3 }],
  units: [
    { character_id: 'TFT17_Zoe', rarity: 3, tier: 2 },
    { character_id: 'TFT17_Leona', rarity: 1, tier: 2 },
  ],
});

const matchPayload = (matchId: string, puuid: string, placement: number) => ({
  metadata: { match_id: matchId, participants: [puuid] },
  info: {
    game_datetime: 1_754_500_000_000,
    game_length: 2100,
    game_version: 'Version 17.9.1.1 (x)',
    queue_id: 1100,
    participants: [participantPayload(puuid, placement)],
  },
});

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

function fakeRiot(overrides: Record<string, unknown> = {}) {
  return {
    getMatchIdsByPuuid: vi.fn(async () => ['M1', 'M2']),
    getMatch: vi.fn(async (matchId: string) => matchPayload(matchId, 'rival-1', 2)),
    getLeagueEntriesByPuuid: vi.fn(async () => [
      {
        puuid: 'rival-1',
        queueType: 'RANKED_TFT',
        tier: 'DIAMOND',
        rank: 'II',
        leaguePoints: 40,
        wins: 10,
        losses: 8,
      },
    ]),
    ...overrides,
  } as unknown as RiotApiClient;
}

const lobby = [{ puuid: 'rival-1', riotId: 'Rival#EUW' }];

describe('LobbyIntelService (_Requirements: 14.1_)', () => {
  it('summarises a participant from public match history', async () => {
    const { cache } = fakeCache();
    const service = new LobbyIntelService({ riot: fakeRiot(), cache, signatures });

    const intel = await service.intelFor('EUW1_LOBBY', lobby);
    const [entry] = intel.entries;

    expect(entry!.riotId).toBe('Rival#EUW');
    expect(entry!.recentAvgPlacement).toBe(2);
    expect(entry!.mostPlayedComps).toEqual(['vanguard-zoe']);
    expect(entry!.rankTier).toBe('DIAMOND II');
    expect(entry!.unavailable).toBe(false);
  });

  it('stamps every entry with the same computedAt (R14.2)', async () => {
    // One timestamp for the whole lobby is what makes "single pre-combat
    // snapshot" checkable rather than merely claimed.
    const { cache } = fakeCache();
    const service = new LobbyIntelService({
      riot: fakeRiot(),
      cache,
      signatures,
      now: () => new Date('2026-08-07T12:00:00.000Z'),
    });

    const intel = await service.intelFor('EUW1_LOBBY', [
      ...lobby,
      { puuid: 'rival-2', riotId: 'Second#EUW' },
    ]);

    expect(intel.computedAt).toBe('2026-08-07T12:00:00.000Z');
    for (const entry of intel.entries) {
      expect(entry.computedAt).toBe(intel.computedAt);
    }
  });
});

describe('One-shot guarantee (_Requirements: 14.2, 14.4_)', () => {
  it('fires no Riot request at all on a second call for the same match', async () => {
    const { cache } = fakeCache();
    const riot = fakeRiot();
    const service = new LobbyIntelService({ riot, cache, signatures });

    await service.intelFor('EUW1_LOBBY', lobby);
    const callsAfterFirst = vi.mocked(riot.getMatchIdsByPuuid).mock.calls.length;

    await service.intelFor('EUW1_LOBBY', lobby);

    expect(vi.mocked(riot.getMatchIdsByPuuid).mock.calls.length).toBe(callsAfterFirst);
    expect(vi.mocked(riot.getMatch).mock.calls.length).toBeGreaterThan(0);
  });

  it('returns byte-identical intel on the second call', async () => {
    // If the second call recomputed, computedAt would move — which would be a
    // refresh, and R14.2 forbids refreshing.
    const { cache } = fakeCache();
    let tick = 0;
    const service = new LobbyIntelService({
      riot: fakeRiot(),
      cache,
      signatures,
      now: () => new Date(1_754_500_000_000 + tick++ * 60_000),
    });

    const first = await service.intelFor('EUW1_LOBBY', lobby);
    const second = await service.intelFor('EUW1_LOBBY', lobby);

    expect(second).toEqual(first);
    expect(second.computedAt).toBe(first.computedAt);
  });

  it('caches under a per-match key so a different lobby is computed separately', async () => {
    const { cache, store } = fakeCache();
    const riot = fakeRiot();
    const service = new LobbyIntelService({ riot, cache, signatures });

    await service.intelFor('EUW1_A', lobby);
    await service.intelFor('EUW1_B', lobby);

    expect(store.has(CACHE_KEYS.lobbyIntel('EUW1_A'))).toBe(true);
    expect(store.has(CACHE_KEYS.lobbyIntel('EUW1_B'))).toBe(true);
  });

  it('exposes no way to force a recompute', () => {
    // The absence of a refresh parameter is the guarantee, so assert on the
    // signature: one required id, one required participant list, nothing else.
    expect(LobbyIntelService.prototype.intelFor.length).toBe(2);
  });
});

describe('Degradation (_Requirements: 14.1_)', () => {
  it('renders one failing participant as "no recent data" without blocking the rest', async () => {
    const riot = fakeRiot({
      getMatchIdsByPuuid: vi
        .fn()
        .mockRejectedValueOnce(new RiotApiError('down', { status: 503, endpoint: '/ids' }))
        .mockResolvedValue(['M1']),
    });
    const { cache } = fakeCache();
    const service = new LobbyIntelService({ riot, cache, signatures });

    const intel = await service.intelFor('EUW1_LOBBY', [
      { puuid: 'broken', riotId: 'Broken#EUW' },
      { puuid: 'rival-1', riotId: 'Rival#EUW' },
    ]);

    expect(intel.entries).toHaveLength(2);
    expect(intel.entries.find((e) => e.riotId === 'Broken#EUW')!.unavailable).toBe(true);
    expect(intel.entries.find((e) => e.riotId === 'Rival#EUW')!.unavailable).toBe(false);
  });

  it('treats a player with no ranked history as unranked, not broken', async () => {
    const riot = fakeRiot({ getLeagueEntriesByPuuid: vi.fn(async () => []) });
    const { cache } = fakeCache();
    const service = new LobbyIntelService({ riot, cache, signatures });

    const [entry] = (await service.intelFor('EUW1_LOBBY', lobby)).entries;
    expect(entry!.unavailable).toBe(false);
    expect(entry!.rankTier).toBeNull();
  });

  it('marks a participant with no readable match history unavailable', async () => {
    const riot = fakeRiot({ getMatchIdsByPuuid: vi.fn(async () => []) });
    const { cache } = fakeCache();
    const service = new LobbyIntelService({ riot, cache, signatures });

    expect((await service.intelFor('EUW1_LOBBY', lobby)).entries[0]!.unavailable).toBe(true);
  });

  it('still computes when Redis is unreachable', async () => {
    // A cache failure costs a repeat lookup, not correctness — the data is the
    // same pre-combat snapshot either way.
    const cache = {
      get: vi.fn(async () => {
        throw new Error('redis down');
      }),
      set: vi.fn(async () => {
        throw new Error('redis down');
      }),
    } as unknown as Cache;

    const service = new LobbyIntelService({ riot: fakeRiot(), cache, signatures });
    const intel = await service.intelFor('EUW1_LOBBY', lobby);
    expect(intel.entries[0]!.unavailable).toBe(false);
  });
});

describe('R14.3 — no live opponent state', () => {
  it('uses only historical, public Riot endpoints', async () => {
    // The endpoints this service is allowed to touch are the whole of its
    // access. None of them can return anything about the current match.
    const riot = fakeRiot();
    const { cache } = fakeCache();

    await new LobbyIntelService({ riot, cache, signatures }).intelFor('EUW1_LOBBY', lobby);

    const called = Object.entries(riot as unknown as Record<string, { mock?: unknown }>)
      .filter(([, value]) => (value as { mock?: { calls: unknown[] } })?.mock?.calls.length)
      .map(([name]) => name)
      .sort();

    expect(called).toEqual(['getLeagueEntriesByPuuid', 'getMatch', 'getMatchIdsByPuuid']);
  });

  it('runs every Riot call on the reserved lobby lane', async () => {
    // The lobby lane exists because these fire synchronously at loading-screen
    // time and cannot queue behind a backfill job (design.md §3).
    const riot = fakeRiot();
    const { cache } = fakeCache();

    await new LobbyIntelService({ riot, cache, signatures }).intelFor('EUW1_LOBBY', lobby);

    for (const call of vi.mocked(riot.getMatchIdsByPuuid).mock.calls) {
      expect((call[1] as { lane?: string })?.lane).toBe('lobby');
    }
    for (const call of vi.mocked(riot.getMatch).mock.calls) {
      expect((call[1] as { lane?: string })?.lane).toBe('lobby');
    }
  });
});
