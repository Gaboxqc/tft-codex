/**
 * Notification preferences, bookmarks and the delivery outbox (tasks 6.5, 6.6).
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4_
 */
import type { NotificationCategory, NotificationPref } from '@tft-codex/shared-types';

import { withTransaction, type Database } from '../db/postgres.js';
import type { Bookmark, OutboundNotification, Subscriber } from '../domain/notifications.js';

export class NotificationRepository {
  constructor(private readonly db: Database) {}

  // ── Preferences (R9.1, R9.4) ─────────────────────────────────────────────

  async prefsFor(puuid: string): Promise<NotificationPref[]> {
    const { rows } = await this.db.query<{
      channel: NotificationPref['channel'];
      category: NotificationCategory;
      enabled: boolean;
    }>('SELECT channel, category, enabled FROM notification_prefs WHERE puuid = $1', [puuid]);
    return rows;
  }

  /**
   * Replaces a player's preferences wholesale.
   *
   * A full replace rather than a merge: the settings screen sends the complete
   * state it is showing, and a partial upsert would leave a channel enabled
   * that the user just switched off but which happened to be omitted from the
   * payload. For an opt-out this is the difference between silence and a
   * message they explicitly declined.
   */
  async replacePrefs(puuid: string, prefs: readonly NotificationPref[]): Promise<void> {
    await withTransaction(this.db, async (client) => {
      await client.query('DELETE FROM notification_prefs WHERE puuid = $1', [puuid]);

      for (const pref of prefs) {
        await client.query(
          `INSERT INTO notification_prefs (puuid, channel, category, enabled)
           VALUES ($1, $2, $3, $4)`,
          [puuid, pref.channel, pref.category, pref.enabled],
        );
      }
    });
  }

  /**
   * R9.4 — unsubscribe from a category in one action, without deleting the
   * account. Disables rather than deletes so the settings screen still shows
   * the category with its switch off, rather than the row silently vanishing.
   */
  async unsubscribeCategory(puuid: string, category: NotificationCategory): Promise<number> {
    const { rowCount } = await this.db.query(
      'UPDATE notification_prefs SET enabled = FALSE WHERE puuid = $1 AND category = $2',
      [puuid, category],
    );
    return rowCount ?? 0;
  }

  // ── Bookmarks (R9.1) ─────────────────────────────────────────────────────

  async bookmarksFor(puuid: string): Promise<Bookmark[]> {
    const { rows } = await this.db.query<{ kind: Bookmark['kind']; target_id: string }>(
      'SELECT kind, target_id FROM bookmarks WHERE puuid = $1 ORDER BY created_at DESC',
      [puuid],
    );
    return rows.map((row) => ({ kind: row.kind, targetId: row.target_id }));
  }

  async addBookmark(puuid: string, bookmark: Bookmark): Promise<void> {
    await this.db.query(
      `INSERT INTO bookmarks (puuid, kind, target_id) VALUES ($1, $2, $3)
       ON CONFLICT (puuid, kind, target_id) DO NOTHING`,
      [puuid, bookmark.kind, bookmark.targetId],
    );
  }

  async removeBookmark(puuid: string, bookmark: Bookmark): Promise<boolean> {
    const { rowCount } = await this.db.query(
      'DELETE FROM bookmarks WHERE puuid = $1 AND kind = $2 AND target_id = $3',
      [puuid, bookmark.kind, bookmark.targetId],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Everyone with at least one channel enabled, with their bookmarks.
   *
   * The `WHERE enabled` is doing real work: a player who has switched
   * everything off never appears in this list, so the notification builders
   * cannot accidentally reach them even if a future caller forgets to check
   * (R9.3).
   */
  async subscribers(): Promise<Subscriber[]> {
    const { rows } = await this.db.query<{
      puuid: string;
      prefs: NotificationPref[];
      bookmarks: { kind: Bookmark['kind']; targetId: string }[];
    }>(
      `
      SELECT p.puuid,
             COALESCE(pref.prefs, '[]'::jsonb) AS prefs,
             COALESCE(bm.bookmarks, '[]'::jsonb) AS bookmarks
      FROM player_profiles p
      JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
                 'channel', np.channel, 'category', np.category, 'enabled', np.enabled
               )) AS prefs
        FROM notification_prefs np
        WHERE np.puuid = p.puuid AND np.enabled
      ) pref ON pref.prefs IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('kind', b.kind, 'targetId', b.target_id)) AS bookmarks
        FROM bookmarks b
        WHERE b.puuid = p.puuid
      ) bm ON TRUE
      WHERE p.deletion_requested_at IS NULL
      `,
    );

    return rows.map((row) => ({
      puuid: row.puuid,
      prefs: row.prefs,
      bookmarks: row.bookmarks.map((mark) => ({ kind: mark.kind, targetId: mark.targetId })),
    }));
  }

  // ── Outbox (R9.2) ────────────────────────────────────────────────────────

  /** Queues messages. Duplicates by `(puuid, dedupeKey)` are dropped. */
  async enqueue(messages: readonly OutboundNotification[]): Promise<number> {
    if (messages.length === 0) return 0;

    const { rowCount } = await this.db.query(
      `INSERT INTO notification_outbox (puuid, channel, category, subject, body, dedupe_key)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
       ON CONFLICT (puuid, dedupe_key) DO NOTHING`,
      [
        messages.map((message) => message.puuid),
        messages.map((message) => message.channel),
        messages.map((message) => message.category),
        messages.map((message) => message.subject),
        messages.map((message) => message.body),
        messages.map((message) => message.dedupeKey),
      ],
    );
    return rowCount ?? 0;
  }

  async claimPending(limit = 100): Promise<(OutboundNotification & { id: number })[]> {
    const { rows } = await this.db.query<{
      id: string;
      puuid: string;
      channel: OutboundNotification['channel'];
      category: NotificationCategory;
      subject: string;
      body: string;
      dedupe_key: string;
    }>(
      `SELECT * FROM notification_outbox
       WHERE sent_at IS NULL AND failed_at IS NULL
       ORDER BY queued_at
       LIMIT $1`,
      [limit],
    );

    return rows.map((row) => ({
      id: Number(row.id),
      puuid: row.puuid,
      channel: row.channel,
      category: row.category,
      subject: row.subject,
      body: row.body,
      dedupeKey: row.dedupe_key,
    }));
  }

  async markSent(id: number): Promise<void> {
    await this.db.query('UPDATE notification_outbox SET sent_at = now() WHERE id = $1', [id]);
  }

  /**
   * Records a transient failure without giving up on the message.
   *
   * The row stays pending, so the next run retries it. `attempts` is what
   * makes a permanently-flapping destination visible rather than invisible —
   * a row with a high count and no `sent_at` is worth an operator's attention.
   */
  async recordAttempt(id: number, error: string): Promise<void> {
    await this.db.query(
      `UPDATE notification_outbox
          SET attempts = attempts + 1, last_attempt_at = now(), error = $2
        WHERE id = $1`,
      [id, error],
    );
  }

  /**
   * Marks a message failed.
   *
   * Terminal rather than retried automatically: a bounced address or a revoked
   * push subscription will not fix itself, and silently retrying forever turns
   * one bad row into permanent load. Re-queueing is a deliberate operator
   * action.
   */
  async markFailed(id: number, error: string): Promise<void> {
    await this.db.query(
      'UPDATE notification_outbox SET failed_at = now(), error = $2 WHERE id = $1',
      [id, error],
    );
  }
}
