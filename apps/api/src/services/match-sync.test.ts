import type { RiotApiClient } from '@tft-codex/riot-client';
import { RiotApiError } from '@tft-codex/riot-client';
import type { CompSignature } from '@tft-codex/shared-types';
import { describe, expect, it, vi } from 'vitest';

import type { PlayerRepository, StoredMatch } from '../repositories/player-repository.js';
import { MatchSyncService } from './match-sync.js';

const signatures = new Map<string, CompSignature[]>([
  [
    '17.9',
    [
      {
        compId: 'vanguard-zoe',
        patch: '17.9',
        coreTraits: ['Vanguard'],
        minTraitCounts: { Vanguard: 4 },
        carryChampionIds: ['TFT17_Zoe'],
      },
    ],
  ],
]);

const matchPayload = (matchId: string, overrides: Record<string, unknown> = {}) => ({
  metadata: { match_id: matchId, participants: ['me'] },
  info: {
    game_datetime: 1_754_500_000_000,
    game_length: 2100,
    game_version: 'Version 17.9.1.1 (x)',
    queue_id: 1100,
    participants: [
      {
        puuid: 'me',
        placement: 3,
        level: 8,
        last_round: 30,
        gold_left: 14,
        players_eliminated: 2,
        time_eliminated: 1900,
        total_damage_to_players: 110,
        augments: ['TFT17_Augment_SorcererHeart'],
        traits: [{ name: 'Vanguard', num_units: 4, tier_current: 2, tier_total: 3 }],
        units: [
          { character_id: 'TFT17_Zoe', rarity: 3, tier: 2, itemNames: ['a', 'b'] },
          { character_id: 'TFT17_Leona', rarity: 1, tier: 2, itemNames: ['c'] },
        ],
      },
    ],
    ...overrides,
  },
});

function fakePlayers(known: string[] = []) {
  const stored: StoredMatch[] = [];
  const repo = {
    knownMatchIds: vi.fn(async () => new Set(known)),
    upsertMatches: vi.fn(async (matches: readonly StoredMatch[]) => {
      // Model the ON CONFLICT DO NOTHING: only genuinely new rows count.
      let inserted = 0;
      for (const match of matches) {
        if (stored.some((existing) => existing.matchId === match.matchId)) continue;
        stored.push(match);
        inserted += 1;
      }
      return inserted;
    }),
    markSynced: vi.fn(async () => undefined),
  };
  return { repo: repo as unknown as PlayerRepository, stored, spies: repo };
}

const fakeRiot = (overrides: Record<string, unknown> = {}) =>
  ({
    getMatchIdsByPuuid: vi.fn(async () => ['M1', 'M2']),
    getMatch: vi.fn(async (matchId: string) => matchPayload(matchId)),
    ...overrides,
  }) as unknown as RiotApiClient;

describe('MatchSyncService (_Requirements: 4.1, 4.2_)', () => {
  it('stores matches tagged with the detected comp', async () => {
    const { repo, stored } = fakePlayers();
    const result = await new MatchSyncService({
      riot: fakeRiot(),
      players: repo,
      signaturesByPatch: signatures,
    }).sync('me');

    expect(result.stored).toBe(2);
    expect(stored[0]!.detectedCompId).toBe('vanguard-zoe');
    expect(stored[0]!.placement).toBe(3);
    expect(stored[0]!.patch).toBe('17.9');
  });

  it('extracts a single endpoint at the elimination round', async () => {
    // Riot exposes no TFT timeline — see match-extraction.ts. One honest point
    // beats a synthesised curve.
    const { repo, stored } = fakePlayers();
    await new MatchSyncService({
      riot: fakeRiot(),
      players: repo,
      signaturesByPatch: signatures,
    }).sync('me');

    expect(stored[0]!.levelCurve).toEqual([{ round: '5-6', value: 8 }]);
    expect(stored[0]!.goldCurve).toEqual([{ round: '5-6', value: 14 }]);
  });

  it('stores augment ids without any outcome joined to them (R4.7)', async () => {
    const { repo, stored } = fakePlayers();
    await new MatchSyncService({
      riot: fakeRiot(),
      players: repo,
      signaturesByPatch: signatures,
    }).sync('me');

    expect(stored[0]!.augmentsPicked).toEqual(['TFT17_Augment_SorcererHeart']);
  });
});

describe('Idempotency (_Requirements: 4.1, 12.2_)', () => {
  it('never re-fetches a match it already has', async () => {
    // Filtering before fetching is what makes a repeat sync nearly free on
    // Riot budget, rather than relying on the upsert to discard.
    const { repo } = fakePlayers(['M1']);
    const riot = fakeRiot();

    const result = await new MatchSyncService({
      riot,
      players: repo,
      signaturesByPatch: signatures,
    }).sync('me');

    expect(result.alreadyKnown).toBe(1);
    expect(vi.mocked(riot.getMatch).mock.calls.map((call) => call[0])).toEqual(['M2']);
  });

  it('re-running a sync stores nothing new and duplicates nothing', async () => {
    const { repo, stored, spies } = fakePlayers();
    // Model the repository learning what it stored between runs.
    spies.knownMatchIds.mockImplementation(async () => new Set(stored.map((m) => m.matchId)));

    const service = new MatchSyncService({
      riot: fakeRiot(),
      players: repo,
      signaturesByPatch: signatures,
    });

    const first = await service.sync('me');
    const second = await service.sync('me');

    expect(first.stored).toBe(2);
    expect(second.stored).toBe(0);
    expect(stored).toHaveLength(2);
  });

  it('marks the profile synced even when nothing new arrived', async () => {
    const { repo, spies } = fakePlayers(['M1', 'M2']);
    await new MatchSyncService({
      riot: fakeRiot(),
      players: repo,
      signaturesByPatch: signatures,
    }).sync('me');

    expect(spies.markSynced).toHaveBeenCalledWith('me');
  });
});

describe('Filtering and resilience', () => {
  it('skips non-ranked queues', async () => {
    const riot = fakeRiot({
      getMatch: vi.fn(async (matchId: string) => matchPayload(matchId, { queue_id: 1130 })),
    });
    const { repo } = fakePlayers();

    const result = await new MatchSyncService({
      riot,
      players: repo,
      signaturesByPatch: signatures,
    }).sync('me');

    expect(result.stored).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it('skips a 404 but leaves a 5xx unstored for the next run', async () => {
    const riot = fakeRiot({
      getMatch: vi
        .fn()
        .mockRejectedValueOnce(new RiotApiError('gone', { status: 404, endpoint: '/m' }))
        .mockRejectedValueOnce(new RiotApiError('down', { status: 503, endpoint: '/m' })),
    });
    const { repo } = fakePlayers();

    const result = await new MatchSyncService({
      riot,
      players: repo,
      signaturesByPatch: signatures,
    }).sync('me');

    expect(result.skipped).toBe(1);
    expect(result.stored).toBe(0);
  });

  it('uses the player lane so signups cannot starve the meta refresh', async () => {
    const riot = fakeRiot();
    const { repo } = fakePlayers();

    await new MatchSyncService({
      riot,
      players: repo,
      signaturesByPatch: signatures,
    }).sync('me');

    for (const call of vi.mocked(riot.getMatch).mock.calls) {
      expect((call[1] as { lane?: string })?.lane).toBe('player');
    }
    expect((vi.mocked(riot.getMatchIdsByPuuid).mock.calls[0]![1] as { lane?: string })?.lane).toBe(
      'player',
    );
  });

  it('skips a match whose participant list does not include the player', async () => {
    const riot = fakeRiot({
      getMatch: vi.fn(async (matchId: string) => ({
        ...matchPayload(matchId),
        info: { ...matchPayload(matchId).info, participants: [] },
      })),
    });
    const { repo } = fakePlayers();

    expect(
      (
        await new MatchSyncService({
          riot,
          players: repo,
          signaturesByPatch: signatures,
        }).sync('me')
      ).stored,
    ).toBe(0);
  });
});
