/**
 * Drains the notification outbox (task 6.6).
 *
 * The outbox was built in 6.5 so that adding delivery would be a worker rather
 * than a refactor; this is that worker.
 *
 * Two properties it has to have:
 *
 * **It must not send to someone who has unsubscribed since the message was
 * queued.** Preferences are re-checked at send time, not trusted from when the
 * row was written. A tier change detected an hour ago and a preference turned
 * off five minutes ago must resolve in the player's favour — R9.3 makes one
 * unwanted message worse than one missed one.
 *
 * **A failure must not stall the queue.** Each message is independent: a dead
 * push endpoint on one row cannot hold up the next. Permanent failures are
 * marked terminal, transient ones are left pending for the next run.
 *
 * _Requirements: 9.1, 9.2, 9.3_
 */
import type { NotificationChannel, NotificationPref } from '@tft-codex/shared-types';

import { enabledChannels } from '../domain/notifications.js';
import type { DeliveryRepository } from '../repositories/delivery-repository.js';
import type { NotificationRepository } from '../repositories/notification-repository.js';
import type { DeliveryAdapter, Destination } from './delivery/types.js';

export interface NotificationWorkerOptions {
  notifications: NotificationRepository;
  delivery: DeliveryRepository;
  adapters: readonly DeliveryAdapter[];
  batchSize?: number;
  logger?: (message: string, detail?: unknown) => void;
}

export interface WorkerRunResult {
  claimed: number;
  sent: number;
  skipped: number;
  failedPermanently: number;
  deferred: number;
}

export class NotificationWorker {
  readonly #notifications: NotificationRepository;
  readonly #delivery: DeliveryRepository;
  readonly #adapters: Map<NotificationChannel, DeliveryAdapter>;
  readonly #batchSize: number;
  readonly #log: (message: string, detail?: unknown) => void;

  constructor(options: NotificationWorkerOptions) {
    this.#notifications = options.notifications;
    this.#delivery = options.delivery;
    this.#adapters = new Map(options.adapters.map((adapter) => [adapter.channel, adapter]));
    this.#batchSize = options.batchSize ?? 100;
    this.#log = options.logger ?? (() => {});
  }

  async run(): Promise<WorkerRunResult> {
    const pending = await this.#notifications.claimPending(this.#batchSize);
    const result: WorkerRunResult = {
      claimed: pending.length,
      sent: 0,
      skipped: 0,
      failedPermanently: 0,
      deferred: 0,
    };

    // Cached per run: a patch broadcast produces one row per player per
    // channel, and re-reading the same preferences three times per player
    // would triple the query count for no new information.
    const prefsCache = new Map<string, NotificationPref[]>();
    const destinationCache = new Map<string, Destination>();

    for (const message of pending) {
      const adapter = this.#adapters.get(message.channel);

      if (!adapter) {
        // A channel with no adapter in this deployment — Overwolf-native
        // before Phase 5 ships, for instance. Left pending rather than failed:
        // the message is fine, the deployment simply cannot deliver it yet.
        result.deferred += 1;
        continue;
      }

      // R9.3, re-checked at send time. The queue is not the authority on
      // consent; the preferences table is, and it may have changed since.
      let prefs = prefsCache.get(message.puuid);
      if (!prefs) {
        prefs = await this.#notifications.prefsFor(message.puuid);
        prefsCache.set(message.puuid, prefs);
      }

      if (!enabledChannels(prefs, message.category).includes(message.channel)) {
        this.#log(
          `dropping queued ${message.category} message — ${message.channel} is no longer enabled`,
        );
        await this.#notifications.markFailed(message.id, 'unsubscribed before delivery');
        result.skipped += 1;
        continue;
      }

      let destination = destinationCache.get(message.puuid);
      if (!destination) {
        destination = await this.#delivery.destinationFor(message.puuid);
        destinationCache.set(message.puuid, destination);
      }

      const outcome = await adapter.send(message, destination);

      if (outcome.status === 'sent') {
        await this.#notifications.markSent(message.id);
        result.sent += 1;
      } else if (outcome.status === 'skipped') {
        // Nothing to send to. Terminal — it will still be nothing next run,
        // and leaving it pending would retry it forever.
        await this.#notifications.markFailed(message.id, outcome.reason);
        result.skipped += 1;
      } else if (outcome.permanent) {
        await this.#notifications.markFailed(message.id, outcome.error);
        result.failedPermanently += 1;
      } else {
        // Left pending on purpose. The next run picks it up; nothing here
        // blocks the rest of the batch in the meantime.
        await this.#notifications.recordAttempt(message.id, outcome.error);
        result.deferred += 1;
      }
    }

    this.#log(
      `outbox: ${result.sent} sent, ${result.skipped} skipped, ` +
        `${result.failedPermanently} failed, ${result.deferred} deferred`,
    );

    return result;
  }
}
