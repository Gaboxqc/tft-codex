/*
 * Service worker for web push (task 6.6).
 *
 * Deliberately minimal. This file has no job other than receiving a push and
 * showing it — no caching, no fetch interception, no offline strategy. A
 * service worker that quietly starts serving stale pages is a support burden
 * nobody asked for, and R1.6 already has opinions about showing stale data.
 *
 * Requirements: 9.1, 9.2
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // A push we cannot parse is not worth a notification the user cannot act
    // on. Swallowing it beats showing "undefined".
    return;
  }

  const title = payload.title || 'TFT Codex';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-badge.png',
      // Collapses repeats of the same category rather than stacking them: a
      // player who has been away should not return to fourteen banners.
      tag: payload.category || 'tftcodex',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = event.notification.data && event.notification.data.url;
  if (!target) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Focus an existing tab if one is open rather than piling up new ones.
      for (const client of windows) {
        if (client.url.includes(new URL(target, self.location.origin).pathname)) {
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

/*
 * The browser can revoke a subscription on its own — a long absence, a storage
 * purge, a key rotation. When it does, re-subscribe and tell the server, or
 * the player silently stops receiving anything they asked for.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey =
        event.oldSubscription && event.oldSubscription.options
          ? event.oldSubscription.options.applicationServerKey
          : null;

      if (!applicationServerKey) return;

      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      await fetch('/api/push/resubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription),
        credentials: 'include',
      });
    })(),
  );
});
