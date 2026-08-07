/**
 * Session issuing and verification (task 3.1).
 *
 * design.md §10: short-lived JWTs for the session, refresh tokens stored
 * server-side and never in client localStorage or the Overwolf app's storage.
 * The client holds an opaque session id in an httpOnly cookie plus a
 * short-lived access token; the refresh token never leaves the database.
 *
 * R7.5 wants one identity shared between web and the Overwolf app, so the
 * token is issued by one issuer and verified the same way in both — the
 * Overwolf app does not re-implement or bypass RSO.
 *
 * The JWT is signed HS256 with a secret from config. Symmetric is right here:
 * one service both issues and verifies, and asymmetric keys would add rotation
 * machinery for no gain.
 *
 * _Requirements: 7.1, 7.2, 7.5_
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Access tokens are deliberately short-lived; the session row is the durable half. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SessionClaims {
  /** PUUID. The only identity this system has. */
  sub: string;
  /** Session id, so a token can be tied back to a revocable row. */
  sid: string;
  iat: number;
  exp: number;
}

const base64Url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const sign = (data: string, secret: string): string =>
  base64Url(createHmac('sha256', secret).update(data).digest());

export function newSessionId(): string {
  return base64Url(randomBytes(24));
}

export function issueAccessToken(
  claims: { puuid: string; sessionId: string },
  secret: string,
  now: () => number = Date.now,
): string {
  const issuedAt = Math.floor(now() / 1000);
  const payload: SessionClaims = {
    sub: claims.puuid,
    sid: claims.sessionId,
    iat: issuedAt,
    exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
  };

  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  return `${data}.${sign(data, secret)}`;
}

export type VerifyResult =
  | { valid: true; claims: SessionClaims }
  | { valid: false; reason: 'malformed' | 'bad-signature' | 'expired' };

/**
 * Verifies a token.
 *
 * Signature is checked BEFORE expiry, deliberately: reporting "expired" for a
 * token whose signature is wrong would tell an attacker their forgery had the
 * right shape. Signature failure is the answer for anything unsigned.
 */
export function verifyAccessToken(
  token: string,
  secret: string,
  now: () => number = Date.now,
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };

  const [header, body, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${body}`, secret);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad-signature' };
  }

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') {
    return { valid: false, reason: 'malformed' };
  }

  if (claims.exp * 1000 <= now()) return { valid: false, reason: 'expired' };

  return { valid: true, claims };
}

/**
 * Cookie attributes for the session.
 *
 * `httpOnly` so script cannot read it, `sameSite: lax` so the RSO redirect back
 * still carries it while cross-site POSTs do not, `secure` outside development
 * because localhost has no TLS.
 */
export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}
