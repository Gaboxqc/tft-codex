/**
 * Session authentication for `/v1/players/*` and friends.
 *
 * R7.4 requires the product be fully useful logged out, so this is applied
 * per-route rather than globally — the tier list, comp explorer, augment
 * reference and builder must never touch it.
 *
 * The bearer token is verified cryptographically; the session id inside it is
 * then checked against the database. Both matter: the signature proves the
 * token was issued by us, and the lookup proves the session has not been
 * revoked since. A JWT alone cannot be revoked, which is precisely the problem
 * unlinking (R7.3) creates.
 *
 * _Requirements: 7.1, 7.3, 7.4, 7.5_
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { verifyAccessToken } from '../auth/session.js';
import type { AppContext } from './context.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set only on routes that ran `requireSession`. */
    puuid?: string;
    sessionId?: string;
  }
}

/** Reads the token from the Authorization header or the session cookie. */
export function tokenFrom(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim() || null;

  // The Overwolf app sends a bearer header; the web app relies on the cookie,
  // which is httpOnly so script cannot read it (design.md §10).
  const cookie = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies?.[
    'tftc_session'
  ];
  return cookie ?? null;
}

/**
 * Fastify preHandler enforcing a live session.
 *
 * Replies 401 and returns `false` when unauthenticated, so the caller can
 * `return` immediately. Errors are deliberately uniform — "unauthenticated"
 * for a missing, forged, expired or revoked token alike. Distinguishing them
 * tells an attacker which half of the check they passed.
 */
export function makeRequireSession(context: AppContext) {
  return async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> {
    const token = tokenFrom(request);
    if (!token) {
      await reply.status(401).send({ error: 'unauthenticated' });
      return false;
    }

    const verified = verifyAccessToken(token, context.config.jwtSecret);
    if (!verified.valid) {
      await reply.status(401).send({ error: 'unauthenticated' });
      return false;
    }

    // Revocation check. Unlinking deletes the session row, so a token issued
    // before an unlink stops working immediately rather than at its expiry.
    const session = await context.auth.findSession(verified.claims.sid);
    if (!session || session.puuid !== verified.claims.sub) {
      await reply.status(401).send({ error: 'unauthenticated' });
      return false;
    }

    request.puuid = session.puuid;
    request.sessionId = session.id;
    return true;
  };
}
