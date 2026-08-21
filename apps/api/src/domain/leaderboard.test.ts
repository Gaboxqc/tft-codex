/**
 * Friends leaderboard tests (task 6.8).
 *
 * _Requirements: 4.6, 4.7_
 */
import { describe, expect, it } from 'vitest';

import {
  buildLeaderboard,
  describeStanding,
  MIN_RANKED_GAMES,
  type FriendStats,
} from './leaderboard.js';

const player = (puuid: string, avgPlacement: number | null, games = 50): FriendStats => ({
  puuid,
  riotId: `${puuid}#EUW`,
  games,
  avgPlacement,
  top4Rate: avgPlacement === null ? null : 0.5,
});

const VIEWER = 'you';

describe('Ranking direction (_Requirements: 4.6_)', () => {
  it('ranks the lowest average placement first, because 1st is the good end', () => {
    // Getting this backwards silently inverts the whole board, which is why it
    // is asserted rather than left to a comment.
    const rows = buildLeaderboard([player('a', 4.8), player('b', 3.2), player('c', 4.1)], {
      viewerPuuid: VIEWER,
    });

    expect(rows.map((row) => row.puuid)).toEqual(['b', 'c', 'a']);
    expect(rows[0]!.rank).toBe(1);
  });

  it('breaks a tie toward the better-evidenced result', () => {
    const rows = buildLeaderboard([player('fewer', 4.0, 25), player('more', 4.0, 300)], {
      viewerPuuid: VIEWER,
    });

    expect(rows[0]!.puuid).toBe('more');
  });

  it('gives genuinely tied players the same rank', () => {
    // Two players on the same average should not be told one is ahead because
    // of row order.
    const rows = buildLeaderboard(
      [player('a', 4.0, 100), player('b', 4.0, 100), player('c', 4.5)],
      { viewerPuuid: VIEWER },
    );

    expect(rows[0]!.rank).toBe(1);
    expect(rows[1]!.rank).toBe(1);
    // Competition ranking: the next distinct value skips the shared slot.
    expect(rows[2]!.rank).toBe(3);
  });
});

describe('Small samples (_Requirements: 4.6_)', () => {
  it('does not rank a player below the game floor', () => {
    // Three games and a 2.1 average is variance, not skill, and a board that
    // says otherwise is worse than useless among friends.
    const rows = buildLeaderboard([player('lucky', 2.1, 3), player('steady', 4.0, 200)], {
      viewerPuuid: VIEWER,
    });

    const lucky = rows.find((row) => row.puuid === 'lucky')!;

    expect(lucky.provisional).toBe(true);
    expect(lucky.rank).toBeNull();
    expect(rows[0]!.puuid).toBe('steady');
  });

  it('still shows an unranked player, rather than hiding them', () => {
    // Being absent from your own friends list is confusing.
    const rows = buildLeaderboard([player('new', 3.0, 1)], { viewerPuuid: VIEWER });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.provisional).toBe(true);
    expect(rows[0]!.games).toBe(1);
  });

  it('treats a player with no placements at all as unranked', () => {
    const rows = buildLeaderboard([player('fresh', null, 0)], { viewerPuuid: VIEWER });
    expect(rows[0]!.provisional).toBe(true);
  });

  it('sorts every ranked player above every provisional one', () => {
    const rows = buildLeaderboard([player('lucky', 1.5, 2), player('a', 4.6), player('b', 4.2)], {
      viewerPuuid: VIEWER,
    });

    expect(rows.map((row) => row.provisional)).toEqual([false, false, true]);
  });
});

describe('Marking the viewer (_Requirements: 4.6_)', () => {
  it('flags the viewer’s own row', () => {
    const rows = buildLeaderboard([player('a', 4.0), player(VIEWER, 3.5)], {
      viewerPuuid: VIEWER,
    });

    expect(rows.find((row) => row.isYou)?.puuid).toBe(VIEWER);
    expect(rows.filter((row) => row.isYou)).toHaveLength(1);
  });
});

describe('Standing summary (_Requirements: 4.6_)', () => {
  const standing = (stats: FriendStats[]) =>
    describeStanding(buildLeaderboard(stats, { viewerPuuid: VIEWER }));

  it('says how many friends are ahead', () => {
    expect(standing([player(VIEWER, 4.5), player('a', 3.0), player('b', 3.5)])).toBe(
      '2 of your friends have a better average placement than you right now.',
    );
  });

  it('says so plainly when the viewer leads', () => {
    expect(standing([player(VIEWER, 3.0), player('a', 4.5)])).toContain('best average placement');
  });

  it('tells a provisional viewer how many games are left', () => {
    const rows = standing([player(VIEWER, 3.0, MIN_RANKED_GAMES - 4), player('a', 4.0)]);
    expect(rows).toBe("4 more ranked games and you'll be ranked here.");
  });

  it('uses the singular for a single remaining game', () => {
    expect(standing([player(VIEWER, 3.0, MIN_RANKED_GAMES - 1)])).toContain('1 more ranked game ');
  });

  it('handles being the only ranked player', () => {
    expect(standing([player(VIEWER, 3.0), player('new', 3.0, 1)])).toBe(
      'You are the only ranked player here so far.',
    );
  });

  it('says so when the viewer is not on the board at all', () => {
    expect(standing([player('a', 3.0)])).toBe('You are not on this board.');
  });
});

describe('What a leaderboard row may carry (_Requirements: 4.7_)', () => {
  it('exposes no per-match or augment fields', () => {
    // R4.7 gates augment-by-placement analysis even for a player's own data,
    // so a friend's is plainly out — and there is no field here to put it in.
    const rows = buildLeaderboard([player('a', 4.0)], { viewerPuuid: VIEWER });
    const keys = Object.keys(rows[0]!);

    expect(keys).toEqual([
      'puuid',
      'riotId',
      'games',
      'avgPlacement',
      'top4Rate',
      'rank',
      'isYou',
      'provisional',
    ]);
    expect(keys.join(' ')).not.toMatch(/augment|match|placement_by|history/i);
  });
});
