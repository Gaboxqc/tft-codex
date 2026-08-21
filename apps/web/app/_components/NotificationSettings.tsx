/**
 * Notification preferences and the followed list (tasks 6.5, 6.7).
 *
 * Preferences are saved wholesale, not switch by switch: the grid below is the
 * complete state, and a per-switch write would let a half-applied save leave
 * someone subscribed to something they had just turned off. R9.3 makes that
 * the expensive direction to be wrong in — one unwanted message is worse than
 * one missed one.
 *
 * _Requirements: 9.1, 9.3, 9.4, 11.3_
 */
'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';

import {
  putNotificationPrefs,
  removeBookmark,
  unsubscribeCategory,
  type BookmarkView,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPrefView,
} from '@/lib/api';

const CHANNELS: { id: NotificationChannel; label: string; note?: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'webpush', label: 'Browser push' },
  // Phase 5 is gated on the Riot and Overwolf approvals, so this channel
  // cannot deliver yet. Offering it as though it could would be a promise we
  // already know we are not keeping.
  { id: 'overwolf-native', label: 'Desktop app', note: 'when the desktop app ships' },
];

const CATEGORIES: { id: NotificationCategory; label: string; description: string }[] = [
  { id: 'patch', label: 'Patch summaries', description: 'What changed, once per patch.' },
  {
    id: 'bookmarkedComp',
    label: 'Comps you follow',
    description: 'When one moves up or down a tier.',
  },
  {
    id: 'bookmarkedChampion',
    label: 'Champions you follow',
    description: 'When one is buffed or nerfed.',
  },
];

const keyOf = (channel: NotificationChannel, category: NotificationCategory): string =>
  `${channel}:${category}`;

export interface NotificationSettingsProps {
  initialPrefs: NotificationPrefView[];
  bookmarks: BookmarkView[];
  /** Which channels this deployment can actually deliver on (task 6.6). */
  channels?: Record<NotificationChannel, boolean> | undefined;
}

export function NotificationSettings({
  initialPrefs,
  bookmarks: initialBookmarks,
  channels: available,
}: NotificationSettingsProps) {
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        initialPrefs
          .filter((pref) => pref.enabled)
          .map((pref) => keyOf(pref.channel, pref.category)),
      ),
  );
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  const flip = (channel: NotificationChannel, category: NotificationCategory): void => {
    const key = keyOf(channel, category);
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setDirty(true);
    setMessage(null);
  };

  const save = (): void => {
    // The whole matrix goes up, switches that are off included — that is what
    // makes a wholesale replace safe rather than lossy.
    const prefs: NotificationPrefView[] = CHANNELS.flatMap((channel) =>
      CATEGORIES.map((category) => ({
        channel: channel.id,
        category: category.id,
        enabled: enabled.has(keyOf(channel.id, category.id)),
      })),
    );

    startTransition(async () => {
      const result = await putNotificationPrefs(prefs);
      setMessage(result.ok ? 'Saved.' : result.detail);
      if (result.ok) setDirty(false);
    });
  };

  /** R9.4 — one action stops a whole category across every channel. */
  const stopCategory = (category: NotificationCategory, label: string): void => {
    startTransition(async () => {
      const result = await unsubscribeCategory(category);
      if (!result.ok) {
        setMessage(result.detail);
        return;
      }

      setEnabled((current) => {
        const next = new Set(current);
        for (const channel of CHANNELS) next.delete(keyOf(channel.id, category));
        return next;
      });
      // The server has already applied it, so there is nothing left unsaved.
      setDirty(false);
      setMessage(`Stopped: ${label}.`);
    });
  };

  const unfollow = (bookmark: BookmarkView): void => {
    startTransition(async () => {
      const result = await removeBookmark(bookmark);
      if (!result.ok) {
        setMessage(result.detail);
        return;
      }

      setBookmarks((current) =>
        current.filter(
          (entry) => !(entry.kind === bookmark.kind && entry.targetId === bookmark.targetId),
        ),
      );
    });
  };

  return (
    <>
      {/*
        A switch for a channel this deployment cannot deliver on is a promise
        we already know we are not keeping, so say so rather than letting
        someone discover it by never receiving anything.
      */}
      {available && !available.email && !available.webpush && (
        <p className="empty-state">
          No delivery channel is configured here yet. Your choices are saved, but nothing can be
          sent until one is switched on.
        </p>
      )}

      <section className="comp-detail__section">
        <h2>How you hear</h2>

        <table className="tftc-table prefs-table">
          <thead>
            <tr>
              <th scope="col">Tell me about</th>
              {CHANNELS.map((channel) => (
                <th scope="col" key={channel.id}>
                  {channel.label}
                  {channel.note && <span className="prefs-table__note"> {channel.note}</span>}
                  {available && !available[channel.id] && !channel.note && (
                    <span className="prefs-table__note"> not configured</span>
                  )}
                </th>
              ))}
              <th scope="col">
                <span className="tftc-sr-only">Stop this category</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((category) => (
              <tr key={category.id}>
                <th scope="row">
                  {category.label}
                  <span className="prefs-table__note"> {category.description}</span>
                </th>
                {CHANNELS.map((channel) => (
                  <td key={channel.id}>
                    <label className="prefs-table__switch">
                      <input
                        type="checkbox"
                        checked={enabled.has(keyOf(channel.id, category.id))}
                        onChange={() => flip(channel.id, category.id)}
                      />
                      {/* Each checkbox needs its own name, not just a column header. */}
                      <span className="tftc-sr-only">
                        {category.label} by {channel.label}
                      </span>
                    </label>
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="tftc-btn tftc-btn--secondary tftc-btn--compact"
                    disabled={pending}
                    onClick={() => stopCategory(category.id, category.label)}
                  >
                    Stop all
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="comp-detail__actions">
          <button
            type="button"
            className="tftc-btn tftc-btn--primary"
            disabled={pending || !dirty}
            onClick={save}
          >
            {pending ? 'Saving…' : 'Save preferences'}
          </button>
          <span role="status" aria-live="polite">
            {message ?? ''}
          </span>
        </p>

        {enabled.size === 0 && (
          /* Stated outright rather than left to be inferred from empty switches. */
          <p className="empty-state">Everything is off — you will receive nothing from us.</p>
        )}
      </section>

      <section className="comp-detail__section">
        <h2>What you follow</h2>
        {bookmarks.length === 0 ? (
          <p className="empty-state">
            You aren&apos;t following anything yet. Open a{' '}
            <Link href="/">comp from the tier list</Link> and use its Follow button.
          </p>
        ) : (
          <ul className="bookmark-list">
            {bookmarks.map((bookmark) => (
              <li key={`${bookmark.kind}:${bookmark.targetId}`}>
                {bookmark.kind === 'comp' ? (
                  <Link href={`/comps/${encodeURIComponent(bookmark.targetId)}`}>
                    {bookmark.targetId}
                  </Link>
                ) : (
                  <span>{shortId(bookmark.targetId)}</span>
                )}
                <span className="bookmark-list__kind">
                  {bookmark.kind === 'comp' ? 'comp' : 'champion'}
                </span>
                <button
                  type="button"
                  className="tftc-btn tftc-btn--secondary tftc-btn--compact"
                  disabled={pending}
                  onClick={() => unfollow(bookmark)}
                >
                  Unfollow
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

const shortId = (id: string): string =>
  id.replace(/^TFT\d*_/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
