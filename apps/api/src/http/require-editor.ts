/**
 * Authentication for the editorial routes (tasks 6.1, 6.2, 2.11).
 *
 * Deliberately separate from `requireSession`. An editor is a member of staff,
 * not a linked Riot account — routing internal write access through the same
 * token a game client holds would mean the approval path for published copy
 * and the read path for a player's own matches shared one credential.
 *
 * Three properties this has to have, and does:
 *
 * - **Closed by default.** No token configured means every editorial route
 *   503s. A guard that falls open when misconfigured is worse than no guard,
 *   because it looks like one.
 * - **Constant-time comparison.** `===` on a secret leaks its prefix through
 *   timing. Cheap to avoid, so avoid it.
 * - **Named approvers.** R8.2 wants editorial approval, and an approval nobody
 *   is accountable for is a rubber stamp — so the editor's name rides along in
 *   a header and is stored with the approval.
 *
 * This is a stopgap and is commented as one: per-user roles are the eventual
 * answer, and a shared token is enough for a pre-launch team of one.
 *
 * _Requirements: 8.2_
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AppContext } from './context.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set only on routes that ran `requireEditor`. */
    editorName?: string;
  }
}

/** Constant-time string compare that does not leak length through early exit. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal. Compare against a same-length buffer and fold the length
  // check into the result instead.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function makeRequireEditor(context: AppContext) {
  return async function requireEditor(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> {
    const expected = context.config.editorialToken;

    if (!expected) {
      // 503, not 401: the route is unavailable in this deployment rather than
      // the caller being unauthorised. Saying so plainly stops an operator
      // hunting for a credential problem that does not exist.
      await reply.status(503).send({
        error: 'editorial_disabled',
        detail: 'No EDITORIAL_API_TOKEN is configured for this environment.',
      });
      return false;
    }

    const header = request.headers.authorization;
    const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;

    if (!provided || !secretsMatch(provided, expected)) {
      await reply.status(401).send({ error: 'unauthenticated' });
      return false;
    }

    const name = request.headers['x-editor-name'];
    const editorName = (Array.isArray(name) ? name[0] : name)?.trim();

    if (!editorName) {
      // R8.2 again: the audit trail is the point of the approval step, and an
      // anonymous approval does not provide one.
      await reply.status(400).send({
        error: 'editor_name_required',
        detail: 'Send an X-Editor-Name header so the approval can be attributed.',
      });
      return false;
    }

    request.editorName = editorName.slice(0, 120);
    return true;
  };
}
