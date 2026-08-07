/**
 * The recommendation engine (tasks 2.8, 2.13; design.md §8).
 *
 * Two Riot restrictions apply here and they are NOT the same rule:
 *
 *   R3.1 — never expose augment win rate or average placement.
 *   R3.7 — never serve board-state-reactive, real-time prescriptions without
 *          written Riot confirmation on file.
 *
 * §7 handles the first. This module handles the second, by splitting the engine
 * into two modes with genuinely different *inputs*:
 *
 * **Tier-2 (default, ships today).** Input: the augment options actually
 * offered this round. It ranks them against static, precomputed patch-level
 * data. It is a filter over a lookup table by the options presented — not a
 * function of the player's board. Comp matching in this mode uses the board
 * state at the instant the user opened or refreshed the panel: a snapshot, not
 * a stream.
 *
 * **Tier-3 (gated).** Input: live board, bench and gold, continuously. This is
 * the mode Riot's policy language describes, and it stays off until the
 * confirmation flag is set (docs/approvals.md).
 *
 * The distinction is enforced by what each function is *allowed to read*, not
 * by a conditional inside one function — `recommendTier2` does not accept board
 * state at all. A future engineer cannot accidentally make Tier-2 reactive
 * because there is nothing reactive in scope.
 *
 * _Requirements: 3.4, 3.5, 3.7, 5.4, 5.5_
 */
import type {
  AugmentAdvice,
  RecommendationMode,
  RecommendationResponse,
  SuggestedComp,
} from '@tft-codex/shared-types';

import type { AugmentCounters } from './augment-tiering.js';
import { rankOfferedAugments } from './augment-tiering.js';
import { reasonFor, signalFor } from './augment-reasons.js';

/** Static augment metadata needed to describe fit, with no outcome data. */
export interface AugmentDescriptor {
  id: string;
  name: string;
  category?: 'combat' | 'econ' | 'item' | 'trait' | 'utility' | undefined;
  /** Trait ids this augment reinforces. */
  relatedTraits?: string[] | undefined;
  /** Champion ids this augment is built around. */
  relatedCarries?: string[] | undefined;
  /** Traits the board must already have for this to do anything. */
  requiresTraits?: string[] | undefined;
}

export interface CompShape {
  compId: string;
  name: string;
  /** Core unit champion ids. */
  units: string[];
  coreTraits: string[];
  /** Rank in the current tier list, 0 = best. Used only to break score ties. */
  tierRank: number;
}

// ── Tier-2 ───────────────────────────────────────────────────────────────────

export interface Tier2Input {
  /**
   * The three options the player was offered. This is the ONLY player-derived
   * input Tier-2 accepts, and it is the option set, not the board state.
   */
  offeredAugmentIds: readonly string[];
  /** Descriptors for the offered options. */
  descriptors: ReadonlyMap<string, AugmentDescriptor>;
  /** Precomputed patch-level counters. Server-side only. */
  counters: readonly AugmentCounters[];
  /**
   * Optional comp the player has told us they are playing — chosen from a
   * list, not inferred from their board. Scoping to a comp is still a static
   * lookup, so it stays inside Tier-2.
   */
  compId?: string | null;
  compName?: string | null;
}

/**
 * Ranks the offered augments against static data.
 *
 * Note the absence of a `boardUnits` parameter. That is the compliance
 * boundary, expressed as a function signature.
 */
export function recommendTier2(input: Tier2Input): AugmentAdvice[] {
  const ranked = rankOfferedAugments(input.offeredAugmentIds, input.counters, {
    compId: input.compId ?? null,
  });

  return ranked.map((entry, index) => {
    const descriptor = input.descriptors.get(entry.augmentId);
    const signal = signalFor({
      matchingTraits: [],
      carryOnBoard: false,
      category: descriptor?.category,
      // No board context by construction in this mode — the reason describes
      // the augment, not the player's situation.
      contextless: true,
      missingRequirements: false,
    });

    return {
      augmentId: entry.augmentId,
      rank: index + 1,
      reason: reasonFor(
        {
          signal,
          ...(input.compName ? { compName: input.compName } : {}),
        },
        hashOf(entry.augmentId),
      ),
    };
  });
}

// ── Tier-3 ───────────────────────────────────────────────────────────────────

export interface Tier3Input extends Tier2Input {
  /** Live board and bench. Only reachable when the confirmation flag is set. */
  boardUnits: readonly string[];
  goldAvailable: number;
  level: number;
}

/**
 * Board-reactive ranking. **Never call this without checking the deployment's
 * Riot-confirmation flag** — `resolveMode` below is the only sanctioned way to
 * decide whether it may run.
 */
export function recommendTier3(input: Tier3Input): AugmentAdvice[] {
  const onBoard = new Set(input.boardUnits);
  const ranked = rankOfferedAugments(input.offeredAugmentIds, input.counters, {
    compId: input.compId ?? null,
  });

  return ranked.map((entry, index) => {
    const descriptor = input.descriptors.get(entry.augmentId);
    const matchingTraits = (descriptor?.relatedTraits ?? []).filter((trait) =>
      input.boardUnits.some((unit) => unit.includes(trait)),
    );
    const carry = (descriptor?.relatedCarries ?? []).find((id) => onBoard.has(id));

    const signal = signalFor({
      matchingTraits,
      carryOnBoard: Boolean(carry),
      category: descriptor?.category,
      contextless: false,
      missingRequirements:
        (descriptor?.requiresTraits ?? []).length > 0 && matchingTraits.length === 0,
    });

    return {
      augmentId: entry.augmentId,
      rank: index + 1,
      reason: reasonFor(
        {
          signal,
          ...(matchingTraits[0] ? { traitName: prettify(matchingTraits[0]) } : {}),
          ...(carry ? { carryName: prettify(carry) } : {}),
          ...(input.compName ? { compName: input.compName } : {}),
        },
        hashOf(entry.augmentId),
      ),
    };
  });
}

// ── Comp matching ────────────────────────────────────────────────────────────

/**
 * Scores a board against tracked comps (design.md §8).
 *
 * Used by both modes, with a critical difference in *when*: Tier-2 calls it
 * once, on the board state at the moment the user opened the panel; Tier-3
 * calls it continuously as state changes. Same maths, different cadence — and
 * the cadence is the thing Riot's policy restricts.
 */
export function matchComps(
  boardUnits: readonly string[],
  comps: readonly CompShape[],
  limit = 3,
): SuggestedComp[] {
  const onBoard = new Set(boardUnits);

  return comps
    .map((comp) => {
      const present = comp.units.filter((unit) => onBoard.has(unit));
      const missingUnits = comp.units.filter((unit) => !onBoard.has(unit));
      return {
        compId: comp.compId,
        matchScore: comp.units.length === 0 ? 0 : present.length / comp.units.length,
        missingUnits,
        tierRank: comp.tierRank,
      };
    })
    .filter((entry) => entry.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore || a.tierRank - b.tierRank)
    .slice(0, limit)
    .map(({ compId, matchScore, missingUnits }) => ({ compId, matchScore, missingUnits }));
}

// ── The gate ─────────────────────────────────────────────────────────────────

export interface ModeDecision {
  served: RecommendationMode;
  /** True when a Tier-3 request was silently downgraded. */
  downgraded: boolean;
}

/**
 * Decides which mode actually runs.
 *
 * This is the server-side kill switch from design.md §5. A client asking for
 * `tier3-adaptive` gets `tier2-lookup` unless the deployment holds written
 * Riot confirmation. It downgrades rather than erroring so the Overwolf app
 * stays useful either way — `modeServed` on the response tells the client what
 * it actually got, so it can label the UI honestly (design.md §9).
 *
 * Every path into Tier-3 must go through this function.
 */
export function resolveMode(requested: RecommendationMode, tier3Confirmed: boolean): ModeDecision {
  if (requested === 'tier3-adaptive' && !tier3Confirmed) {
    return { served: 'tier2-lookup', downgraded: true };
  }
  return { served: requested, downgraded: false };
}

export interface RecommendInput {
  requestedMode: RecommendationMode;
  tier3Confirmed: boolean;
  offeredAugmentIds?: readonly string[] | undefined;
  descriptors: ReadonlyMap<string, AugmentDescriptor>;
  counters: readonly AugmentCounters[];
  boardUnits: readonly string[];
  goldAvailable: number;
  level: number;
  comps: readonly CompShape[];
  compId?: string | null;
  compName?: string | null;
}

/**
 * The single entry point. Resolves the mode, then runs only what that mode
 * permits.
 *
 * `contextAware` is false whenever Tier-2 was served, including a downgrade —
 * R3.5 uses it to mean "this recommendation did not consider your situation",
 * and in Tier-2 it genuinely did not.
 */
export function recommend(input: RecommendInput): RecommendationResponse {
  const decision = resolveMode(input.requestedMode, input.tier3Confirmed);
  const tier3 = decision.served === 'tier3-adaptive';

  const suggestedComps = matchComps(input.boardUnits, input.comps);

  let augmentAdvice: AugmentAdvice[] | undefined;
  if (input.offeredAugmentIds && input.offeredAugmentIds.length > 0) {
    const shared = {
      offeredAugmentIds: input.offeredAugmentIds,
      descriptors: input.descriptors,
      counters: input.counters,
      compId: input.compId ?? null,
      compName: input.compName ?? null,
    };

    augmentAdvice = tier3
      ? recommendTier3({
          ...shared,
          boardUnits: input.boardUnits,
          goldAvailable: input.goldAvailable,
          level: input.level,
        })
      : recommendTier2(shared);
  }

  return {
    suggestedComps,
    ...(augmentAdvice ? { augmentAdvice } : {}),
    // False in Tier-2 by definition, not just on the R3.5 fallback path.
    contextAware: tier3 && input.boardUnits.length > 0,
    modeServed: decision.served,
  };
}

/** Stable per-augment seed so phrasing doesn't churn between identical requests. */
function hashOf(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

/** "TFT17_Vanguard" -> "Vanguard". Display only. */
function prettify(id: string): string {
  return id.replace(/^TFT\d*_/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}
