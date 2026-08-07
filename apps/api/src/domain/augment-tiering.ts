/**
 * Augment tiering (task 2.3) — the "compute it, never show it" half of R3.1.
 *
 * The scoring path here is deliberately NOT the comp path from tier-scoring.ts,
 * even though both produce S/A/B/C. Two reasons:
 *
 * 1. Comps publish their composite score; augments must not. The comp formula
 *    is a product feature we show on /methodology. Publishing an augment's
 *    score would be a thinly-veiled win rate — a monotonic function of the two
 *    numbers R3.1 forbids, which anyone could invert. So this function returns
 *    a letter and nothing else.
 * 2. Augments have no play-rate term in their score. An augment's pick rate
 *    reflects what players believe, not what performs, and folding it into the
 *    ranking would make popular augments self-reinforcing.
 *
 * Everything in this module runs server-side against `augment_internal_stats`,
 * a table the API gateway's credentials cannot read (design.md §7 step 1).
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.6_
 */
import type { Tier } from '@tft-codex/shared-types';

import { normalize, percentile } from './tier-scoring.js';

/** Bump when weights or thresholds change. Never exposed to clients. */
export const AUGMENT_SCORING_VERSION = '1.0.0';

/**
 * Weights for the internal ranking. Deliberately different from the comp
 * formula — see the module comment.
 */
export const AUGMENT_SCORING_WEIGHTS = {
  top4Rate: 0.5,
  avgPlacement: 0.5,
} as const;

export const AUGMENT_TIER_PERCENTILES = { S: 0.85, A: 0.65, B: 0.4 } as const;

/** Raw counters from `augment_internal_stats`. Server-side only. */
export interface AugmentCounters {
  augmentId: string;
  /** null/'' = global rather than scoped to a comp. */
  compId: string | null;
  games: number;
  top4Count: number;
  winCount: number;
  placementSum: number;
}

/**
 * The public record. Note the shape: a letter, a pick rate, and nothing that
 * could be inverted back into placement or win rate.
 */
export interface PublicAugmentTier {
  augmentId: string;
  tier: Tier;
  /** Pick frequency, 0–1. Permitted by R3.3. */
  playRate: number;
  /** True when sample size is too thin to tier confidently. */
  provisional: boolean;
}

/**
 * Server-side ranking output. Never serialized — it exists so the
 * recommendation engine can order options and then describe them
 * qualitatively (design.md §7 step 3).
 */
export interface InternalAugmentRank {
  augmentId: string;
  compId: string | null;
  /** Internal only. Serializing this would be an R3.1 violation. */
  score: number;
  games: number;
}

export interface AugmentTieringOptions {
  /** Below this many picks, an augment is provisional rather than tiered. */
  minSampleSize: number;
  /** Total augment picks on the patch, for play-rate denominators. */
  totalPicks: number;
}

/**
 * Internal score for one augment. Higher is better.
 *
 * Exported for unit testing the ordering, NOT for use in a response path.
 * If you are reaching for this from anything that serializes, stop — the
 * qualitative reason bank is what belongs in a response.
 */
export function internalScore(
  counters: AugmentCounters,
  ranges: { top4Rate: { min: number; max: number }; avgPlacement: { min: number; max: number } },
): number {
  if (counters.games === 0) return 0;

  const top4Rate = counters.top4Count / counters.games;
  const avgPlacement = counters.placementSum / counters.games;

  return (
    AUGMENT_SCORING_WEIGHTS.top4Rate *
      normalize(top4Rate, ranges.top4Rate.min, ranges.top4Rate.max) +
    // Inverted: placement 1 is the best outcome.
    AUGMENT_SCORING_WEIGHTS.avgPlacement *
      (1 - normalize(avgPlacement, ranges.avgPlacement.min, ranges.avgPlacement.max))
  );
}

/**
 * Tiers every augment on a patch, returning ONLY the public record.
 *
 * The scores are computed, used to rank, and discarded. That is the design:
 * the caller has no way to leak a number it was never handed.
 */
export function tierAugments(
  counters: readonly AugmentCounters[],
  options: AugmentTieringOptions,
): PublicAugmentTier[] {
  // Global rows only — per-comp rows exist for the recommendation engine and
  // must not influence the global tier list.
  const global = counters.filter((entry) => !entry.compId);

  const confident = global.filter((entry) => entry.games >= options.minSampleSize);
  const ranges = {
    top4Rate: rangeOf(confident.map((entry) => entry.top4Count / Math.max(1, entry.games))),
    avgPlacement: rangeOf(confident.map((entry) => entry.placementSum / Math.max(1, entry.games))),
  };

  const scored = global.map((entry) => ({
    entry,
    score: confident.length === 0 ? 0 : internalScore(entry, ranges),
    provisional: entry.games < options.minSampleSize,
  }));

  const confidentScores = scored
    .filter((item) => !item.provisional)
    .map((item) => item.score)
    .sort((a, b) => a - b);

  const thresholds = {
    S: percentile(confidentScores, AUGMENT_TIER_PERCENTILES.S),
    A: percentile(confidentScores, AUGMENT_TIER_PERCENTILES.A),
    B: percentile(confidentScores, AUGMENT_TIER_PERCENTILES.B),
  };

  return scored.map((item) => ({
    augmentId: item.entry.augmentId,
    // A provisional augment still gets a letter, unlike a provisional comp.
    // R3.2 asks for a categorical tier or a qualitative recommendation with no
    // exception for thin samples, and an augment with no grade at all is worse
    // than a cautious one — the player has to choose something this round. The
    // `provisional` flag lets the UI hedge the presentation.
    tier: tierFor(item.score, thresholds),
    playRate: options.totalPicks === 0 ? 0 : item.entry.games / options.totalPicks,
    provisional: item.provisional,
  }));
}

/**
 * Ranks a specific set of offered augments, best first. Server-side only.
 *
 * This is the Tier-2 ordering primitive: it takes the options the player was
 * actually offered and orders them against precomputed patch-level data. It
 * does not read board state — that distinction is the whole of R3.7.
 */
export function rankOfferedAugments(
  offeredIds: readonly string[],
  counters: readonly AugmentCounters[],
  options: { compId?: string | null } = {},
): InternalAugmentRank[] {
  const scopeId = options.compId ?? null;

  const relevant = counters.filter((entry) => {
    if (!offeredIds.includes(entry.augmentId)) return false;
    return scopeId ? entry.compId === scopeId || !entry.compId : !entry.compId;
  });

  const ranges = {
    top4Rate: rangeOf(relevant.map((entry) => entry.top4Count / Math.max(1, entry.games))),
    avgPlacement: rangeOf(relevant.map((entry) => entry.placementSum / Math.max(1, entry.games))),
  };

  // Prefer a comp-scoped row when one exists — "good in this comp" is a better
  // signal than "good overall" — falling back to global otherwise.
  const byAugment = new Map<string, AugmentCounters>();
  for (const entry of relevant) {
    const existing = byAugment.get(entry.augmentId);
    if (!existing || (scopeId && entry.compId === scopeId)) {
      byAugment.set(entry.augmentId, entry);
    }
  }

  return offeredIds
    .map((augmentId) => {
      const entry = byAugment.get(augmentId);
      return {
        augmentId,
        compId: entry?.compId ?? null,
        score: entry ? internalScore(entry, ranges) : 0,
        games: entry?.games ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function tierFor(score: number, thresholds: { S: number; A: number; B: number }): Tier {
  if (score >= thresholds.S) return 'S';
  if (score >= thresholds.A) return 'A';
  if (score >= thresholds.B) return 'B';
  return 'C';
}

function rangeOf(values: readonly number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(...values), max: Math.max(...values) };
}
