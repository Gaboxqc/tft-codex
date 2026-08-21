/**
 * Outbox delivery worker tests (task 6.6).
 *
 * _Requirements: 9.1, 9.2, 9.3_
 */
import type { NotificationPref } from '@tft-codex/shared-types';
import { describe, expect, it, vi } from 'vitest';

import type { DeliveryRepository } from '../repositories/delivery-repository.js';
import type { NotificationRepository } from '../repositories/notification-repository.js';
import type { DeliveryAdapter, DeliveryOutcome, Destination } from './delivery/types.js';
import { NotificationWorker } from './notification-worker.js';

const QUEUED = {
  id: 1,
  puuid: 'puuid-1',
  channel: 'email' as const,
  category: 'bookmarkedComp' as const,
  subject: 'Vanguard Zoe moved tier',
  body: 'S → B.',
  dedupeKey: 'shift:vanguard-zoe:v2',
};

const ON: NotificationPref[] = [{ channel: 'email', category: 'bookmarkedComp', enabled: true }];

const DESTINATION: Destination = { email: 'player@example.com', pushSubscriptions: [] };

const adapterReturning = (outcome: DeliveryOutcome, channel: 'email' | 'webpush' = 'email') => ({
  channel,
  send: vi.fn(async (): Promise<DeliveryOutcome> => outcome),
});

const build = (options: {
  pending?: (typeof QUEUED)[];
  prefs?: NotificationPref[];
  destination?: Destination;
  adapter?: DeliveryAdapter;
}) => {
  const notifications = {
    claimPending: vi.fn(async () => options.pending ?? [QUEUED]),
    prefsFor: vi.fn(async () => options.prefs ?? ON),
    markSent: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    recordAttempt: vi.fn(async () => undefined),
  };

  const delivery = {
    destinationFor: vi.fn(async () => options.destination ?? DESTINATION),
  };

  const adapter = options.adapter ?? adapterReturning({ status: 'sent' });

  return {
    notifications,
    delivery,
    adapter,
    worker: new NotificationWorker({
      notifications: notifications as unknown as NotificationRepository,
      delivery: delivery as unknown as DeliveryRepository,
      adapters: [adapter],
    }),
  };
};

describe('Consent at send time (_Requirements: 9.3_)', () => {
  it('does not send to someone who unsubscribed after the message was queued', async () => {
    // The queue is not the authority on consent — the preferences table is,
    // and it may have changed since the row was written. R9.3 makes one
    // unwanted message worse than one missed one.
    const { worker, notifications, adapter } = build({
      prefs: [{ channel: 'email', category: 'bookmarkedComp', enabled: false }],
    });

    const result = await worker.run();

    expect(adapter.send).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(notifications.markFailed).toHaveBeenCalledWith(1, 'unsubscribed before delivery');
  });

  it('does not send on a channel the player turned off, even if another is on', async () => {
    const { worker, adapter } = build({
      prefs: [{ channel: 'webpush', category: 'bookmarkedComp', enabled: true }],
    });

    await worker.run();
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('does not send a category the player never enabled', async () => {
    const { worker, adapter } = build({
      prefs: [{ channel: 'email', category: 'patch', enabled: true }],
    });

    await worker.run();
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('sends when the preference is still on', async () => {
    const { worker, notifications, adapter } = build({});
    const result = await worker.run();

    expect(adapter.send).toHaveBeenCalledOnce();
    expect(notifications.markSent).toHaveBeenCalledWith(1);
    expect(result.sent).toBe(1);
  });
});

describe('Failure handling (_Requirements: 9.2_)', () => {
  it('marks a permanent failure terminal', async () => {
    const { worker, notifications } = build({
      adapter: adapterReturning({ status: 'failed', permanent: true, error: '410 gone' }),
    });

    const result = await worker.run();

    expect(notifications.markFailed).toHaveBeenCalledWith(1, '410 gone');
    expect(notifications.recordAttempt).not.toHaveBeenCalled();
    expect(result.failedPermanently).toBe(1);
  });

  it('leaves a transient failure pending for the next run', async () => {
    // Marking it failed would silently drop a message someone asked for.
    const { worker, notifications } = build({
      adapter: adapterReturning({ status: 'failed', permanent: false, error: '503' }),
    });

    const result = await worker.run();

    expect(notifications.recordAttempt).toHaveBeenCalledWith(1, '503');
    expect(notifications.markFailed).not.toHaveBeenCalled();
    expect(result.deferred).toBe(1);
  });

  it('treats a missing destination as terminal rather than retrying forever', async () => {
    const { worker, notifications } = build({
      adapter: adapterReturning({ status: 'skipped', reason: 'no verified email address' }),
    });

    await worker.run();

    expect(notifications.markFailed).toHaveBeenCalledWith(1, 'no verified email address');
  });

  it('does not let one bad message stall the rest of the batch', async () => {
    const failing: DeliveryAdapter = {
      channel: 'email',
      send: vi
        .fn()
        .mockResolvedValueOnce({ status: 'failed', permanent: true, error: 'bounced' })
        .mockResolvedValueOnce({ status: 'sent' }),
    };

    const { worker } = build({
      pending: [QUEUED, { ...QUEUED, id: 2, puuid: 'puuid-2' }],
      adapter: failing,
    });

    const result = await worker.run();

    expect(result.failedPermanently).toBe(1);
    expect(result.sent).toBe(1);
  });
});

describe('Channels with no adapter (_Requirements: 9.2_)', () => {
  it('defers rather than failing a channel this deployment cannot deliver', async () => {
    // Overwolf-native before Phase 5 ships. The message is fine; the
    // deployment simply has nowhere to send it yet.
    const { worker, notifications } = build({
      pending: [{ ...QUEUED, channel: 'overwolf-native' as unknown as 'email' }],
    });

    const result = await worker.run();

    expect(result.deferred).toBe(1);
    expect(notifications.markFailed).not.toHaveBeenCalled();
    expect(notifications.markSent).not.toHaveBeenCalled();
  });
});

describe('Batching (_Requirements: 9.2_)', () => {
  it('reads preferences once per player, not once per message', async () => {
    const { worker, notifications } = build({
      pending: [QUEUED, { ...QUEUED, id: 2 }, { ...QUEUED, id: 3 }],
    });

    await worker.run();

    expect(notifications.prefsFor).toHaveBeenCalledOnce();
  });

  it('resolves the destination once per player', async () => {
    const { worker, delivery } = build({
      pending: [QUEUED, { ...QUEUED, id: 2 }],
    });

    await worker.run();

    expect(delivery.destinationFor).toHaveBeenCalledOnce();
  });

  it('reports an empty queue without touching anything', async () => {
    const { worker, delivery } = build({ pending: [] });
    const result = await worker.run();

    expect(result).toEqual({
      claimed: 0,
      sent: 0,
      skipped: 0,
      failedPermanently: 0,
      deferred: 0,
    });
    expect(delivery.destinationFor).not.toHaveBeenCalled();
  });
});
