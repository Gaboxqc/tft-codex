/**
 * RSO account linking (tasks 3.1, 3.2).
 *
 * `GET /v1/auth/riot/start`    → redirect to Riot
 * `GET /v1/auth/riot/callback` → exchange, create profile, set session cookie
 * `POST /v1/auth/logout`       → revoke this session
 *
 * R7.1: the only way in is RSO. There is no password field anywhere in this
 * file, and no endpoint that accepts one.
 *
 * _Requirements: 7.1, 7.2, 7.4, 7.5_
 */
import type { FastifyInstance } from 'fastify';

import { createAuthFlow, exchangeCode, puuidFromIdToken, statesMatch } from '../../auth/rso.js';
import {
  SESSION_TTL_SECONDS,
  issueAccessToken,
  newSessionId,
  sessionCookieOptions,
} from '../../auth/session.js';
import type { AppContext } from '../context.js';
import { makeRequireSession } from '../require-session.js';

/**
 * Only same-origin relative paths may be used as a post-login redirect.
 *
 * An unvalidated `redirect_to` is an open redirect: an attacker sends a victim
 * through our own login and lands them on a phishing page that looks like it
 * came from us.
 */
export function safeRedirect(target: string | undefined, fallback: string): string {
  if (!target) return fallback;
  // Must be a rooted path, and must not begin with `//` (protocol-relative,
  // which browsers treat as absolute).
  if (!target.startsWith('/') || target.startsWith('//')) return fallback;
  return target;
}

export async function registerAuthRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  const requireSession = makeRequireSession(context);

  app.get<{ Querystring: { redirect_to?: string } }>(
    '/v1/auth/riot/start',
    async (request, reply) => {
      if (!context.config.rso) {
        return reply.status(503).send({
          error: 'rso_not_configured',
          detail:
            'Account linking needs RSO credentials, which are issued once Riot approves the ' +
            'third-party application. See docs/approvals.md.',
        });
      }

      const flow = createAuthFlow(context.config.rso);
      await context.auth.saveFlow({
        state: flow.state,
        codeVerifier: flow.codeVerifier,
        redirectTo: safeRedirect(request.query.redirect_to, '/'),
      });

      return reply.redirect(flow.authorizeUrl, 302);
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/v1/auth/riot/callback',
    async (request, reply) => {
      if (!context.config.rso) {
        return reply.status(503).send({ error: 'rso_not_configured' });
      }

      const { code, state, error } = request.query;

      // The user declined, or Riot rejected the request. Not an error on our
      // side — return them where they came from (design.md §9: "no partial
      // profile is created").
      if (error || !code || !state) {
        return reply.redirect(`${context.config.webBaseUrl}/?link=cancelled`, 302);
      }

      // Single-use: the row is deleted as it is read, so a replayed callback
      // finds nothing.
      const flow = await context.auth.consumeFlow(state);
      if (!flow || !statesMatch(flow.state, state)) {
        return reply.redirect(`${context.config.webBaseUrl}/?link=failed`, 302);
      }

      try {
        const tokens = await exchangeCode(context.config.rso, {
          code,
          codeVerifier: flow.codeVerifier,
        });

        const puuid = tokens.idToken ? puuidFromIdToken(tokens.idToken) : null;
        if (!puuid) {
          return reply.redirect(`${context.config.webBaseUrl}/?link=failed`, 302);
        }

        // R7.2 — PUUID, region and display Riot ID, nothing else. The Riot ID
        // is best-effort: a display name is not worth failing a link over.
        const account = await context.riot
          ?.getAccountByRiotId('', '', { lane: 'player' })
          .catch(() => null);
        const riotId =
          account?.gameName && account.tagLine
            ? `${account.gameName}#${account.tagLine}`
            : puuid.slice(0, 8);

        await context.players.upsertProfile({
          puuid,
          region: context.config.riot.platform,
          riotId,
        });

        const sessionId = newSessionId();
        await context.auth.createSession({
          id: sessionId,
          puuid,
          // Server-side only. This never reaches the browser (design.md §10).
          refreshToken: tokens.refreshToken ?? '',
          expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
        });

        const accessToken = issueAccessToken({ puuid, sessionId }, context.config.jwtSecret);
        void reply.setCookie(
          'tftc_session',
          accessToken,
          sessionCookieOptions(context.config.isProduction),
        );

        return reply.redirect(
          `${context.config.webBaseUrl}${safeRedirect(flow.redirectTo ?? undefined, '/')}`,
          302,
        );
      } catch (caught) {
        context.log('rso callback failed', caught);
        return reply.redirect(`${context.config.webBaseUrl}/?link=failed`, 302);
      }
    },
  );

  app.post('/v1/auth/logout', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    await context.auth.deleteSession(request.sessionId!);
    void reply.clearCookie('tftc_session', { path: '/' });
    return { ok: true };
  });
}
