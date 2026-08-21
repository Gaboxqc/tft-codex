/**
 * Bookmark toggle for a comp or a champion (task 6.7).
 *
 * A bookmark is the subscription primitive: R9.2 and R9.3 send tier-change and
 * balance-change notifications for bookmarked things only, so this button is
 * what the whole notification system is driven by.
 *
 * Signed out it renders a sign-in link rather than a toggle. A control that
 * looks live and then fails is worse than one that says plainly what it needs,
 * and R7.4 means most of the product works without an account — so this stays
 * a quiet aside, not a wall.
 *
 * _Requirements: 9.1, 9.2, 9.3, 7.4, 11.3_
 */
'use client';

import { useState, useTransition } from 'react';

import type { BookmarkView } from '@/lib/api';
import { signInHref } from '@/lib/sign-in';
import { toggleBookmark, useBookmarks } from './useBookmarks';

export interface BookmarkButtonProps {
  kind: BookmarkView['kind'];
  targetId: string;
  /** Human name, so the button and its announcement read as a sentence. */
  label: string;
  /** Where to return after linking an account. */
  redirectTo: string;
  /** Compact variant, for use inside a table row. */
  small?: boolean;
}

export function BookmarkButton({
  kind,
  targetId,
  label,
  redirectTo,
  small = false,
}: BookmarkButtonProps) {
  const { status, has } = useBookmarks();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sizeClass = small ? ' bookmark-btn--small' : '';

  if (status === 'loading') {
    // Deliberately not rendered as "Follow" while unknown: showing the wrong
    // state and correcting it a moment later tells the reader something false.
    return (
      <span className={`bookmark-btn bookmark-btn--loading${sizeClass}`} aria-hidden="true">
        ☆ …
      </span>
    );
  }

  if (status === 'signed-out') {
    return (
      <a
        className={`bookmark-btn bookmark-btn--signed-out${sizeClass}`}
        href={signInHref(redirectTo)}
        title={`Link a Riot account to be told when ${label} changes`}
      >
        <span aria-hidden="true">☆</span> Sign in to follow
      </a>
    );
  }

  const on = has({ kind, targetId });

  return (
    <span className="bookmark-btn__wrap">
      <button
        type="button"
        className={`bookmark-btn${on ? ' bookmark-btn--on' : ''}${sizeClass}`}
        aria-pressed={on}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => setError(await toggleBookmark({ kind, targetId })));
        }}
      >
        {/* The star is decorative; the text carries the state (R11.3). */}
        <span aria-hidden="true">{on ? '★' : '☆'}</span>{' '}
        {on ? `Following ${label}` : `Follow ${label}`}
      </button>
      {/* Announced politely so a screen reader hears a failure too. */}
      <span role="status" aria-live="polite" className="bookmark-btn__status">
        {error ?? ''}
      </span>
    </span>
  );
}
