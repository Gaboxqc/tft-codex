/**
 * Notification tests.
 *
 * R9.3 ("no channel enabled → send nothing") is the assertion that matters
 * most here — a notification system that leaks one message to someone who
 * opted out is worse than one that sends none at all.
 *
 * _Requirements: 8.2, 9.1, 9.2, 9.3, 9.4_
 */
import type { NotificationPref } from '@tft-codex/shared-types';
import { describe, expect, it } from 'vitest';

import { diffSnapshots } from './snapshot-diff.js';
import {
  enabledChannels,
  isFullyUnsubscribed,
  notifyBalanceChanges,
  notifyPatchSummary,
  notifyTierChanges,
  type Subscriber,
} from './notifications.js';

const pref = (
  category: NotificationPref['category'],
  channel: NotificationPref['channel'],
  enabled = true,
): NotificationPref => ({ category, channel, enabled });

const subscriber = (overrides: Partial<Subscriber> = {}): Subscriber => ({
  puuid: 'puuid-1',
  prefs: [pref('bookmarkedComp', 'email')],
  bookmarks: [{ kind: 'comp', targetId: 'vanguard-zoe' }],
  ...overrides,
});

/** A real diff, so the tests exercise the same records production would. */
const tierChange = (from: 'S' | 'A' | 'B' | 'C', to: 'S' | 'A' | 'B' | 'C') =>
  diffSnapshots([makeEntry('vanguard-zoe', from)], [makeEntry('vanguard-zoe', to)]).changed;

function makeEntry(compId: string, tier: 'S' | 'A' | 'B' | 'C') {
  return {
    compId,
    name: 'Vanguard Zoe',
    tier,
    trend: 'stable' as const,
    playstyle: 'Fast 8' as const,
    difficulty: 'Medium' as const,
    coreTraits: [],
    carries: [],
    compositeScore: 0.5,
    stats: {
      avgPlacement: 4.2,
      top4Rate: 0.5,
      winRate: 0.12,
      playRate: 0.05,
      sampleSize: 1000,
      computedAt: '2026-08-14T00:00:00.000Z',
    },
    metaShift: false,
  };
}

const context = { patch: '17.9', toVersion: 'v2' };

describe('R9.3 — no channel enabled means no notification', () => {
  it('sends nothing to a player with every channel switched off', () => {
    const optedOut = subscriber({
      prefs: [pref('bookmarkedComp', 'email', false), pref('patch', 'webpush', false)],
    });

    expect(notifyTierChanges(tierChange('S', 'C'), [optedOut], context)).toEqual([]);
    expect(
      notifyPatchSummary({ id: '17.9', setName: 'Set', metaImpactSummary: 'Big changes.' }, [
        optedOut,
      ]),
    ).toEqual([]);
  });

  it('sends nothing to a player with no preferences at all', () => {
    const silent = subscriber({ prefs: [] });
    expect(notifyTierChanges(tierChange('S', 'C'), [silent], context)).toEqual([]);
  });

  it('sends nothing for a category the player did not enable', () => {
    // Enabled for patch notes, not for comp tier changes.
    const patchOnly = subscriber({ prefs: [pref('patch', 'email')] });
    expect(notifyTierChanges(tierChange('S', 'C'), [patchOnly], context)).toEqual([]);
  });
});

describe('notifyTierChanges (_Requirements: 9.1_)', () => {
  it('notifies about a bookmarked comp on every enabled channel', () => {
    const multi = subscriber({
      prefs: [pref('bookmarkedComp', 'email'), pref('bookmarkedComp', 'webpush')],
    });
    const messages = notifyTierChanges(tierChange('B', 'A'), [multi], context);

    expect(messages.map((message) => message.channel).sort()).toEqual(['email', 'webpush']);
    expect(messages[0]!.body).toContain('Vanguard Zoe');
  });

  it('ignores a comp the player did not bookmark', () => {
    // The point of a subscription rather than a broadcast.
    const other = subscriber({ bookmarks: [{ kind: 'comp', targetId: 'bruiser-sett' }] });
    expect(notifyTierChanges(tierChange('S', 'C'), [other], context)).toEqual([]);
  });

  it('does not treat a champion bookmark as a comp bookmark', () => {
    const championOnly = subscriber({
      bookmarks: [{ kind: 'champion', targetId: 'vanguard-zoe' }],
    });
    expect(notifyTierChanges(tierChange('S', 'C'), [championOnly], context)).toEqual([]);
  });

  it('says "shifted" for a meta shift and "is now" for a normal move', () => {
    const shift = notifyTierChanges(tierChange('S', 'C'), [subscriber()], context);
    const normal = notifyTierChanges(tierChange('B', 'A'), [subscriber()], context);

    expect(shift[0]!.subject).toMatch(/shifted to/);
    expect(normal[0]!.subject).toMatch(/is now/);
  });

  it('uses the same copy the patch-history view shows', () => {
    // A player reading both must not be told two different things about one
    // event.
    const [change] = tierChange('S', 'C');
    const [message] = notifyTierChanges([change!], [subscriber()], context);
    expect(message!.body).toMatch(/bigger swing/);
  });

  it('produces a dedupe key stable across re-detection of the same event', () => {
    // An overlapping pipeline run must not send twice.
    const first = notifyTierChanges(tierChange('S', 'C'), [subscriber()], context);
    const second = notifyTierChanges(tierChange('S', 'C'), [subscriber()], context);
    expect(first[0]!.dedupeKey).toBe(second[0]!.dedupeKey);
  });

  it('produces a different dedupe key for a later snapshot', () => {
    const v2 = notifyTierChanges(tierChange('S', 'C'), [subscriber()], context);
    const v3 = notifyTierChanges(tierChange('S', 'C'), [subscriber()], {
      ...context,
      toVersion: 'v3',
    });
    expect(v2[0]!.dedupeKey).not.toBe(v3[0]!.dedupeKey);
  });
});

describe('notifyBalanceChanges (_Requirements: 9.1_)', () => {
  const balanceSubscriber = subscriber({
    prefs: [pref('bookmarkedChampion', 'email')],
    bookmarks: [{ kind: 'champion', targetId: 'TFT17_Zoe' }],
  });

  it('notifies about a bookmarked champion', () => {
    const messages = notifyBalanceChanges(
      [{ entityType: 'champion', entityId: 'TFT17_Zoe', summary: 'Spell damage reduced.' }],
      [balanceSubscriber],
      { patch: '17.9' },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toBe('Spell damage reduced.');
  });

  it('ignores non-champion balance changes', () => {
    const messages = notifyBalanceChanges(
      [{ entityType: 'item', entityId: 'TFT17_Zoe', summary: 'Item changed.' }],
      [balanceSubscriber],
      { patch: '17.9' },
    );
    expect(messages).toEqual([]);
  });
});

describe('notifyPatchSummary (_Requirements: 8.2_)', () => {
  const patchSubscriber = subscriber({ prefs: [pref('patch', 'email')] });

  it('sends an approved summary', () => {
    const messages = notifyPatchSummary(
      { id: '17.9', setName: 'Set 17', metaImpactSummary: 'Vanguard got worse.' },
      [patchSubscriber],
    );
    expect(messages[0]!.body).toBe('Vanguard got worse.');
  });

  it('sends nothing while the summary is still awaiting approval', () => {
    // R8.2 keeps it null until a human signs off. Sending a draft would route
    // around the approval step entirely.
    expect(
      notifyPatchSummary({ id: '17.9', setName: 'Set 17', metaImpactSummary: null }, [
        patchSubscriber,
      ]),
    ).toEqual([]);
  });
});

describe('Preference helpers (_Requirements: 9.4_)', () => {
  it('lists only enabled channels for a category', () => {
    const prefs = [
      pref('bookmarkedComp', 'email'),
      pref('bookmarkedComp', 'webpush', false),
      pref('patch', 'email'),
    ];
    expect(enabledChannels(prefs, 'bookmarkedComp')).toEqual(['email']);
  });

  it('detects a fully unsubscribed player', () => {
    expect(isFullyUnsubscribed([pref('patch', 'email', false)])).toBe(true);
    expect(isFullyUnsubscribed([])).toBe(true);
    expect(isFullyUnsubscribed([pref('patch', 'email')])).toBe(false);
  });
});
