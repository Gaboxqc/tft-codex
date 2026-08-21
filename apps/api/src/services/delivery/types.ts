/**
 * Delivery adapter contract (task 6.6).
 *
 * One interface per channel, resolved at send time by the worker. The shape
 * that matters is `DeliveryOutcome`: a failure has to say whether it is worth
 * trying again, because the two kinds need opposite handling and guessing
 * wrong is expensive in both directions.
 *
 * - **Permanent** — a revoked push subscription, a bounced address, a rejected
 *   payload. Retrying forever turns one bad row into permanent load, and the
 *   destination will not fix itself.
 * - **Transient** — the push service returned a 503, the network blipped. Not
 *   retrying means silently dropping a message someone asked for.
 *
 * _Requirements: 9.1, 9.2_
 */
import type { NotificationChannel } from '@tft-codex/shared-types';

import type { OutboundNotification } from '../../domain/notifications.js';

export type DeliveryOutcome =
  | { status: 'sent' }
  | { status: 'failed'; permanent: boolean; error: string }
  /** No destination on file — not a failure, just nothing to send to. */
  | { status: 'skipped'; reason: string };

/** Where a message goes, resolved per player and channel at send time. */
export interface Destination {
  /** Verified address, or null when absent or unverified. */
  email: string | null;
  pushSubscriptions: readonly {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }[];
}

export interface DeliveryAdapter {
  readonly channel: NotificationChannel;
  send(message: OutboundNotification, destination: Destination): Promise<DeliveryOutcome>;
}

/**
 * The unsubscribe link every message carries.
 *
 * R9.4 requires unsubscribing in one action. A link that lands on the settings
 * screen is not that — this one hits the category-unsubscribe route directly,
 * which is why that route exists separately from the preferences PUT.
 */
export function unsubscribeUrl(
  webBaseUrl: string,
  category: OutboundNotification['category'],
): string {
  return `${webBaseUrl}/me/notifications?stop=${encodeURIComponent(category)}`;
}
