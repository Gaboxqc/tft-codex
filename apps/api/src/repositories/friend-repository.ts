/**
 * Opt-in friends and their aggregate stats (task 6.8).
 *
 * Every read here is gated on the relationship being `accepted` in the
 * database, not on a check the caller is trusted to have done. R4.6 makes
 * another player's data off-limits by default, and this is the one narrow
 * exception — so the exception is enforced in the query rather than in a
 * route that could be copied without it.
 *
 * _Requirements: 4.6, 4.7, 7.1, 7.3_
 */
import type { Database } from '../db/postgres.js';
import type { FriendStats } from '../domain/leaderboard.js';

export interface FriendRequest {
  puuid: string;
  riotId: string;
  direction: 'incoming' | 'outgoing';
  createdAt: string;
}

export class FriendRepository {
  constructor(private readonly db: Database) {}

  // ── Participation ────────────────────────────────────────────────────────

  async optInStatus(puuid: string): Promise<boolean> {
    const { rows } = await this.db.query<{ friends_opt_in: boolean }>(
      'SELECT friends_opt_in FROM player_profiles WHERE puuid = $1',
      [puuid],
    );
    return rows[0]?.friends_opt_in ?? false;
  }

  /**
   * Turns participation on or off.
   *
   * Opting out deletes every relationship, pending and accepted alike. Leaving
   * them dormant would mean opting back in silently restores access that the
   * other person has not re-consented to since — and "off" has to mean off.
   */
  async setOptIn(puuid: string, optIn: boolean): Promise<void> {
    await this.db.query('UPDATE player_profiles SET friends_opt_in = $2 WHERE puuid = $1', [
      puuid,
      optIn,
    ]);

    if (!optIn) {
      await this.db.query(
        'DELETE FROM friendships WHERE requester_puuid = $1 OR addressee_puuid = $1',
        [puuid],
      );
    }
  }

  // ── Finding people ───────────────────────────────────────────────────────

  /**
   * Looks a player up by Riot ID.
   *
   * Restricted to opted-in profiles. An unrestricted lookup would answer "does
   * this person use TFT Codex?" for any Riot ID anyone cares to type, which is
   * a disclosure in itself — so opting in is also the consent to be findable.
   */
  async findByRiotId(riotId: string): Promise<{ puuid: string; riotId: string } | null> {
    const { rows } = await this.db.query<{ puuid: string; riot_id: string }>(
      `SELECT puuid, riot_id
         FROM player_profiles
        WHERE lower(riot_id) = lower($1)
          AND friends_opt_in
          AND deletion_requested_at IS NULL`,
      [riotId],
    );

    const row = rows[0];
    return row ? { puuid: row.puuid, riotId: row.riot_id } : null;
  }

  // ── Requests ─────────────────────────────────────────────────────────────

  /**
   * Sends a request, or accepts one that already exists in the other direction.
   *
   * The second case matters: two people who each send a request should end up
   * friends, not deadlocked behind two pendings that the unique-pair index
   * would reject anyway.
   */
  async request(from: string, to: string): Promise<'sent' | 'accepted' | 'exists'> {
    const existing = await this.between(from, to);

    if (existing?.status === 'accepted') return 'exists';

    if (existing?.status === 'pending') {
      if (existing.requester === from) return 'exists';
      await this.accept(to, from);
      return 'accepted';
    }

    await this.db.query(
      `INSERT INTO friendships (requester_puuid, addressee_puuid, status)
       VALUES ($1, $2, 'pending')`,
      [from, to],
    );
    return 'sent';
  }

  /** Accepts a pending request. `addressee` is the person accepting. */
  async accept(addressee: string, requester: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE friendships
          SET status = 'accepted', responded_at = now()
        WHERE requester_puuid = $2 AND addressee_puuid = $1 AND status = 'pending'`,
      [addressee, requester],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Removes a relationship in either state and either direction.
   *
   * Declining and unfriending are the same operation on purpose: a declined
   * request is deleted rather than recorded, so nothing keeps a note of who
   * turned down whom.
   */
  async remove(puuid: string, otherPuuid: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `DELETE FROM friendships
        WHERE (requester_puuid = $1 AND addressee_puuid = $2)
           OR (requester_puuid = $2 AND addressee_puuid = $1)`,
      [puuid, otherPuuid],
    );
    return (rowCount ?? 0) > 0;
  }

  async pendingFor(puuid: string): Promise<FriendRequest[]> {
    const { rows } = await this.db.query<{
      puuid: string;
      riot_id: string;
      direction: 'incoming' | 'outgoing';
      created_at: Date;
    }>(
      `SELECT p.puuid,
              p.riot_id,
              CASE WHEN f.addressee_puuid = $1 THEN 'incoming' ELSE 'outgoing' END AS direction,
              f.created_at
         FROM friendships f
         JOIN player_profiles p
           ON p.puuid = CASE WHEN f.addressee_puuid = $1
                             THEN f.requester_puuid ELSE f.addressee_puuid END
        WHERE (f.requester_puuid = $1 OR f.addressee_puuid = $1)
          AND f.status = 'pending'
          AND p.deletion_requested_at IS NULL
        ORDER BY f.created_at DESC`,
      [puuid],
    );

    return rows.map((row) => ({
      puuid: row.puuid,
      riotId: row.riot_id,
      direction: row.direction,
      createdAt: row.created_at.toISOString(),
    }));
  }

  // ── Leaderboard ──────────────────────────────────────────────────────────

  /**
   * Aggregate stats for the viewer and every accepted friend.
   *
   * Aggregates only — count, average placement, top-4 rate. No match rows, no
   * augment breakdown. The `status = 'accepted'` join is the access control,
   * so a caller cannot reach a stranger's numbers by passing a different
   * puuid: the query only ever returns rows the viewer is joined to.
   */
  async leaderboardFor(puuid: string): Promise<FriendStats[]> {
    const { rows } = await this.db.query<{
      puuid: string;
      riot_id: string;
      games: string;
      avg_placement: string | null;
      top4_rate: string | null;
    }>(
      `WITH circle AS (
         SELECT $1::text AS puuid
         UNION
         SELECT CASE WHEN f.requester_puuid = $1 THEN f.addressee_puuid ELSE f.requester_puuid END
           FROM friendships f
          WHERE (f.requester_puuid = $1 OR f.addressee_puuid = $1)
            AND f.status = 'accepted'
       )
       SELECT p.puuid,
              p.riot_id,
              count(m.match_id)::text AS games,
              avg(m.placement)::text AS avg_placement,
              (count(*) FILTER (WHERE m.placement <= 4)::numeric
                / NULLIF(count(m.match_id), 0))::text AS top4_rate
         FROM circle c
         JOIN player_profiles p ON p.puuid = c.puuid AND p.deletion_requested_at IS NULL
         LEFT JOIN player_matches m ON m.puuid = p.puuid
        GROUP BY p.puuid, p.riot_id`,
      [puuid],
    );

    return rows.map((row) => ({
      puuid: row.puuid,
      riotId: row.riot_id,
      games: Number(row.games),
      avgPlacement: row.avg_placement === null ? null : Number(row.avg_placement),
      top4Rate: row.top4_rate === null ? null : Number(row.top4_rate),
    }));
  }

  /** The raw relationship between two players, in whichever direction it exists. */
  private async between(
    a: string,
    b: string,
  ): Promise<{ requester: string; status: 'pending' | 'accepted' } | null> {
    const { rows } = await this.db.query<{
      requester_puuid: string;
      status: 'pending' | 'accepted';
    }>(
      `SELECT requester_puuid, status
         FROM friendships
        WHERE (requester_puuid = $1 AND addressee_puuid = $2)
           OR (requester_puuid = $2 AND addressee_puuid = $1)`,
      [a, b],
    );

    const row = rows[0];
    return row ? { requester: row.requester_puuid, status: row.status } : null;
  }
}
