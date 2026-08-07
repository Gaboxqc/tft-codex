/**
 * Comp detection: given a participant's final board, which tracked comp were
 * they playing?
 *
 * This function is load-bearing twice over — it assigns every ingested match to
 * a comp for the tier list (R1.3), and it labels a linked user's own matches
 * for personal analytics (R4.2). A sloppy match here quietly corrupts both.
 *
 * The algorithm is rules-based against a manually seeded signature registry
 * (design.md §3 step 2). That is deliberate: a clustering pass alone would
 * happily invent comps that no player would recognise, and R1.3 requires tiers
 * be defensible. Unmatched boards return `null` and feed the new-comp editorial
 * queue rather than being force-fitted to the nearest signature.
 *
 * _Requirements: 1.3, 4.2_
 */
import type { CompSignature } from '@tft-codex/shared-types';

/** A participant's final board, reduced to what detection actually needs. */
export interface BoardState {
  /** Active traits and the number of units contributing to each. */
  traitCounts: Record<string, number>;
  /** Champion ids on the final board. */
  championIds: string[];
  /**
   * Star level per champion, used only to break ties between signatures that
   * are otherwise equally good — a 3-star unit is much stronger evidence of
   * intent than a 1-star of the same champion.
   */
  starLevels?: Record<string, number>;
}

export interface CompMatch {
  compId: string;
  /**
   * 0–1. How completely the board satisfies the signature: trait requirements
   * met, weighted by how far past each minimum it went, plus carry presence.
   */
  score: number;
}

/**
 * How much of the score comes from carries versus traits.
 *
 * Carries are weighted heavily because they are what actually distinguishes two
 * comps sharing a trait core — "Vanguard Zoe" and "Vanguard Jinx" have
 * identical trait signatures and completely different game plans. Getting this
 * backwards produces a tier list that looks plausible and is wrong.
 */
const CARRY_WEIGHT = 0.5;
const TRAIT_WEIGHT = 0.5;

/** Below this, we say "no confident match" rather than guessing. */
export const MIN_CONFIDENT_SCORE = 0.6;

/**
 * Scores one signature against a board. Returns null when a hard requirement
 * is unmet — a signature whose core traits are absent is not a weak match, it
 * is not a match.
 */
export function scoreSignature(board: BoardState, signature: CompSignature): number | null {
  const requirements = Object.entries(signature.minTraitCounts);

  // Every core trait must be present at or above its minimum. A board running
  // 2 Vanguard is not a dilute version of a 6-Vanguard comp; it is a different
  // comp.
  let traitSurplus = 0;
  for (const [traitId, minimum] of requirements) {
    const actual = board.traitCounts[traitId] ?? 0;
    if (actual < minimum) return null;
    // Credit for exceeding the minimum, capped so a single deep trait cannot
    // dominate the score.
    traitSurplus += Math.min(1, (actual - minimum) / Math.max(1, minimum));
  }

  const traitScore =
    requirements.length === 0 ? 0 : 0.75 + 0.25 * (traitSurplus / requirements.length);

  const onBoard = new Set(board.championIds);
  const carriesPresent = signature.carryChampionIds.filter((id) => onBoard.has(id));

  // At least one designated carry must be on the board. Without this, every
  // trait-sharing comp collapses into whichever signature was checked first.
  if (carriesPresent.length === 0) return null;

  const carryRatio = carriesPresent.length / signature.carryChampionIds.length;

  // A starred-up carry is strong evidence of intent; a 1-star may just be a
  // unit they happened to hold. Small bonus, deliberately not decisive.
  const starBonus = board.starLevels
    ? Math.min(
        0.1,
        carriesPresent.reduce(
          (sum, id) => sum + Math.max(0, ((board.starLevels?.[id] ?? 1) - 1) * 0.05),
          0,
        ),
      )
    : 0;

  return Math.min(1, TRAIT_WEIGHT * traitScore + CARRY_WEIGHT * carryRatio + starBonus);
}

/**
 * Returns the best-matching comp id, or null when nothing clears the
 * confidence floor.
 *
 * Ties are broken by signature specificity (more trait requirements = more
 * specific), so a narrow signature wins over a broad one that happens to score
 * the same — otherwise generic comps would swallow their own specialisations.
 */
export function detectComp(
  board: BoardState,
  signatures: readonly CompSignature[],
): CompMatch | null {
  let best: (CompMatch & { specificity: number }) | null = null;

  for (const signature of signatures) {
    const score = scoreSignature(board, signature);
    if (score === null || score < MIN_CONFIDENT_SCORE) continue;

    const specificity = Object.keys(signature.minTraitCounts).length;
    if (!best || score > best.score || (score === best.score && specificity > best.specificity)) {
      best = { compId: signature.compId, score, specificity };
    }
  }

  return best ? { compId: best.compId, score: best.score } : null;
}

/**
 * Builds a `BoardState` from a Riot match participant.
 *
 * Riot reports `tier_current` (the breakpoint level reached) alongside
 * `num_units`. We key on `num_units` because signatures are written in terms of
 * unit counts, which is how players actually talk about comps — "6 Vanguard",
 * not "Vanguard tier 3".
 */
export function boardFromParticipant(participant: {
  traits: { name: string; num_units: number; tier_current: number }[];
  units: { character_id: string; tier: number }[];
}): BoardState {
  const traitCounts: Record<string, number> = {};
  for (const trait of participant.traits) {
    // tier_current === 0 means the trait is on the board but inactive — no
    // breakpoint hit. Counting those would match comps the player never had.
    if (trait.tier_current > 0) traitCounts[trait.name] = trait.num_units;
  }

  const starLevels: Record<string, number> = {};
  for (const unit of participant.units) {
    starLevels[unit.character_id] = Math.max(starLevels[unit.character_id] ?? 0, unit.tier);
  }

  return {
    traitCounts,
    championIds: participant.units.map((unit) => unit.character_id),
    starLevels,
  };
}
