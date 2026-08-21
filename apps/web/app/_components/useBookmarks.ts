/**
 * The page's single bookmark store, and the hook that reads it (task 6.7).
 *
 * The store itself lives in `lib/bookmark-store.ts` with its dependencies
 * injected; this module is only the wiring to the real API and to React.
 *
 * _Requirements: 9.1, 7.4_
 */
'use client';

import { useSyncExternalStore } from 'react';

import { addBookmark, getMyBookmarks, removeBookmark, type BookmarkView } from '@/lib/api';
import {
  bookmarkKey,
  createBookmarkStore,
  serverBookmarkSnapshot,
  type BookmarkStatus,
} from '@/lib/bookmark-store';

const store = createBookmarkStore({
  list: getMyBookmarks,
  add: addBookmark,
  remove: removeBookmark,
});

/** Resolves to an error message, or null on success. */
export const toggleBookmark = (bookmark: BookmarkView): Promise<string | null> =>
  store.toggle(bookmark);

export function useBookmarks(): {
  status: BookmarkStatus;
  has: (bookmark: BookmarkView) => boolean;
} {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => serverBookmarkSnapshot,
  );

  return {
    status: snapshot.status,
    has: (bookmark) => snapshot.keys.has(bookmarkKey(bookmark)),
  };
}
