/**
 * Where notifications actually go (task 6.6).
 *
 * Two destinations, with quite different consent stories, so they are
 * presented differently rather than as two rows of one form.
 *
 * **Push** is granted per browser, by the browser, and the permission prompt
 * is the consent. The one rule worth encoding: never call `requestPermission`
 * on page load. A prompt the user did not ask for is the fastest way to a
 * permanent `denied`, which cannot be undone from inside the page.
 *
 * **Email** is an address a person types, and it may not be theirs. Nothing is
 * sent to it until they click a link in it, and the UI says so at the moment
 * they submit rather than leaving them wondering why nothing arrives.
 *
 * _Requirements: 9.1, 9.2, 9.4, 11.3_
 */
'use client';

import { useEffect, useState, useTransition } from 'react';

import {
  clearNotificationEmail,
  registerPushSubscription,
  setNotificationEmail,
  unregisterPushSubscription,
  type DeliveryStatusView,
} from '@/lib/api';

export interface DeliverySetupProps {
  status: DeliveryStatusView;
  /** From ?verified= on the return leg of the confirmation link. */
  verification?: 'ok' | 'failed' | undefined;
}

type PushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

/**
 * VAPID keys travel as base64url; `applicationServerKey` wants raw bytes.
 *
 * Allocated over an explicit ArrayBuffer rather than via `Uint8Array.from`:
 * the DOM signature requires a view backed by a plain ArrayBuffer, and the
 * inferred `ArrayBufferLike` from the shorthand does not satisfy it.
 */
function decodeVapidKey(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));

  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function DeliverySetup({ status, verification }: DeliverySetupProps) {
  const [pushState, setPushState] = useState<PushState>('unconfigured');
  const [email, setEmail] = useState(status.email ?? '');
  const [verified, setVerified] = useState(status.emailVerified);
  const [message, setMessage] = useState<string | null>(
    verification === 'ok'
      ? 'Address confirmed — email notifications can now be sent to it.'
      : verification === 'failed'
        ? 'That confirmation link was invalid or has expired. Set the address again to get a new one.'
        : null,
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!status.vapidPublicKey) return setPushState('unconfigured');
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      return setPushState('unsupported');
    }
    if (Notification.permission === 'denied') return setPushState('denied');

    // Read the existing subscription rather than trusting the server's count:
    // the browser may have revoked it since, and the button has to describe
    // this browser, not the account.
    void navigator.serviceWorker.getRegistration().then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      setPushState(subscription ? 'on' : 'off');
    });
  }, [status.vapidPublicKey]);

  const enablePush = (): void => {
    setMessage(null);

    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');

        // Called from a click, never on load: an unprompted permission request
        // is the fastest route to a permanent denial the page cannot undo.
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setPushState(permission === 'denied' ? 'denied' : 'off');
          return;
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(status.vapidPublicKey!),
        });

        const raw = subscription.toJSON() as {
          endpoint?: string;
          keys?: { p256dh?: string; auth?: string };
        };

        if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys.auth) {
          setMessage('This browser returned an incomplete subscription.');
          return;
        }

        const result = await registerPushSubscription({
          endpoint: raw.endpoint,
          keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
        });

        if (result.ok) {
          setPushState('on');
          setMessage('This browser will now receive notifications.');
        } else {
          // Undo the browser-side half so the two cannot disagree.
          await subscription.unsubscribe();
          setMessage(result.detail);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not enable notifications.');
      }
    });
  };

  const disablePush = (): void => {
    startTransition(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return setPushState('off');

      await unregisterPushSubscription(subscription.endpoint);
      await subscription.unsubscribe();
      setPushState('off');
      setMessage('This browser will no longer receive notifications.');
    });
  };

  const saveEmail = (): void => {
    startTransition(async () => {
      const result = await setNotificationEmail(email.trim());
      if (!result.ok) {
        setMessage(result.detail);
        return;
      }
      setVerified(false);
      setMessage(
        `Confirmation sent to ${result.data.email}. Nothing goes there until you click it.`,
      );
    });
  };

  const removeEmail = (): void => {
    startTransition(async () => {
      const result = await clearNotificationEmail();
      if (!result.ok) return setMessage(result.detail);
      setEmail('');
      setVerified(false);
      setMessage('Address removed.');
    });
  };

  return (
    <section className="comp-detail__section">
      <h2>Where notifications go</h2>

      <div className="delivery-row">
        <div>
          <h3>This browser</h3>
          <p className="prefs-table__note">
            Push notifications are granted per browser and per device, so you will need to turn this
            on wherever you want them.
          </p>
        </div>
        <div>{renderPushControl(pushState, pending, enablePush, disablePush)}</div>
      </div>

      <div className="delivery-row">
        <div>
          <h3>Email</h3>
          <p className="prefs-table__note">
            Optional, and only used for the notifications you switch on above. Linking your Riot
            account does not give us an address — this one is yours to add and remove.
          </p>
        </div>
        <div>
          {!status.channels.email ? (
            <p className="empty-state">Email delivery isn&apos;t configured in this environment.</p>
          ) : (
            <div className="delivery-row__form">
              <label className="tftc-sr-only" htmlFor="notification-email">
                Notification email address
              </label>
              <input
                id="notification-email"
                type="email"
                className="tftc-input"
                value={email}
                placeholder="you@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
              <button
                type="button"
                className="tftc-btn tftc-btn--secondary"
                disabled={pending || email.trim().length === 0}
                onClick={saveEmail}
              >
                {status.email ? 'Change' : 'Add'}
              </button>
              {status.email && (
                <button
                  type="button"
                  className="tftc-btn tftc-btn--secondary tftc-btn--compact"
                  disabled={pending}
                  onClick={removeEmail}
                >
                  Remove
                </button>
              )}
            </div>
          )}

          {status.email && (
            <p className={verified ? 'delivery-row__ok' : 'empty-state'}>
              {verified
                ? 'Confirmed.'
                : 'Not confirmed yet — check your inbox. We send nothing to an unconfirmed address.'}
            </p>
          )}
        </div>
      </div>

      <p role="status" aria-live="polite" className="bookmark-btn__status">
        {message ?? ''}
      </p>
    </section>
  );
}

function renderPushControl(
  state: PushState,
  pending: boolean,
  enable: () => void,
  disable: () => void,
) {
  if (state === 'unconfigured') {
    return <p className="empty-state">Push isn&apos;t configured in this environment.</p>;
  }

  if (state === 'unsupported') {
    return <p className="empty-state">This browser doesn&apos;t support push notifications.</p>;
  }

  if (state === 'denied') {
    // The page cannot re-prompt once denied, so saying where the setting lives
    // is the only useful thing left to do.
    return (
      <p className="empty-state">
        Notifications are blocked for this site. You can re-enable them in your browser&apos;s site
        settings.
      </p>
    );
  }

  return (
    <button
      type="button"
      className={`tftc-btn ${state === 'on' ? 'tftc-btn--secondary' : 'tftc-btn--primary'}`}
      disabled={pending}
      onClick={state === 'on' ? disable : enable}
    >
      {state === 'on' ? 'Turn off for this browser' : 'Turn on for this browser'}
    </button>
  );
}
