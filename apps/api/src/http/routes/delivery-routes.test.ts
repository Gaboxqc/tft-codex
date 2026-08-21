/**
 * Delivery setup route tests (task 6.6).
 *
 * _Requirements: 9.1, 9.2, 7.3_
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { authHeaderFor, buildTestContext } from '../test-context.js';

let app: FastifyInstance | undefined;

const SESSION = { puuid: 'puuid-1', sessionId: 'sid-1' };

const start = async (options: Parameters<typeof buildTestContext>[0] = {}) => {
  const { context } = buildTestContext({ session: SESSION, ...options });
  app = await buildApp({ context });
  return { app, context, headers: authHeaderFor(context, SESSION) };
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (result: { json: () => unknown }): any => result.json();

const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/subscription/abc',
  keys: { p256dh: 'public-key-material', auth: 'auth-secret' },
};

describe('Delivery status (_Requirements: 9.1_)', () => {
  it('requires a session', async () => {
    const { app } = await start();
    expect((await app.inject({ url: '/v1/notifications/delivery' })).statusCode).toBe(401);
  });

  it('reports which channels this deployment can actually deliver', async () => {
    // So a settings screen can explain itself rather than rendering a control
    // that silently cannot work.
    const { app, headers } = await start();
    const body = json(await app.inject({ url: '/v1/notifications/delivery', headers }));

    expect(body.channels).toEqual({ email: false, webpush: false, 'overwolf-native': false });
    expect(body.vapidPublicKey).toBeNull();
  });

  it('exposes the VAPID public key when push is configured', async () => {
    const { app, headers } = await start({
      config: {
        delivery: {
          webPush: { publicKey: 'PUBLIC', privateKey: 'PRIVATE', subject: 'mailto:a@b.c' },
          email: null,
        },
      },
    });

    const body = json(await app.inject({ url: '/v1/notifications/delivery', headers }));

    expect(body.vapidPublicKey).toBe('PUBLIC');
    expect(body.channels.webpush).toBe(true);
  });

  it('reports overwolf-native as unavailable, since Phase 5 has not shipped', async () => {
    const { app, headers } = await start();
    expect(
      json(await app.inject({ url: '/v1/notifications/delivery', headers })).channels[
        'overwolf-native'
      ],
    ).toBe(false);
  });
});

describe('Push subscriptions (_Requirements: 9.2_)', () => {
  it('registers a browser', async () => {
    const { app, headers, context } = await start();

    const result = await app.inject({
      method: 'POST',
      url: '/v1/notifications/push',
      headers,
      payload: SUBSCRIPTION,
    });

    expect(result.statusCode).toBe(201);
    expect(context.delivery.saveSubscription).toHaveBeenCalledWith(
      'puuid-1',
      expect.objectContaining({ endpoint: SUBSCRIPTION.endpoint }),
    );
  });

  it('requires a session to register', async () => {
    const { app } = await start();
    const result = await app.inject({
      method: 'POST',
      url: '/v1/notifications/push',
      payload: SUBSCRIPTION,
    });
    expect(result.statusCode).toBe(401);
  });

  it('rejects a malformed subscription', async () => {
    const { app, headers } = await start();
    const result = await app.inject({
      method: 'POST',
      url: '/v1/notifications/push',
      headers,
      payload: { endpoint: 'not-a-url', keys: {} },
    });
    expect(result.statusCode).toBe(400);
  });

  it('deregisters, and reports success even if it was already gone', async () => {
    // Removing a subscription that is already absent is the state the caller
    // asked for, not an error.
    const { app, headers } = await start();

    const result = await app.inject({
      method: 'DELETE',
      url: '/v1/notifications/push',
      headers,
      payload: { endpoint: 'https://push.example.com/never-registered' },
    });

    expect(result.statusCode).toBe(200);
    expect(json(result).removed).toBe(false);
  });
});

describe('Opt-in email (_Requirements: 9.2, 7.3_)', () => {
  const withEmail = {
    config: {
      delivery: {
        webPush: null,
        email: { apiKey: 'test-key', from: 'TFT Codex <notify@example.com>' },
      },
    },
  };

  it('503s when email is not configured, rather than storing an unverifiable address', async () => {
    // Storing it would leave the player looking at "check your inbox" forever.
    const { app, headers, context } = await start();

    const result = await app.inject({
      method: 'PUT',
      url: '/v1/notifications/email',
      headers,
      payload: { email: 'player@example.com' },
    });

    expect(result.statusCode).toBe(503);
    expect(context.delivery.setEmail).not.toHaveBeenCalled();
  });

  it('rejects a malformed address', async () => {
    const { app, headers } = await start(withEmail);
    const result = await app.inject({
      method: 'PUT',
      url: '/v1/notifications/email',
      headers,
      payload: { email: 'not-an-address' },
    });
    expect(result.statusCode).toBe(400);
  });

  it('clears the address in one request', async () => {
    const { app, headers, context } = await start();

    const result = await app.inject({
      method: 'DELETE',
      url: '/v1/notifications/email',
      headers,
    });

    expect(result.statusCode).toBe(200);
    expect(context.delivery.clearEmail).toHaveBeenCalledWith('puuid-1');
  });

  it('reports a stored address as unverified until the link is used', async () => {
    const { app, headers } = await start({
      emailStatus: { address: 'player@example.com', verified: false },
    });

    const body = json(await app.inject({ url: '/v1/notifications/delivery', headers }));

    expect(body.email).toBe('player@example.com');
    expect(body.emailVerified).toBe(false);
  });
});

describe('Verification link (_Requirements: 9.2_)', () => {
  it('needs no session, because an email client carries no cookie', async () => {
    const { app } = await start();

    const result = await app.inject({
      url: '/v1/notifications/email/verify?token=verification-token',
    });

    expect(result.statusCode).toBe(303);
    expect(result.headers.location).toContain('verified=ok');
  });

  it('reports a bad token as failed rather than erroring', async () => {
    const { app } = await start();

    const result = await app.inject({ url: '/v1/notifications/email/verify?token=wrong' });

    expect(result.statusCode).toBe(303);
    expect(result.headers.location).toContain('verified=failed');
  });

  it('treats a missing token as a failed verification', async () => {
    const { app } = await start();
    const result = await app.inject({ url: '/v1/notifications/email/verify' });

    expect(result.statusCode).toBe(303);
    expect(result.headers.location).toContain('verified=failed');
  });
});
