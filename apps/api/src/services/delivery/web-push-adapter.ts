/**
 * Web push delivery (task 6.6).
 *
 * The only channel here that needs no vendor and costs nothing: VAPID keys are
 * self-generated (`npx web-push generate-vapid-keys`) and the browser's own
 * push service does the delivery.
 *
 * One player can hold several subscriptions — one per browser, per device. A
 * send goes to all of them, and the outcome is the optimistic one: if any
 * device took the message, the player has been notified. Only when *every*
 * subscription is permanently gone is the message a permanent failure.
 *
 * Expired subscriptions are pruned as they are discovered. A push service
 * answers 404 or 410 for a subscription the browser has revoked, and that is
 * the only reliable signal we get — there is no other moment to learn it.
 *
 * _Requirements: 9.1, 9.2_
 */
import webpush from 'web-push';

import type { OutboundNotification } from '../../domain/notifications.js';
import type { DeliveryAdapter, DeliveryOutcome, Destination } from './types.js';
import { unsubscribeUrl } from './types.js';

export interface WebPushAdapterOptions {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or an https URL, per the VAPID spec. */
  subject: string;
  webBaseUrl: string;
  /** Called for each subscription the push service says is gone. */
  onExpired?: (puuid: string, endpoint: string) => Promise<void>;
  logger?: (message: string, detail?: unknown) => void;
}

/** 404/410 mean the subscription is revoked; 413 means we built too large a payload. */
const PERMANENT_STATUS = new Set([400, 404, 410, 413]);

export class WebPushAdapter implements DeliveryAdapter {
  readonly channel = 'webpush' as const;

  readonly #options: WebPushAdapterOptions;
  readonly #log: (message: string, detail?: unknown) => void;

  constructor(options: WebPushAdapterOptions) {
    this.#options = options;
    this.#log = options.logger ?? (() => {});
    webpush.setVapidDetails(options.subject, options.publicKey, options.privateKey);
  }

  async send(message: OutboundNotification, destination: Destination): Promise<DeliveryOutcome> {
    if (destination.pushSubscriptions.length === 0) {
      return { status: 'skipped', reason: 'no push subscription on file' };
    }

    const payload = JSON.stringify({
      title: message.subject,
      body: message.body,
      // The service worker uses this to focus or open the right page.
      url: unsubscribeUrl(this.#options.webBaseUrl, message.category),
      category: message.category,
    });

    let delivered = 0;
    let transientFailures = 0;
    const errors: string[] = [];

    for (const subscription of destination.pushSubscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          payload,
          { TTL: 60 * 60 * 24 },
        );
        delivered += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        const detail = error instanceof Error ? error.message : String(error);

        if (status !== undefined && PERMANENT_STATUS.has(status)) {
          // Revoked or malformed. Drop it now — this is the only signal we get
          // that a subscription is dead, and keeping it means retrying forever.
          this.#log(`pruning dead push subscription (${status})`, subscription.endpoint);
          await this.#options.onExpired?.(message.puuid, subscription.endpoint);
        } else {
          transientFailures += 1;
        }
        errors.push(`${status ?? 'network'}: ${detail}`);
      }
    }

    // Any device receiving it means the player was notified.
    if (delivered > 0) return { status: 'sent' };

    return {
      status: 'failed',
      // Retry only if something might plausibly work next time. If every
      // subscription was revoked, there is nothing left to retry against.
      permanent: transientFailures === 0,
      error: errors.join('; ').slice(0, 500),
    };
  }
}
