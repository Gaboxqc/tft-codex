/**
 * Comparing two tier-list snapshots (task 6.3).
 *
 * R8.3 flags a comp that moved "more than one full tier between two
 * consecutive computed rankings". The wording matters: *consecutive*, so the
 * comparison is against the snapshot immediately prior rather than an
 * arbitrary earlier one — and *more than one full tier*, so S→A is movement
 * but not a meta shift.
 *
 * `isMetaShift` in tier-scoring.ts already encodes that rule for a single
 * pair. This module applies it across a whole snapshot and produces the
 * records the patch-history view and the notification outbox both read, so the
 * banner a player sees and the email they get describe the same event.
 *
 * _Requirements: 8.3, 8.4, 9.1_
 */
import type { CompTier, TierListEntry } from '@tft-codex/shared-types';

import { isMetaShift, trendFor } from './tier-scoring.js';

export interface SnapshotComparison {
  compId: string;
  name: string;
  from: CompTier;
  to: CompTier;
  trend: 'rising' | 'falling' | 'stable';
  /** R8.3 — moved more than one full tier. */
  metaShift: boolean;
}

export interface DiffResult {
  changed: SnapshotComparison[];
  metaShifts: SnapshotComparison[];
  /** Comps present now that were absent before. */
  added: { compId: string; name: string; tier: CompTier }[];
  /** Comps that dropped out of the list entirely. */
  removed: { compId: string; name: string; tier: CompTier }[];
}

/**
 * Diffs two snapshots.
 *
 * Added and removed comps are reported separately from tier changes rather
 * than being synthesised as movement from nowhere. A comp appearing for the
 * first time at C tier has not fallen to C — it has just crossed the sample
 * threshold, and reporting that as a fall would produce a stream of false meta
 * shifts every time the registry grows.
 */
export function diffSnapshots(
  previous: readonly TierListEntry[],
  current: readonly TierListEntry[],
): DiffResult {
  const before = new Map(previous.map((entry) => [entry.compId, entry]));
  const after = new Map(current.map((entry) => [entry.compId, entry]));

  const changed: SnapshotComparison[] = [];
  const metaShifts: SnapshotComparison[] = [];
  const added: DiffResult['added'] = [];

  for (const entry of current) {
    const prior = before.get(entry.compId);

    if (!prior) {
      added.push({ compId: entry.compId, name: entry.name, tier: entry.tier });
      continue;
    }
    if (prior.tier === entry.tier) continue;

    const comparison: SnapshotComparison = {
      compId: entry.compId,
      name: entry.name,
      from: prior.tier,
      to: entry.tier,
      trend: trendFor(prior.tier, entry.tier),
      metaShift: isMetaShift(prior.tier, entry.tier),
    };

    changed.push(comparison);
    if (comparison.metaShift) metaShifts.push(comparison);
  }

  const removed = previous
    .filter((entry) => !after.has(entry.compId))
    .map((entry) => ({ compId: entry.compId, name: entry.name, tier: entry.tier }));

  return { changed, metaShifts, added, removed };
}

/**
 * Human-readable copy for a tier change.
 *
 * Shared by the patch-history view and the notification body so a player who
 * sees both is not told two slightly different things about one event.
 */
export function describeChange(change: SnapshotComparison): string {
  if (change.from === 'provisional') {
    return `${change.name} has enough games now and enters at ${change.to} tier.`;
  }
  if (change.to === 'provisional') {
    return `${change.name} dropped below the sample threshold and is provisional again.`;
  }

  const direction = change.trend === 'rising' ? 'up' : 'down';
  return change.metaShift
    ? `${change.name} moved ${direction} from ${change.from} to ${change.to} — a bigger swing than a normal patch-to-patch shift.`
    : `${change.name} moved ${direction} from ${change.from} to ${change.to}.`;
}
