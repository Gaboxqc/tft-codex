/**
 * OAuth flow state and sessions.
 *
 * design.md §10: refresh tokens live server-side, never in client storage. The
 * client holds an opaque session id; this table holds what that id maps to.
 *
 * _Requirements: 7.1, 7.2, 7.5_
 */
import type { Database } from '../db/postgres.js';

export interface AuthFlowRecord {
  state: string;
  codeVerifier: string;
  redirectTo: string | null;
}

export interface SessionRecord {
  id: string;
  puuid: string;
  refreshToken: string;
  expiresAt: Date;
}

export class AuthRepository {
  constructor(private readonly db: Database) {}

  /** Stores a pending flow. `ttlSeconds` is short — a login takes seconds. */
  async saveFlow(flow: AuthFlowRecord, ttlSeconds = 600): Promise<void> {
    await this.db.query(
      `INSERT INTO auth_flows (state, code_verifier, redirect_to, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [flow.state, flow.codeVerifier, flow.redirectTo, ttlSeconds],
    );
  }

  /**
   * Reads and deletes a flow in one statement.
   *
   * Single-use by construction: a replayed callback finds nothing, so an
   * intercepted authorization code cannot be exchanged twice. Doing this as a
   * SELECT followed by a DELETE would leave a window where two concurrent
   * callbacks both succeed.
   */
  async consumeFlow(state: string): Promise<AuthFlowRecord | null> {
    const { rows } = await this.db.query<{
      state: string;
      code_verifier: string;
      redirect_to: string | null;
    }>(
      `DELETE FROM auth_flows
       WHERE state = $1 AND expires_at > now()
       RETURNING state, code_verifier, redirect_to`,
      [state],
    );

    const row = rows[0];
    return row
      ? { state: row.state, codeVerifier: row.code_verifier, redirectTo: row.redirect_to }
      : null;
  }

  /** Housekeeping for abandoned logins. Safe to run on any schedule. */
  async purgeExpiredFlows(): Promise<number> {
    const { rowCount } = await this.db.query('DELETE FROM auth_flows WHERE expires_at <= now()');
    return rowCount ?? 0;
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO auth_sessions (id, puuid, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [session.id, session.puuid, session.refreshToken, session.expiresAt],
    );
  }

  /**
   * Looks up a live session.
   *
   * Joins against `player_profiles` so a session belonging to a profile pending
   * deletion resolves to nothing — unlinking has to log you out, or the tokens
   * outlive the account they authenticate.
   */
  async findSession(id: string): Promise<{ id: string; puuid: string } | null> {
    const { rows } = await this.db.query<{ id: string; puuid: string }>(
      `SELECT s.id, s.puuid
       FROM auth_sessions s
       JOIN player_profiles p ON p.puuid = s.puuid
       WHERE s.id = $1 AND s.expires_at > now() AND p.deletion_requested_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async touchSession(id: string): Promise<void> {
    await this.db.query('UPDATE auth_sessions SET last_used_at = now() WHERE id = $1', [id]);
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.query('DELETE FROM auth_sessions WHERE id = $1', [id]);
  }

  /** Revokes every session for a player. Used on unlink. */
  async deleteSessionsFor(puuid: string): Promise<number> {
    const { rowCount } = await this.db.query('DELETE FROM auth_sessions WHERE puuid = $1', [puuid]);
    return rowCount ?? 0;
  }
}
