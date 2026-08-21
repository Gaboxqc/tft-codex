/**
 * Push subscriptions and the opt-in notification address (task 6.6).
 *
 * `GET    /v1/notifications/delivery`          what is set up, and the VAPID key
 * `POST   /v1/notifications/push`              register this browser
 * `DELETE /v1/notifications/push`              deregister this browser
 * `PUT    /v1/notifications/email`             set an address (unverified)
 * `DELETE /v1/notifications/email`             clear it
 * `GET    /v1/notifications/email/verify`      the link from the inbox
 *
 * The verify route is the only one here without a session: it is clicked from
 * an email client, which carries no cookie for this origin. The token is the
 * credential, it is single-use, it expires, and it is stored hashed.
 *
 * _Requirements: 9.1, 9.2, 7.3_
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { EmailAdapter } from '../../services/delivery/email-adapter.js';
import type { AppContext } from '../context.js';
import { makeRequireSession } from '../require-session.js';

const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

const EmailSchema = z.object({
  // Deliberately permissive beyond the format check: the real validation is
  // the verification round trip, and a regex that rejects a valid address is
  // worse than one that lets an invalid one fail to verify.
  email: z.string().email().max(254),
});

export async function registerDeliveryRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const requireSession = makeRequireSession(context);

  app.get('/v1/notifications/delivery', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const [email, pushCount] = await Promise.all([
      context.delivery.emailStatus(request.puuid!),
      context.delivery.countSubscriptions(request.puuid!),
    ]);

    reply.header('cache-control', 'no-store');
    return {
      email: email?.address ?? null,
      emailVerified: email?.verified ?? false,
      pushSubscriptions: pushCount,
      // The browser needs this to subscribe. It is a public key by design —
      // the private half never leaves the server.
      vapidPublicKey: context.config.delivery.webPush?.publicKey ?? null,
      // Said plainly so a settings screen can explain itself rather than
      // rendering a control that silently cannot work.
      channels: {
        email: context.config.delivery.email !== null,
        webpush: context.config.delivery.webPush !== null,
        // Phase 5. Listed so the client does not have to hardcode the answer.
        'overwolf-native': false,
      },
    };
  });

  // ── Web push ─────────────────────────────────────────────────────────────

  app.post('/v1/notifications/push', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const parsed = SubscriptionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    await context.delivery.saveSubscription(request.puuid!, {
      endpoint: parsed.data.endpoint,
      keys: parsed.data.keys,
      userAgent: request.headers['user-agent'],
    });

    reply.header('cache-control', 'no-store');
    return reply.status(201).send({ subscribed: true });
  });

  app.delete('/v1/notifications/push', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const parsed = z.object({ endpoint: z.string().max(600) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const removed = await context.delivery.removeSubscription(request.puuid!, parsed.data.endpoint);

    reply.header('cache-control', 'no-store');
    // 200 either way: removing a subscription that is already gone is the
    // state the caller asked for, not an error.
    return { removed };
  });

  // ── Opt-in email ─────────────────────────────────────────────────────────

  /**
   * Sets an address and mails a verification link.
   *
   * The address is stored immediately but unverified, and **nothing is ever
   * sent to it until the link is clicked**. Someone can type a stranger's
   * address into this form; delivering to it beforehand would make us the
   * mechanism of that abuse.
   */
  app.put('/v1/notifications/email', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    const parsed = EmailSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_email' });

    const mailer = context.config.delivery.email;
    if (!mailer) {
      // No point storing an address we cannot verify — the player would be
      // left looking at "check your inbox" forever.
      return reply.status(503).send({
        error: 'email_unavailable',
        detail: 'Email delivery is not configured in this environment.',
      });
    }

    const token = await context.delivery.setEmail(request.puuid!, parsed.data.email);
    // Points at the API, not the web app: this route is what consumes the
    // token, and it redirects to the web page afterwards. Building it from
    // webBaseUrl would send the click to a page that cannot verify anything.
    const link =
      `${context.config.apiPublicUrl}/v1/notifications/email/verify` +
      `?token=${encodeURIComponent(token)}`;

    // Sent through `deliver`, not `send`: this one goes to an unverified
    // address by definition, which is exactly why it bypasses that guard.
    const outcome = await new EmailAdapter({
      ...mailer,
      webBaseUrl: context.config.webBaseUrl,
      logger: context.log,
    }).deliver({
      to: parsed.data.email,
      subject: 'Confirm your TFT Codex notification address',
      text:
        'Someone asked us to send TFT Codex notifications to this address.\n\n' +
        `Confirm it here: ${link}\n\n` +
        'The link expires in 48 hours. If this was not you, ignore this email — ' +
        'nothing will be sent to this address unless the link is used.',
    });

    if (outcome.status !== 'sent') {
      // Clear it again rather than leaving an address on file that was never
      // confirmed and never can be.
      await context.delivery.clearEmail(request.puuid!);
      return reply.status(502).send({ error: 'verification_send_failed' });
    }

    reply.header('cache-control', 'no-store');
    return { email: parsed.data.email, verified: false, verificationSent: true };
  });

  app.delete('/v1/notifications/email', async (request, reply) => {
    if (!(await requireSession(request, reply))) return reply;

    await context.delivery.clearEmail(request.puuid!);

    reply.header('cache-control', 'no-store');
    return { cleared: true };
  });

  /**
   * The link from the inbox. No session — an email client carries no cookie.
   *
   * Redirects rather than returning JSON: a person clicked a link and expects
   * a page, not a document their browser offers to download.
   */
  app.get<{ Querystring: { token?: string } }>(
    '/v1/notifications/email/verify',
    async (request, reply) => {
      const token = request.query.token;
      const verified = token ? await context.delivery.verifyEmail(token) : null;

      const target = new URL('/me/notifications', context.config.webBaseUrl);
      target.searchParams.set('verified', verified ? 'ok' : 'failed');

      return reply.redirect(target.toString(), 303);
    },
  );
}
