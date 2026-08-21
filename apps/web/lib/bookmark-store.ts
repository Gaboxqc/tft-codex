/**
 * Bookmark state shared across a page (task 6.7).
 *
 * A store rather than a React context, for two reasons.
 *
 * The comp and champion pages are public and cacheable (R7.4); reading the
 * session cookie in a server component just to colour a star would opt every
 * one of them into per-request rendering. Fetching in the browser instead
 * keeps the page a cached public document with the personal layer arriving
 * separately.
 *
 * And bookmarks are one user's global state, not a subtree's — a store means
 * any page can drop a Follow button in without a provider having to be
 * remembered somewhere above it, and every button on the page moves together
 * when one of them is toggled.
 *
 * Its dependencies are injected so the optimistic-revert path can be tested
 * without a network or a DOM. That path is the one worth testing: a failed
 * revert leaves the UI claiming a subscription the server does not have.
 *
 * _Requirements: 9.1, 7.4_
 */
import type { ApiResult, BookmarkView } from './api';

export type BookmarkStatus = 'loading' | 'signed-out' | 'ready';

export interface BookmarkSnapshot {
  status: BookmarkStatus;
  keys: ReadonlySet<string>;
}

export interface BookmarkStoreDeps {
  list: () => Promise<ApiResult<{ bookmarks: BookmarkView[] }>>;
  add: (bookmark: BookmarkView) => Promise<ApiResult<unknown>>;
  remove: (bookmark: BookmarkView) => Promise<ApiResult<unknown>>;
}

export interface BookmarkStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => BookmarkSnapshot;
  /** Resolves to an error message, or null on success. */
  toggle: (bookmark: BookmarkView) => Promise<string | null>;
}

export const bookmarkKey = (bookmark: BookmarkView): string =>
  `${bookmark.kind}:${bookmark.targetId}`;

const LOADING: BookmarkSnapshot = { status: 'loading', keys: new Set() };

export function createBookmarkStore(deps: BookmarkStoreDeps): BookmarkStore {
  let snapshot: BookmarkSnapshot = LOADING;
  let started = false;
  const listeners = new Set<() => void>();

  const publish = (next: BookmarkSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const load = (): void => {
    void deps.list().then((result) => {
      publish(
        result.ok
          ? { status: 'ready', keys: new Set(result.data.bookmarks.map(bookmarkKey)) }
          : // Anything other than a session reads as signed-out here. Rendering
            // a toggle that cannot work is worse than a sign-in link, which is
            // harmless even when the real problem was an unreachable API.
            { status: 'signed-out', keys: new Set() },
      );
    });
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      // Fetched once for the whole page, by whichever button mounts first.
      if (!started) {
        started = true;
        load();
      }
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: () => snapshot,

    async toggle(bookmark) {
      const key = bookmarkKey(bookmark);
      const adding = !snapshot.keys.has(key);

      const withKey = (present: boolean): ReadonlySet<string> => {
        const next = new Set(snapshot.keys);
        if (present) next.add(key);
        else next.delete(key);
        return next;
      };

      // Optimistic — the button is the only feedback there is, and a round trip
      // of dead time reads as a broken control.
      publish({ status: snapshot.status, keys: withKey(adding) });

      const result = adding ? await deps.add(bookmark) : await deps.remove(bookmark);
      if (result.ok) return null;

      // Reverted against the *current* snapshot, not a captured copy, so a
      // second toggle made while this one was in flight is not clobbered.
      publish({ status: snapshot.status, keys: withKey(!adding) });
      return result.detail;
    },
  };
}

/** The server render has no session, so it always sees the loading state. */
export const serverBookmarkSnapshot = LOADING;
