/**
 * Push subscriptions and the opt-in notification address (task 6.6).
 *
 * Both cascade from `player_profiles`, so unlinking (R7.3) removes them with
 * the profile rather than needing its own cleanup step — the deletion path
 * that already exists stays the only one.
 *
 * _Requirements: 9.1, 9.2, 7.3_
 */
import { randomBytes, createHash } from 'node:crypto';

import type { Database } from '../db/postgres.js';
import type { Destination } from '../services/delivery/types.js';

/** Verification links expire; an address someone typo'd should not stay claimable forever. */
const TOKEN_TTL_HOURS = 48;

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | undefined;
}

export class DeliveryRepository {
  constructor(private readonly db: Database) {}

  // ── Web push ─────────────────────────────────────────────────────────────

  /** Idempotent on `(puuid, endpoint)`: re-subscribing a browser refreshes its keys. */
  async saveSubscription(puuid: string, subscription: PushSubscriptionInput): Promise<void> {
    await this.db.query(
      `INSERT INTO push_subscriptions (puuid, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (puuid, endpoint)
       DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [
        puuid,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        subscription.userAgent ?? null,
      ],
    );
  }

  async removeSubscription(puuid: string, endpoint: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      'DELETE FROM push_subscriptions WHERE puuid = $1 AND endpoint = $2',
      [puuid, endpoint],
    );
    return (rowCount ?? 0) > 0;
  }

  async countSubscriptions(puuid: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM push_subscriptions WHERE puuid = $1',
      [puuid],
    );
    return Number(rows[0]?.count ?? 0);
  }

  // ── Opt-in email ─────────────────────────────────────────────────────────

  /**
   * Stores an address as unverified and returns the token to mail out.
   *
   * Setting an address always clears any previous verification. Changing the
   * address to a new one must not inherit the old one's trust — otherwise
   * verifying once would let the field be repointed anywhere afterwards.
   *
   * The token is stored as a SHA-256 hash. It is a bearer credential that
   * arrives by email, and a database leak should not hand over live links.
   */
  async setEmail(puuid: string, email: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');

    await this.db.query(
      `UPDATE player_profiles
          SET notification_email = $2,
              notification_email_verified_at = NULL,
              notification_email_token = $3,
              notification_email_token_expires_at = now() + ($4 || ' hours')::interval
        WHERE puuid = $1`,
      [puuid, email, hashToken(token), String(TOKEN_TTL_HOURS)],
    );

    return token;
  }

  /** Consumes a verification token. Returns the address it verified, or null. */
  async verifyEmail(token: string): Promise<string | null> {
    const { rows } = await this.db.query<{ notification_email: string }>(
      `UPDATE player_profiles
          SET notification_email_verified_at = now(),
              notification_email_token = NULL,
              notification_email_token_expires_at = NULL
        WHERE notification_email_token = $1
          AND notification_email_token_expires_at > now()
          AND deletion_requested_at IS NULL
        RETURNING notification_email`,
      [hashToken(token)],
    );

    return rows[0]?.notification_email ?? null;
  }

  /** Clears the address entirely. One request, as R9.4 and R7.3 both imply. */
  async clearEmail(puuid: string): Promise<void> {
    await this.db.query(
      `UPDATE player_profiles
          SET notification_email = NULL,
              notification_email_verified_at = NULL,
              notification_email_token = NULL,
              notification_email_token_expires_at = NULL
        WHERE puuid = $1`,
      [puuid],
    );
  }

  async emailStatus(puuid: string): Promise<{ address: string | null; verified: boolean } | null> {
    const { rows } = await this.db.query<{
      notification_email: string | null;
      notification_email_verified_at: Date | null;
    }>(
      `SELECT notification_email, notification_email_verified_at
         FROM player_profiles WHERE puuid = $1`,
      [puuid],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      address: row.notification_email,
      verified: row.notification_email_verified_at !== null,
    };
  }

  // ── Send-time lookup ─────────────────────────────────────────────────────

  /**
   * Everything needed to deliver to one player.
   *
   * The email is returned only when verified — the null is the enforcement,
   * so no adapter has to remember the rule. A profile pending deletion returns
   * nothing at all: R7.3 stops us serving their data immediately, and a
   * notification is us reaching out with it.
   */
  async destinationFor(puuid: string): Promise<Destination> {
    const [profile, subscriptions] = await Promise.all([
      this.db.query<{ notification_email: string | null }>(
        `SELECT notification_email
           FROM player_profiles
          WHERE puuid = $1
            AND deletion_requested_at IS NULL
            AND notification_email_verified_at IS NOT NULL`,
        [puuid],
      ),
      this.db.query<{ endpoint: string; p256dh: string; auth: string }>(
        `SELECT ps.endpoint, ps.p256dh, ps.auth
           FROM push_subscriptions ps
           JOIN player_profiles p ON p.puuid = ps.puuid
          WHERE ps.puuid = $1 AND p.deletion_requested_at IS NULL`,
        [puuid],
      ),
    ]);

    return {
      email: profile.rows[0]?.notification_email ?? null,
      pushSubscriptions: subscriptions.rows.map((row) => ({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      })),
    };
  }
}

const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');
