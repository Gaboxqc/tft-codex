/**
 * Notification delivery worker entry point (task 6.6).
 *
 * `npm run notify --workspace @tft-codex/api`
 *
 * Drains whatever the pipeline queued. Run it on a short schedule — the outbox
 * is the buffer, so a missed run delays messages rather than losing them.
 *
 * Adapters are built only for channels this deployment has credentials for.
 * A channel without one leaves its messages pending rather than failing them:
 * the message is fine, the deployment simply cannot deliver it yet. That is
 * how `overwolf-native` behaves until Phase 5 ships.
 */
import { loadConfig } from '../config.js';
import { createPostgresPool } from '../db/postgres.js';
import { DeliveryRepository } from '../repositories/delivery-repository.js';
import { NotificationRepository } from '../repositories/notification-repository.js';
import { EmailAdapter } from '../services/delivery/email-adapter.js';
import type { DeliveryAdapter } from '../services/delivery/types.js';
import { WebPushAdapter } from '../services/delivery/web-push-adapter.js';
import { NotificationWorker } from '../services/notification-worker.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createPostgresPool(config.postgres.connectionString);
  const log = (message: string, detail?: unknown) =>
    console.warn(`[notify] ${message}`, detail ?? '');

  try {
    const delivery = new DeliveryRepository(db);
    const adapters: DeliveryAdapter[] = [];

    if (config.delivery.webPush) {
      adapters.push(
        new WebPushAdapter({
          ...config.delivery.webPush,
          webBaseUrl: config.webBaseUrl,
          // Pruning happens here rather than inside the adapter so the adapter
          // stays a pure sender with no database of its own.
          onExpired: async (puuid, endpoint) => {
            await delivery.removeSubscription(puuid, endpoint);
          },
          logger: log,
        }),
      );
    } else {
      log('web push disabled — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable');
    }

    if (config.delivery.email) {
      adapters.push(
        new EmailAdapter({
          ...config.delivery.email,
          webBaseUrl: config.webBaseUrl,
          logger: log,
        }),
      );
    } else {
      log('email disabled — set RESEND_API_KEY and EMAIL_FROM to enable');
    }

    if (adapters.length === 0) {
      log('no delivery channels configured; nothing to do');
      return;
    }

    const result = await new NotificationWorker({
      notifications: new NotificationRepository(db),
      delivery,
      adapters,
      logger: log,
    }).run();

    log(
      `done — claimed ${result.claimed}, sent ${result.sent}, ` +
        `skipped ${result.skipped}, failed ${result.failedPermanently}, ` +
        `deferred ${result.deferred}`,
    );
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error('[notify] failed', error);
  process.exit(1);
});
