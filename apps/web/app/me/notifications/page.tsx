/**
 * Notification settings and followed things (tasks 6.5, 6.7).
 *
 * One page rather than two, because the two halves only make sense together:
 * a channel switch decides *how* you hear, a bookmark decides *what about*,
 * and neither on its own tells you what you will actually receive.
 *
 * R9.4 requires unsubscribing to be easy, so it is a one-click control here
 * and not a scavenger hunt through a settings tree.
 *
 * _Requirements: 9.1, 9.3, 9.4, 7.1, 7.4_
 */
import type { Metadata } from 'next';

import { getBookmarks, getDeliveryStatus, getNotificationPrefs } from '@/lib/api';
import { sessionCookie } from '@/lib/session';
import { DeliverySetup } from '../../_components/DeliverySetup';
import { NotificationSettings } from '../../_components/NotificationSettings';
import { SignInPrompt } from '../../_components/SignInPrompt';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Notifications',
};

interface NotificationsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const verifiedParam = single((await searchParams)['verified']);
  const cookie = await sessionCookie();
  if (!cookie) {
    return <SignInPrompt redirectTo="/me/notifications" what="your notification settings" />;
  }

  const [prefs, bookmarks, delivery] = await Promise.all([
    getNotificationPrefs(cookie),
    getBookmarks(cookie),
    getDeliveryStatus(cookie),
  ]);

  if (!prefs.ok) {
    return prefs.reason === 'unauthenticated' ? (
      <SignInPrompt redirectTo="/me/notifications" what="your notification settings" />
    ) : (
      <div className="tftc-stale-banner" role="status">
        <span className="tftc-stale-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <span>Couldn&apos;t load your notification settings: {prefs.detail}</span>
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Notifications</h1>
        <p className="page-lede">
          What you hear about, and how. Nothing is sent unless you switch it on here.
        </p>
      </header>

      {delivery.ok && (
        <DeliverySetup
          status={delivery.data}
          verification={
            verifiedParam === 'ok' ? 'ok' : verifiedParam === 'failed' ? 'failed' : undefined
          }
        />
      )}

      <NotificationSettings
        initialPrefs={prefs.data.prefs}
        bookmarks={bookmarks.ok ? bookmarks.data.bookmarks : []}
        channels={delivery.ok ? delivery.data.channels : undefined}
      />
    </>
  );
}
