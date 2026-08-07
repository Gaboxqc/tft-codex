/**
 * Leveling and econ curve extraction and comparison (tasks 3.5, 3.6).
 *
 * A TFT round is identified as "stage-round" — "3-2" is stage 3, round 2.
 * Comparing two players' curves means comparing them *at the same round*, and
 * rounds are not evenly spaced in time: stage 1 has 3 rounds, every later
 * stage has 7. Comparing by index or by timestamp silently misaligns the two
 * curves and produces confident nonsense, which is why ordering goes through
 * `roundOrdinal` rather than being inferred.
 *
 * _Requirements: 4.3, 4.5, 15.2_
 */
import type { CurvePoint } from '@tft-codex/shared-types';

/** Rounds in stage 1. Every later stage has 7. */
const STAGE_ONE_ROUNDS = 3;
const ROUNDS_PER_STAGE = 7;

/**
 * A total ordering over round labels.
 *
 * Returns null for an unparseable label rather than guessing — a mislabelled
 * round that sorted to the wrong place would corrupt every comparison
 * downstream, and silently.
 */
export function roundOrdinal(round: string): number | null {
  const match = /^(\d+)-(\d+)$/.exec(round.trim());
  if (!match) return null;

  const stage = Number(match[1]);
  const index = Number(match[2]);
  if (stage < 1 || index < 1) return null;

  if (stage === 1) return index;
  return STAGE_ONE_ROUNDS + (stage - 2) * ROUNDS_PER_STAGE + index;
}

/** Sorts curve points into true round order, dropping unparseable labels. */
export function sortCurve(points: readonly CurvePoint[]): CurvePoint[] {
  return points
    .map((point) => ({ point, ordinal: roundOrdinal(point.round) }))
    .filter((entry): entry is { point: CurvePoint; ordinal: number } => entry.ordinal !== null)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((entry) => entry.point);
}

/**
 * Averages several players' curves into one baseline (R4.3).
 *
 * Averaged per round rather than per index: not every player reaches the same
 * final round, and a player eliminated at 4-3 must not drag the baseline's
 * late rounds down. A round is included only where data exists for it.
 */
export function averageCurves(curves: readonly (readonly CurvePoint[])[]): CurvePoint[] {
  const byRound = new Map<string, { sum: number; count: number }>();

  for (const curve of curves) {
    for (const point of curve) {
      if (roundOrdinal(point.round) === null) continue;
      const bucket = byRound.get(point.round) ?? { sum: 0, count: 0 };
      bucket.sum += point.value;
      bucket.count += 1;
      byRound.set(point.round, bucket);
    }
  }

  return sortCurve(
    [...byRound.entries()].map(([round, bucket]) => ({
      round,
      value: bucket.sum / bucket.count,
    })),
  );
}

export interface CurveDeviation {
  round: string;
  /** The player's value at this round. */
  actual: number;
  /** The baseline's value at the same round. */
  baseline: number;
  /** actual − baseline. Negative means behind. */
  delta: number;
}

/**
 * Pairs a player's curve against a baseline, round by round.
 *
 * Only rounds present in *both* are compared. A round the player never reached
 * is not a deviation of "minus everything" — they were eliminated, which the
 * placement already says. Reporting it as a curve deficit would double-count
 * the same fact and produce absurd advice ("you were 40 gold behind at 6-5").
 */
export function compareCurves(
  actual: readonly CurvePoint[],
  baseline: readonly CurvePoint[],
): CurveDeviation[] {
  const baselineByRound = new Map(baseline.map((point) => [point.round, point.value]));

  return sortCurve(actual)
    .filter((point) => baselineByRound.has(point.round))
    .map((point) => {
      const baselineValue = baselineByRound.get(point.round)!;
      return {
        round: point.round,
        actual: point.value,
        baseline: baselineValue,
        delta: point.value - baselineValue,
      };
    });
}

/**
 * The round where the player fell furthest behind the baseline (R15.2).
 *
 * "Furthest behind" is measured relative to the baseline's own magnitude, not
 * in absolute units. Being 6 gold behind at 2-1 (when the baseline is 12) is a
 * much bigger deal than 6 behind at 4-5 (when it is 60), and an absolute
 * comparison would always point at the late game where the numbers are simply
 * larger.
 *
 * Returns null when the player was never behind — that is a real outcome, and
 * inventing a "worst" moment for a clean game would be advice-shaped noise.
 */
export function biggestShortfall(deviations: readonly CurveDeviation[]): CurveDeviation | null {
  let worst: { deviation: CurveDeviation; severity: number } | null = null;

  for (const deviation of deviations) {
    if (deviation.delta >= 0) continue;
    const scale = Math.max(1, Math.abs(deviation.baseline));
    const severity = Math.abs(deviation.delta) / scale;
    if (!worst || severity > worst.severity) worst = { deviation, severity };
  }

  return worst?.deviation ?? null;
}

/**
 * The first round at which the player's level fell behind the baseline.
 *
 * Distinct from `biggestShortfall` on purpose: for leveling, *when you first
 * fell behind* is the actionable fact ("you hit 8 two turns late"), whereas
 * the largest gap usually appears several rounds later as a consequence.
 */
export function firstShortfall(
  deviations: readonly CurveDeviation[],
  minimumGap = 1,
): CurveDeviation | null {
  return deviations.find((deviation) => deviation.delta <= -minimumGap) ?? null;
}

/** The round at which the player first reached `target`, if they did. */
export function roundReaching(curve: readonly CurvePoint[], target: number): string | null {
  return sortCurve(curve).find((point) => point.value >= target)?.round ?? null;
}
