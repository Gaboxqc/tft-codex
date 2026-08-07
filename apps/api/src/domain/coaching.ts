/**
 * Improvement suggestions and the post-game coaching narrative (tasks 3.7, 3.15).
 *
 * `review-and-roadmap.md` §2 identifies coaching depth as the single biggest
 * differentiation opportunity in this product — every competitor stops at
 * "here is your curve versus average". So the bar here is not "produce text";
 * it is to name the specific turn where the game turned and say what to do
 * differently, which is what R15.2 asks for.
 *
 * Three constraints shape everything below:
 *
 * 1. **Post-game only** (R15.3). Nothing in this module runs mid-match. Riot's
 *    policy explicitly encourages post-game analysis and explicitly restricts
 *    live prescription; keeping the two in separate modules with separate
 *    inputs is what makes that easy to demonstrate rather than argue.
 * 2. **No augment win rates or placements** (R3.1), and no placement broken
 *    down by augment picked even for the user's own data (R4.7) — that is
 *    gated on task 3.12 and Riot's written answer. The `augment-fit` signal
 *    below therefore talks about *board fit*, never outcome.
 * 3. **Specific, not generic** (R4.5). "Play better" is not a suggestion. Every
 *    template names a round or a concrete quantity from the player's own game.
 *
 * _Requirements: 3.1, 4.5, 4.7, 15.1, 15.2, 15.3_
 */
import type { CurvePoint, ImprovementSuggestion } from '@tft-codex/shared-types';

import {
  biggestShortfall,
  compareCurves,
  firstShortfall,
  roundReaching,
  type CurveDeviation,
} from './curves.js';

export interface MatchReviewInput {
  placement: number;
  /** The comp we detected, for naming it in the copy. Null when unmatched. */
  compName: string | null;
  levelCurve: readonly CurvePoint[];
  goldCurve: readonly CurvePoint[];
  /** Averaged curves of top-4 finishers who ran the same comp (R4.3). */
  baselineLevelCurve: readonly CurvePoint[];
  baselineGoldCurve: readonly CurvePoint[];
  /** Completed items on the final board, for the itemisation signal. */
  completedItemCount?: number;
  /** How many the comp's guide expects by the end. */
  expectedItemCount?: number;
}

export interface MatchReview {
  suggestions: ImprovementSuggestion[];
  /** The round of the biggest deviation from baseline (R15.2). */
  keyDeviationRound: string | null;
  levelDeviations: CurveDeviation[];
  goldDeviations: CurveDeviation[];
}

/** Gold this far below baseline at a round is worth calling out. */
const GOLD_DEVIATION_THRESHOLD = 12;
/** A level gap of this much is a real tempo difference, not noise. */
const LEVEL_DEVIATION_THRESHOLD = 1;

/**
 * Produces at least one concrete suggestion per reviewed match (R4.5).
 *
 * Returns them ordered by how much they likely mattered, so a UI showing only
 * the first still shows the most useful one.
 */
export function reviewMatch(input: MatchReviewInput): MatchReview {
  const levelDeviations = compareCurves(input.levelCurve, input.baselineLevelCurve);
  const goldDeviations = compareCurves(input.goldCurve, input.baselineGoldCurve);

  const suggestions: ImprovementSuggestion[] = [];

  // ── Leveling timing ──────────────────────────────────────────────────────
  // The FIRST round behind is the actionable fact — the largest gap usually
  // shows up several rounds later as a consequence of that same decision.
  const levelSlip = firstShortfall(levelDeviations, LEVEL_DEVIATION_THRESHOLD);
  if (levelSlip) {
    const reachedEight = roundReaching(input.levelCurve, 8);
    const baselineEight = roundReaching(input.baselineLevelCurve, 8);

    suggestions.push({
      signal: 'leveling-timing',
      round: levelSlip.round,
      message:
        reachedEight && baselineEight && reachedEight !== baselineEight
          ? `You reached level 8 at ${reachedEight}; top-4 finishers on this comp got there at ${baselineEight}. ` +
            `The gap opens at ${levelSlip.round} — that is the turn to spend on XP rather than rolling.`
          : `You were ${formatGap(levelSlip.delta)} level behind the top-4 baseline from ${levelSlip.round} onward. ` +
            'Buying XP a turn earlier there usually costs less than the tempo it buys back.',
    });
  }

  // ── Econ ─────────────────────────────────────────────────────────────────
  const goldSlip = biggestShortfall(goldDeviations);
  if (goldSlip && Math.abs(goldSlip.delta) >= GOLD_DEVIATION_THRESHOLD) {
    suggestions.push({
      signal: 'econ-deviation',
      round: goldSlip.round,
      message:
        `Your gold dropped to ${Math.round(goldSlip.actual)} at ${goldSlip.round}, against ` +
        `${Math.round(goldSlip.baseline)} for top-4 finishers on this comp. ` +
        'Breaking interest that early usually costs more than the board strength it buys.',
    });
  }

  // ── Itemisation ──────────────────────────────────────────────────────────
  if (
    input.completedItemCount !== undefined &&
    input.expectedItemCount !== undefined &&
    input.completedItemCount < input.expectedItemCount
  ) {
    const short = input.expectedItemCount - input.completedItemCount;
    suggestions.push({
      signal: 'itemization-completeness',
      round: null,
      message:
        `You finished with ${input.completedItemCount} completed item${input.completedItemCount === 1 ? '' : 's'} ` +
        `where this comp wants ${input.expectedItemCount}. Slamming ${short} component pair${short === 1 ? '' : 's'} ` +
        'earlier is usually better than holding for a perfect build you never complete.',
    });
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  // R4.5 requires at least one suggestion per reviewed match. A clean game
  // still deserves a useful sentence rather than an empty panel — but it must
  // be honest that nothing went obviously wrong, not invent a fault.
  if (suggestions.length === 0) {
    suggestions.push({
      signal: 'positioning',
      round: null,
      message:
        input.placement <= 4
          ? 'Your leveling and econ tracked the top-4 baseline closely — at this point positioning ' +
            'and item choice are where the remaining placements come from, not curve discipline.'
          : 'Your curves matched the top-4 baseline, so the placement did not come from leveling or ' +
            'econ. Look at positioning and the strength of the boards you faced.',
    });
  }

  const keyDeviation = pickKeyDeviation(levelSlip, goldSlip);

  return {
    suggestions,
    keyDeviationRound: keyDeviation,
    levelDeviations,
    goldDeviations,
  };
}

/** R15.1's ceiling. The narrative is assembled to fit it, not trimmed to it. */
export const NARRATIVE_MAX_SENTENCES = 5;

/**
 * Splits prose into sentences.
 *
 * Suggestion messages are deliberately allowed to be two sentences — they are
 * rendered on their own in the stat view, where the extra clause earns its
 * place. The narrative has a tighter budget, so it counts them properly rather
 * than assuming one message is one sentence.
 */
function toSentences(text: string): string[] {
  return text
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Builds the 3–5 sentence narrative (R15.1).
 *
 * Composed from the same signals as `reviewMatch` rather than from raw numbers
 * (R15.1 is explicit about that), so the prose and the stat view can never
 * disagree — they are two renderings of one analysis.
 *
 * The sentence budget is enforced by construction. The opening and closing are
 * the frame and always survive; the middle is filled with as much of the
 * analysis as fits. Assembling first and truncating afterwards would risk
 * cutting a sentence in half, or dropping the round citation R15.2 requires.
 */
export function buildNarrative(input: MatchReviewInput, review: MatchReview): string {
  const compLabel = input.compName ? `on ${input.compName}` : 'on an untracked board';
  const opening =
    input.placement === 1
      ? `You won this one ${compLabel}.`
      : `You finished ${ordinal(input.placement)} ${compLabel}.`;

  const closing =
    input.placement <= 4
      ? 'Worth repeating what worked here — the shape of the game was right.'
      : 'One change at a time next game; the curve is easier to fix than the read.';

  // Everything the middle could say, in priority order. R15.2's round citation
  // lives in the first suggestion, so it is first in line for the budget.
  const candidates = review.keyDeviationRound
    ? review.suggestions.flatMap((suggestion) => toSentences(suggestion.message))
    : toSentences(
        'Your leveling and econ curves tracked the top-4 baseline for this comp throughout.',
      );

  const middleBudget = NARRATIVE_MAX_SENTENCES - 2;
  const middle = candidates.slice(0, Math.max(1, middleBudget));

  return [opening, ...middle, closing].join(' ');
}

/**
 * Which deviation to headline.
 *
 * Leveling wins ties: it is upstream of econ. Falling behind on level often
 * *causes* the gold dip that follows, and pointing at the symptom instead of
 * the cause is the most common way coaching advice becomes useless.
 */
function pickKeyDeviation(
  levelSlip: CurveDeviation | null,
  goldSlip: CurveDeviation | null,
): string | null {
  if (levelSlip) return levelSlip.round;
  if (goldSlip && Math.abs(goldSlip.delta) >= GOLD_DEVIATION_THRESHOLD) return goldSlip.round;
  return null;
}

function formatGap(delta: number): string {
  const magnitude = Math.abs(delta);
  return magnitude === 1 ? 'a level' : `${magnitude.toFixed(magnitude % 1 === 0 ? 0 : 1)} levels`;
}

function ordinal(placement: number): string {
  const suffix = placement === 1 ? 'st' : placement === 2 ? 'nd' : placement === 3 ? 'rd' : 'th';
  return `${placement}${suffix}`;
}
