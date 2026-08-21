/**
 * Bookmark store tests (task 6.7).
 *
 * _Requirements: 9.1, 7.4_
 */
import { describe, expect, it, vi } from 'vitest';

import type { ApiResult, BookmarkView } from './api';
import { createBookmarkStore, type BookmarkStoreDeps } from './bookmark-store';

const COMP: BookmarkView = { kind: 'comp', targetId: 'vanguard-zoe' };

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = (): ApiResult<never> => ({
  ok: false,
  reason: 'unavailable',
  detail: 'That did not save.',
});

const build = (overrides: Partial<BookmarkStoreDeps> = {}) => {
  const deps: BookmarkStoreDeps = {
    list: vi.fn(async () => ok({ bookmarks: [] as BookmarkView[] })),
    add: vi.fn(async () => ok({})),
    remove: vi.fn(async () => ok({})),
    ...overrides,
  };
  return { deps, store: createBookmarkStore(deps) };
};

/** Subscribing starts the load; the promise chain settles on the next tick. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Loading (_Requirements: 9.1, 7.4_)', () => {
  it('starts in loading, not in a guessed state', () => {
    // A button that renders "Follow" before the answer is known and then
    // corrects itself has told the reader something false in between.
    const { store } = build();
    expect(store.getSnapshot().status).toBe('loading');
  });

  it('fetches once however many buttons subscribe', async () => {
    const { deps, store } = build();

    store.subscribe(() => {});
    store.subscribe(() => {});
    store.subscribe(() => {});
    await settle();

    expect(deps.list).toHaveBeenCalledTimes(1);
  });

  it('treats a 401 as signed-out', async () => {
    const { store } = build({
      list: async () => ({ ok: false, reason: 'unauthenticated', detail: 'Sign in.' }),
    });

    store.subscribe(() => {});
    await settle();

    expect(store.getSnapshot().status).toBe('signed-out');
  });

  it('treats an unreachable API as signed-out rather than showing a dead toggle', async () => {
    const { store } = build({ list: async () => fail() });

    store.subscribe(() => {});
    await settle();

    expect(store.getSnapshot().status).toBe('signed-out');
  });

  it('notifies subscribers when the load lands', async () => {
    const listener = vi.fn();
    const { store } = build({ list: async () => ok({ bookmarks: [COMP] }) });

    store.subscribe(listener);
    await settle();

    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot().keys.has('comp:vanguard-zoe')).toBe(true);
  });
});

describe('Toggling (_Requirements: 9.1_)', () => {
  it('shows the new state before the server answers', async () => {
    let release: (() => void) | undefined;
    const { store } = build({
      add: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return ok({});
      },
    });

    store.subscribe(() => {});
    await settle();

    const pending = store.toggle(COMP);
    expect(store.getSnapshot().keys.has('comp:vanguard-zoe')).toBe(true);

    release?.();
    expect(await pending).toBeNull();
    expect(store.getSnapshot().keys.has('comp:vanguard-zoe')).toBe(true);
  });

  it('reverts and reports when the server refuses', async () => {
    // The failure that matters: leaving the star lit would tell someone they
    // are subscribed to something the server has no record of.
    const { store } = build({ add: async () => fail() });

    store.subscribe(() => {});
    await settle();

    expect(await store.toggle(COMP)).toBe('That did not save.');
    expect(store.getSnapshot().keys.has('comp:vanguard-zoe')).toBe(false);
  });

  it('removes an existing bookmark rather than adding it again', async () => {
    const { deps, store } = build({ list: async () => ok({ bookmarks: [COMP] }) });

    store.subscribe(() => {});
    await settle();
    await store.toggle(COMP);

    expect(deps.remove).toHaveBeenCalledWith(COMP);
    expect(deps.add).not.toHaveBeenCalled();
    expect(store.getSnapshot().keys.has('comp:vanguard-zoe')).toBe(false);
  });

  it('reverts a failed removal back to followed', async () => {
    const { store } = build({
      list: async () => ok({ bookmarks: [COMP] }),
      remove: async () => fail(),
    });

    store.subscribe(() => {});
    await settle();

    expect(await store.toggle(COMP)).toBe('That did not save.');
    expect(store.getSnapshot().keys.has('comp:vanguard-zoe')).toBe(true);
  });

  it('keeps a second toggle made while the first was in flight', async () => {
    // The revert works from the current snapshot, not a copy captured before
    // the request — otherwise an unrelated toggle made meanwhile is undone.
    const other: BookmarkView = { kind: 'champion', targetId: 'TFT17_Leona' };
    let release: (() => void) | undefined;

    const { store } = build({
      add: async (bookmark) => {
        if (bookmark.targetId !== COMP.targetId) return ok({});
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return fail();
      },
    });

    store.subscribe(() => {});
    await settle();

    const pending = store.toggle(COMP);
    await store.toggle(other);

    release?.();
    await pending;

    expect(store.getSnapshot().keys.has('comp:vanguard-zoe')).toBe(false);
    expect(store.getSnapshot().keys.has('champion:TFT17_Leona')).toBe(true);
  });

  it('stops notifying an unsubscribed listener', async () => {
    const listener = vi.fn();
    const { store } = build();

    const unsubscribe = store.subscribe(listener);
    await settle();
    unsubscribe();
    listener.mockClear();

    await store.toggle(COMP);
    expect(listener).not.toHaveBeenCalled();
  });
});
