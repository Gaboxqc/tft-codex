import type { RiotApiClient } from '@tft-codex/riot-client';
import { RiotApiError } from '@tft-codex/riot-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IngestionRepository } from '../repositories/ingestion-repository.js';
import { Crawler } from './crawler.js';

/**
 * In-memory stand-in for IngestionRepository. Only the behaviours the crawler
 * depends on — dedup, crawl ordering, skip marking — are modelled, and they are
 * modelled faithfully because those are exactly what these tests assert.
 */
function fakeRepository() {
  const seedPlayers = new Map<string, { puuid: string; platform: string; tier: string }>();
  const discovered = new Map<
    string,
    { regional: string; fetchedAt: Date | null; skipped: string | null }
  >();
  const rawMatches = new Map<string, unknown>();
  const crawledOrder: string[] = [];

  const repo = {
    upsertSeedPlayers: vi.fn(
      async (players: { puuid: string; platform: string; tier: string }[]) => {
        let added = 0;
        for (const player of players) {
          if (!seedPlayers.has(player.puuid)) added += 1;
          seedPlayers.set(player.puuid, player);
        }
        return added;
      },
    ),
    claimSeedPlayersToCrawl: vi.fn(async (limit: number) =>
      [...seedPlayers.values()].slice(0, limit),
    ),
    markSeedPlayersCrawled: vi.fn(async (puuids: string[]) => {
      crawledOrder.push(...puuids);
    }),
    recordDiscoveredMatches: vi.fn(async (matchIds: string[], regional: string) => {
      let added = 0;
      for (const id of matchIds) {
        if (discovered.has(id)) continue;
        discovered.set(id, { regional, fetchedAt: null, skipped: null });
        added += 1;
      }
      return added;
    }),
    claimMatchesToFetch: vi.fn(async (limit: number) =>
      [...discovered.entries()]
        .filter(([, value]) => !value.fetchedAt && !value.skipped)
        .slice(0, limit)
        .map(([matchId, value]) => ({ matchId, regional: value.regional })),
    ),
    skipMatch: vi.fn(async (matchId: string, reason: string) => {
      const entry = discovered.get(matchId);
      if (entry) entry.skipped = reason;
    }),
    upsertRawMatch: vi.fn(async (match: { matchId: string }) => {
      rawMatches.set(match.matchId, match);
      const entry = discovered.get(match.matchId);
      if (entry) entry.fetchedAt = new Date();
    }),
    startRun: vi.fn(async () => 1),
    finishRun: vi.fn(async () => undefined),
  };

  return {
    repo: repo as unknown as IngestionRepository,
    state: { discovered, rawMatches, crawledOrder },
    spies: repo,
  };
}

const matchPayload = (matchId: string, overrides: Record<string, unknown> = {}) => ({
  metadata: { match_id: matchId, participants: ['p1'] },
  info: {
    game_datetime: 1_754_500_000_000,
    game_length: 2100,
    game_version: 'Version 17.9.123.4567 (Jul 30 2026/PBE1/Releases/TFT)',
    queue_id: 1100,
    tft_set_number: 17,
    participants: [],
    ...overrides,
  },
});

function fakeRiot(overrides: Partial<Record<keyof RiotApiClient, unknown>> = {}) {
  return {
    getApexLeague: vi.fn(async (tier: string) => ({
      tier: tier.toUpperCase(),
      entries: [{ puuid: `${tier}-1`, leaguePoints: 100, wins: 1, losses: 1 }],
    })),
    getMatchIdsByPuuid: vi.fn(async () => ['EUW1_1', 'EUW1_2']),
    getMatch: vi.fn(async (matchId: string) => matchPayload(matchId)),
    ...overrides,
  } as unknown as RiotApiClient;
}

describe('Crawler.seedPlayers (_Requirements: 1.1_)', () => {
  it('seeds from all three apex tiers', async () => {
    const { repo } = fakeRepository();
    const riot = fakeRiot();
    const result = await new Crawler({
      riot,
      repository: repo,
      platform: 'euw1',
      regional: 'europe',
    }).seedPlayers();

    expect(riot.getApexLeague).toHaveBeenCalledTimes(3);
    expect(result.discovered).toBe(3);
    expect(result.newPlayers).toBe(3);
  });

  it('keeps seeding when one tier fails', async () => {
    // A region can genuinely have no Challenger entries early in a set; one
    // empty tier must not abort the whole seed.
    const { repo } = fakeRepository();
    const riot = fakeRiot({
      getApexLeague: vi
        .fn()
        .mockRejectedValueOnce(new RiotApiError('boom', { status: 503, endpoint: '/challenger' }))
        .mockResolvedValue({
          tier: 'MASTER',
          entries: [{ puuid: 'm-1', leaguePoints: 1, wins: 1, losses: 1 }],
        }),
    });

    const result = await new Crawler({
      riot,
      repository: repo,
      platform: 'euw1',
      regional: 'europe',
    }).seedPlayers();
    expect(result.discovered).toBe(2);
  });
});

describe('Crawler.discoverMatches (_Requirements: 1.2, 12.2_)', () => {
  it('deduplicates match ids across players', async () => {
    // Apex players share lobbies constantly — the same match id arrives from
    // up to 8 seeds. Dedup is the biggest single saving on rate-limit budget.
    const { repo, spies } = fakeRepository();
    const riot = fakeRiot();
    const crawler = new Crawler({ riot, repository: repo, platform: 'euw1', regional: 'europe' });

    await crawler.seedPlayers();
    const result = await crawler.discoverMatches();

    expect(result.matchIdsSeen).toBe(6); // 3 players × 2 ids
    expect(result.newMatchIds).toBe(2); // but only 2 distinct
    expect(spies.recordDiscoveredMatches).toHaveBeenCalledTimes(3);
  });

  it('rotates a 404ing player to the back of the queue instead of retrying first', async () => {
    // A transferred or banned account would otherwise be retried at the head
    // of every cycle forever.
    const { repo, state } = fakeRepository();
    const riot = fakeRiot({
      getMatchIdsByPuuid: vi
        .fn()
        .mockRejectedValueOnce(new RiotApiError('gone', { status: 404, endpoint: '/ids' }))
        .mockResolvedValue(['EUW1_9']),
    });
    const crawler = new Crawler({ riot, repository: repo, platform: 'euw1', regional: 'europe' });

    await crawler.seedPlayers();
    const result = await crawler.discoverMatches();

    expect(result.playersCrawled).toBe(3);
    expect(state.crawledOrder).toContain('challenger-1');
  });

  it('leaves a player unmarked on a transient failure so it is retried', async () => {
    const { repo, state } = fakeRepository();
    const riot = fakeRiot({
      getMatchIdsByPuuid: vi
        .fn()
        .mockRejectedValueOnce(new RiotApiError('down', { status: 503, endpoint: '/ids' }))
        .mockResolvedValue(['EUW1_9']),
    });
    const crawler = new Crawler({ riot, repository: repo, platform: 'euw1', regional: 'europe' });

    await crawler.seedPlayers();
    await crawler.discoverMatches();

    expect(state.crawledOrder).not.toContain('challenger-1');
  });
});

describe('Crawler.fetchMatches (_Requirements: 1.1, 1.3_)', () => {
  const setup = async (riot: RiotApiClient) => {
    const fixture = fakeRepository();
    const crawler = new Crawler({
      riot,
      repository: fixture.repo,
      platform: 'euw1',
      regional: 'europe',
    });
    await crawler.seedPlayers();
    await crawler.discoverMatches();
    return { crawler, ...fixture };
  };

  it('stores ranked TFT matches with the parsed patch', async () => {
    const { crawler, state, spies } = await setup(fakeRiot());
    const result = await crawler.fetchMatches();

    expect(result.stored).toBe(2);
    expect(state.rawMatches.size).toBe(2);
    expect(spies.upsertRawMatch).toHaveBeenCalledWith(
      expect.objectContaining({ patch: '17.9', queueId: 1100 }),
    );
  });

  it('skips non-ranked queues permanently rather than storing them', async () => {
    // Storing them inflates raw_matches with rows aggregation can never use,
    // and re-fetching them each cycle wastes budget the live refresh needs.
    const riot = fakeRiot({
      getMatch: vi.fn(async (matchId: string) => matchPayload(matchId, { queue_id: 1130 })),
    });
    const { crawler, state } = await setup(riot);
    const result = await crawler.fetchMatches();

    expect(result.stored).toBe(0);
    expect(result.skipped).toBe(2);
    expect([...state.discovered.values()].every((entry) => entry.skipped?.includes('1130'))).toBe(
      true,
    );
  });

  it('skips a match whose game_version it cannot parse', async () => {
    // An unpatched row would silently mislabel every stat derived from it.
    const riot = fakeRiot({
      getMatch: vi.fn(async (matchId: string) =>
        matchPayload(matchId, { game_version: 'brand new format' }),
      ),
    });
    const { crawler } = await setup(riot);
    const result = await crawler.fetchMatches();

    expect(result.stored).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it('skips a 404 permanently but leaves a 5xx queued for retry', async () => {
    const riot = fakeRiot({
      getMatch: vi
        .fn()
        .mockRejectedValueOnce(new RiotApiError('gone', { status: 404, endpoint: '/match' }))
        .mockRejectedValueOnce(new RiotApiError('down', { status: 503, endpoint: '/match' })),
    });
    const { crawler, state } = await setup(riot);
    const result = await crawler.fetchMatches();

    expect(result.stored).toBe(0);
    expect(result.skipped).toBe(1);
    // The 503'd match stays claimable next cycle.
    expect(
      [...state.discovered.values()].filter((entry) => !entry.skipped && !entry.fetchedAt),
    ).toHaveLength(1);
  });
});

describe('Crawler.runCycle (_Requirements: 11.5_)', () => {
  let fixture: ReturnType<typeof fakeRepository>;

  beforeEach(() => {
    fixture = fakeRepository();
  });

  it('records a successful run for the healthcheck metric', async () => {
    await new Crawler({
      riot: fakeRiot(),
      repository: fixture.repo,
      platform: 'euw1',
      regional: 'europe',
    }).runCycle();

    expect(fixture.spies.startRun).toHaveBeenCalledWith('crawl');
    expect(fixture.spies.finishRun).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('records a failed run and rethrows rather than reporting success', async () => {
    const riot = fakeRiot();
    fixture.spies.upsertSeedPlayers.mockRejectedValueOnce(new Error('postgres down'));

    await expect(
      new Crawler({
        riot,
        repository: fixture.repo,
        platform: 'euw1',
        regional: 'europe',
      }).runCycle(),
    ).rejects.toThrow('postgres down');

    expect(fixture.spies.finishRun).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'failed', error: 'postgres down' }),
    );
  });
});
