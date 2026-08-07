/**
 * The tier-scoring formula from design.md §3.
 *
 * R1.3 requires tiers come from "a documented composite score ... not an
 * editorially assigned label". This module is that document in executable
 * form: pure functions, no I/O, versioned, and published to users on
 * /methodology. review-and-roadmap.md §2 identifies this transparency as the
 * one thing no competitor does — so it is a product feature, not only a
 * compliance obligation.
 *
 *   score = (0.45 × top4_rate_norm) + (0.35 × avg_placement_norm)
 *         + (0.20 × play_rate_norm)
 *   tier  = S if score ≥ p90, A if ≥ p70, B if ≥ p45, C otherwise
 *
 * Thresholds are percentiles of the current patch's own distribution, not fixed
 * bars — a tier means "relative to what is being played right now", which is
 * the only reading that stays honest across a balance patch.
 *
 * _Requirements: 1.3, 1.4_
 */
import type { CompTier } from '@tft-codex/shared-types';

/**
 * Bump this whenever the weights, normalisation, or thresholds change.
 * It is stored on every published snapshot so a historical tier can be
 * explained by the formula that actually produced it, not today's.
 */
export const SCORING_FORMULA_VERSION = '1.0.0';

export const SCORING_WEIGHTS = {
  top4Rate: 0.45,
  avgPlacement: 0.35,
  playRate: 0.2,
} as const;

export const TIER_PERCENTILES = {
  S: 0.9,
  A: 0.7,
  B: 0.45,
} as const;

/** Raw counters for one comp, straight from the ClickHouse rollup. */
export interface CompCounters {
  compId: string;
  games: number;
  top4Count: number;
  winCount: number;
  placementSum: number;
}

export interface CompRates {
  compId: string;
  games: number;
  avgPlacement: number;
  top4Rate: number;
  winRate: number;
  playRate: number;
}

export interface ScoredComp extends CompRates {
  compositeScore: number;
  tier: CompTier;
  /** True when `games` is below the configured minimum for this patch (R1.4). */
  provisional: boolean;
}

/**
 * Converts counters to rates.
 *
 * `playRate` is a comp's share of all *participations*, not of matches — a TFT
 * match has 8 participants, so dividing by match count would produce rates
 * summing to 8 and a play-rate term that swamps the other two.
 */
export function toRates(counters: CompCounters, totalParticipations: number): CompRates {
  const games = counters.games;
  return {
    compId: counters.compId,
    games,
    avgPlacement: games === 0 ? 0 : counters.placementSum / games,
    top4Rate: games === 0 ? 0 : counters.top4Count / games,
    winRate: games === 0 ? 0 : counters.winCount / games,
    playRate: totalParticipations === 0 ? 0 : games / totalParticipations,
  };
}

/**
 * Min-max normalises a value into 0–1 against the population's own range.
 *
 * A degenerate range (every comp identical) returns 0.5 rather than dividing by
 * zero: with nothing to distinguish them, no comp deserves to be ranked above
 * another.
 */
export function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max === min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/**
 * The percentile of `sorted` at `fraction`, by linear interpolation.
 * `sorted` must be ascending.
 */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;

  const position = (sorted.length - 1) * Math.min(1, Math.max(0, fraction));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

/**
 * The composite score for one comp, given the patch's own min/max ranges.
 *
 * Average placement is inverted before normalising — placement 1 is the best
 * outcome and 8 the worst, so a raw min-max would rank the worst comps highest.
 */
export function compositeScore(
  rates: CompRates,
  ranges: {
    top4Rate: { min: number; max: number };
    avgPlacement: { min: number; max: number };
    playRate: { min: number; max: number };
  },
): number {
  const top4 = normalize(rates.top4Rate, ranges.top4Rate.min, ranges.top4Rate.max);
  // Inverted: lower placement is better.
  const placement =
    1 - normalize(rates.avgPlacement, ranges.avgPlacement.min, ranges.avgPlacement.max);
  const play = normalize(rates.playRate, ranges.playRate.min, ranges.playRate.max);

  return (
    SCORING_WEIGHTS.top4Rate * top4 +
    SCORING_WEIGHTS.avgPlacement * placement +
    SCORING_WEIGHTS.playRate * play
  );
}

export interface ScoreOptions {
  /** Comps below this game count are marked provisional instead of tiered (R1.4). */
  minSampleSize: number;
}

/**
 * Scores and tiers a whole patch's worth of comps.
 *
 * Provisional comps are excluded from the percentile calculation before tiers
 * are assigned. Including them would let a handful of 12-game outliers drag the
 * thresholds around, which is precisely the noise R1.4 exists to keep out of
 * the tier list.
 */
export function scoreComps(counters: readonly CompCounters[], options: ScoreOptions): ScoredComp[] {
  const totalParticipations = counters.reduce((sum, entry) => sum + entry.games, 0);
  const allRates = counters.map((entry) => toRates(entry, totalParticipations));

  const confident = allRates.filter((rates) => rates.games >= options.minSampleSize);
  // Nothing has enough data yet — everything is provisional and untiered.
  const basis = confident.length > 0 ? confident : [];

  const ranges = {
    top4Rate: rangeOf(basis.map((rates) => rates.top4Rate)),
    avgPlacement: rangeOf(basis.map((rates) => rates.avgPlacement)),
    playRate: rangeOf(basis.map((rates) => rates.playRate)),
  };

  const scored = allRates.map((rates) => ({
    rates,
    score: basis.length === 0 ? 0 : compositeScore(rates, ranges),
    provisional: rates.games < options.minSampleSize,
  }));

  const confidentScores = scored
    .filter((entry) => !entry.provisional)
    .map((entry) => entry.score)
    .sort((a, b) => a - b);

  const thresholds = {
    S: percentile(confidentScores, TIER_PERCENTILES.S),
    A: percentile(confidentScores, TIER_PERCENTILES.A),
    B: percentile(confidentScores, TIER_PERCENTILES.B),
  };

  return scored.map((entry) => ({
    ...entry.rates,
    compositeScore: entry.score,
    provisional: entry.provisional,
    tier: entry.provisional ? 'provisional' : tierFor(entry.score, thresholds),
  }));
}

function tierFor(score: number, thresholds: { S: number; A: number; B: number }): CompTier {
  if (score >= thresholds.S) return 'S';
  if (score >= thresholds.A) return 'A';
  if (score >= thresholds.B) return 'B';
  return 'C';
}

function rangeOf(values: readonly number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Compares two consecutive snapshots and flags comps that moved more than one
 * full tier (R8.3).
 *
 * Movement to or from `provisional` is not a meta shift — it means the sample
 * size crossed a threshold, which says nothing about whether the comp got
 * better or worse.
 */
const TIER_ORDER: Record<Exclude<CompTier, 'provisional'>, number> = { S: 0, A: 1, B: 2, C: 3 };

export function isMetaShift(previous: CompTier, current: CompTier): boolean {
  if (previous === 'provisional' || current === 'provisional') return false;
  return Math.abs(TIER_ORDER[previous] - TIER_ORDER[current]) > 1;
}

/**
 * The trend arrow shown on the tier list. Any movement counts, unlike
 * `isMetaShift`, which needs more than one full tier.
 */
export function trendFor(
  previous: CompTier | undefined,
  current: CompTier,
): 'rising' | 'falling' | 'stable' {
  if (!previous || previous === 'provisional' || current === 'provisional') return 'stable';
  const delta = TIER_ORDER[previous] - TIER_ORDER[current];
  if (delta > 0) return 'rising';
  if (delta < 0) return 'falling';
  return 'stable';
}
