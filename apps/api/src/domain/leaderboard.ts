/**
 * The friends comparison leaderboard (task 6.8).
 *
 * Pure ranking over aggregates that have already been computed. What is *not*
 * here is the point: no match list, no per-game rows, no augment breakdown.
 * R4.7 gates augment-by-placement analysis even for a player's own data, so a
 * friend's is plainly out, and there is no field on these types to put it in.
 *
 * Ranking is by average placement, ascending — in TFT, 1st is the good end.
 * Getting that backwards would silently invert the whole board, so it is
 * asserted in the tests rather than left to a comment.
 *
 * _Requirements: 4.6, 4.7_
 */

export interface FriendStats {
  puuid: string;
  riotId: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
}

export interface LeaderboardRow extends FriendStats {
  /** 1-based. Shared by everyone on the same average, competition-style. */
  rank: number | null;
  /** True for the viewer's own row, so a client can highlight it. */
  isYou: boolean;
  /** Below the sample floor: shown, but not ranked. */
  provisional: boolean;
}

/**
 * Below this many games, an average says more about variance than about play.
 *
 * A player with three games and a 2.1 average is not the best player in the
 * group, and a board that says so is worse than useless among friends. They
 * still appear — being absent from your own friends list is confusing — but
 * unranked, with the count visible so the reason is legible.
 */
export const MIN_RANKED_GAMES = 20;

export interface LeaderboardOptions {
  viewerPuuid: string;
  minGames?: number;
}

export function buildLeaderboard(
  stats: readonly FriendStats[],
  options: LeaderboardOptions,
): LeaderboardRow[] {
  const minGames = options.minGames ?? MIN_RANKED_GAMES;

  const rankable = stats
    .filter((entry) => entry.avgPlacement !== null && entry.games >= minGames)
    .sort((a, b) => {
      // Lower average placement is better: 1st place is the good end.
      const byPlacement = a.avgPlacement! - b.avgPlacement!;
      if (byPlacement !== 0) return byPlacement;
      // More games breaks a tie — the same average over more games is the
      // better-evidenced result, not merely the luckier one.
      return b.games - a.games;
    });

  const ranks = new Map<string, number>();
  let lastAverage: number | null = null;
  let lastRank = 0;

  rankable.forEach((entry, index) => {
    // Competition ranking: equal averages share a rank, and the next distinct
    // value skips ahead. Two players genuinely tied should not be told one of
    // them is ahead because of row order.
    if (lastAverage !== null && entry.avgPlacement === lastAverage) {
      ranks.set(entry.puuid, lastRank);
    } else {
      lastRank = index + 1;
      lastAverage = entry.avgPlacement;
      ranks.set(entry.puuid, lastRank);
    }
  });

  const provisional = stats.filter((entry) => !ranks.has(entry.puuid));

  return [...rankable, ...provisional].map((entry) => ({
    ...entry,
    rank: ranks.get(entry.puuid) ?? null,
    isYou: entry.puuid === options.viewerPuuid,
    provisional: !ranks.has(entry.puuid),
  }));
}

/**
 * A one-line, non-competitive summary of where the viewer sits.
 *
 * Deliberately gentle. This is a leaderboard among friends, not a ladder, and
 * text that reads as a ranking-out-of-N invites a comparison the numbers
 * cannot really support at these sample sizes.
 */
export function describeStanding(rows: readonly LeaderboardRow[]): string {
  const you = rows.find((row) => row.isYou);

  if (!you) return 'You are not on this board.';
  if (you.provisional) {
    const needed = MIN_RANKED_GAMES - you.games;
    return `${needed} more ranked ${needed === 1 ? 'game' : 'games'} and you'll be ranked here.`;
  }

  const ranked = rows.filter((row) => !row.provisional);
  if (ranked.length === 1) return 'You are the only ranked player here so far.';

  if (you.rank === 1) return 'You have the best average placement in this group.';

  const ahead = ranked.filter((row) => row.rank !== null && row.rank < you.rank!).length;
  return `${ahead} of your friends have a better average placement than you right now.`;
}
