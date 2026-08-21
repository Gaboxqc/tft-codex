/**
 * Deciding what to notify whom (tasks 6.5, 6.6).
 *
 * The rule that shapes everything here is **R9.3: where a user has not enabled
 * any notification channel, the system SHALL NOT send notifications.** So this
 * module's job is to turn (event, preferences, bookmarks) into an explicit,
 * possibly empty, list of messages — and to make "empty" the default that
 * falls out of the data rather than a case someone has to remember to handle.
 *
 * Every message is built here rather than at the delivery site, so the
 * unsubscribe check and the message body cannot drift apart: a message that
 * exists is one somebody asked for.
 *
 * _Requirements: 8.3, 9.1, 9.2, 9.3, 9.4_
 */
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPref,
} from '@tft-codex/shared-types';

import { describeChange, type SnapshotComparison } from './snapshot-diff.js';

export interface Bookmark {
  kind: 'comp' | 'champion';
  targetId: string;
}

export interface Subscriber {
  puuid: string;
  prefs: NotificationPref[];
  bookmarks: Bookmark[];
}

export interface OutboundNotification {
  puuid: string;
  channel: NotificationChannel;
  category: NotificationCategory;
  subject: string;
  body: string;
  /**
   * Stable per (player, event). The outbox has a unique constraint on it, so
   * an overlapping pipeline run that re-detects the same shift cannot send
   * twice.
   */
  dedupeKey: string;
}

/** Channels this player has switched on for a category. */
export function enabledChannels(
  prefs: readonly NotificationPref[],
  category: NotificationCategory,
): NotificationChannel[] {
  return prefs
    .filter((pref) => pref.category === category && pref.enabled)
    .map((pref) => pref.channel);
}

/**
 * True when the player has no channel enabled for anything.
 *
 * R9.4 requires unsubscribing from a category in one action without deleting
 * the account; this is the check that makes "unsubscribed from everything"
 * genuinely silent rather than merely quiet.
 */
export function isFullyUnsubscribed(prefs: readonly NotificationPref[]): boolean {
  return !prefs.some((pref) => pref.enabled);
}

/**
 * Messages for a batch of tier changes (R8.3 → R9.1).
 *
 * Only bookmarked comps produce a message. A player who bookmarked nothing
 * gets nothing, however dramatic the patch — that is the point of a
 * subscription rather than a broadcast.
 */
export function notifyTierChanges(
  changes: readonly SnapshotComparison[],
  subscribers: readonly Subscriber[],
  context: { patch: string; toVersion: string },
): OutboundNotification[] {
  const messages: OutboundNotification[] = [];

  for (const subscriber of subscribers) {
    // Checked first so an unsubscribed player costs one comparison rather than
    // a full pass over every change.
    if (isFullyUnsubscribed(subscriber.prefs)) continue;

    const channels = enabledChannels(subscriber.prefs, 'bookmarkedComp');
    if (channels.length === 0) continue;

    const bookmarked = new Set(
      subscriber.bookmarks.filter((mark) => mark.kind === 'comp').map((mark) => mark.targetId),
    );

    for (const change of changes) {
      if (!bookmarked.has(change.compId)) continue;

      for (const channel of channels) {
        messages.push({
          puuid: subscriber.puuid,
          channel,
          category: 'bookmarkedComp',
          subject: change.metaShift
            ? `${change.name} shifted to ${change.to} tier`
            : `${change.name} is now ${change.to} tier`,
          // Same copy the patch-history view shows, so a player reading both
          // is not told two different things about one event.
          body: describeChange(change),
          dedupeKey: `comp:${change.compId}:${context.patch}:${context.toVersion}`,
        });
      }
    }
  }

  return messages;
}

/**
 * Messages for balance changes to bookmarked champions (R9.1).
 */
export function notifyBalanceChanges(
  balanceChanges: readonly { entityType: string; entityId: string; summary: string }[],
  subscribers: readonly Subscriber[],
  context: { patch: string },
): OutboundNotification[] {
  const messages: OutboundNotification[] = [];
  const championChanges = balanceChanges.filter((change) => change.entityType === 'champion');

  for (const subscriber of subscribers) {
    if (isFullyUnsubscribed(subscriber.prefs)) continue;

    const channels = enabledChannels(subscriber.prefs, 'bookmarkedChampion');
    if (channels.length === 0) continue;

    const bookmarked = new Set(
      subscriber.bookmarks.filter((mark) => mark.kind === 'champion').map((mark) => mark.targetId),
    );

    for (const change of championChanges) {
      if (!bookmarked.has(change.entityId)) continue;

      for (const channel of channels) {
        messages.push({
          puuid: subscriber.puuid,
          channel,
          category: 'bookmarkedChampion',
          subject: `${change.entityId} changed in patch ${context.patch}`,
          body: change.summary,
          dedupeKey: `champion:${change.entityId}:${context.patch}`,
        });
      }
    }
  }

  return messages;
}

/**
 * Messages for a newly published patch summary (R8.2 → R9.1).
 *
 * Requires an *approved* summary. R8.2 keeps `metaImpactSummary` null until a
 * human signs off, and sending a draft would route around that entirely — so
 * a null summary produces no messages rather than a placeholder.
 */
export function notifyPatchSummary(
  patch: { id: string; setName: string; metaImpactSummary: string | null },
  subscribers: readonly Subscriber[],
): OutboundNotification[] {
  if (!patch.metaImpactSummary) return [];

  const messages: OutboundNotification[] = [];

  for (const subscriber of subscribers) {
    if (isFullyUnsubscribed(subscriber.prefs)) continue;

    for (const channel of enabledChannels(subscriber.prefs, 'patch')) {
      messages.push({
        puuid: subscriber.puuid,
        channel,
        category: 'patch',
        subject: `Patch ${patch.id} — what changed`,
        body: patch.metaImpactSummary,
        dedupeKey: `patch:${patch.id}`,
      });
    }
  }

  return messages;
}
