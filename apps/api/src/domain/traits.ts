/**
 * Trait counting and breakpoints (task 4.2).
 *
 * This is the piece the builder lives or dies on: a player editing a board
 * watches the trait panel more than anything else on the screen, and a count
 * that is wrong by one is worse than no panel at all.
 *
 * Two rules that are easy to get wrong and are the whole substance here:
 *
 * 1. **A champion counts once per trait, however many copies are on the
 *    board.** Two Leonas do not give 2 Vanguard. Every TFT player knows this;
 *    a builder that got it wrong would be discarded in about ten seconds.
 * 2. **Emblems add a trait to a unit that does not natively have it**, and
 *    they *do* stack with the unit's own traits. An emblem on a unit that
 *    already has the trait adds nothing.
 *
 * _Requirements: 6.1, 6.2_
 */
import type { Trait } from '@tft-codex/shared-types';

/** A unit placed on the builder board. */
export interface BoardUnit {
  championId: string;
  /** Item ids held by this unit. Emblems among them grant traits. */
  itemIds?: string[];
  starLevel?: 1 | 2 | 3;
}

/** What the caller needs to know to resolve traits for a board. */
export interface TraitContext {
  /** Champion id → its native trait ids. */
  traitsByChampion: ReadonlyMap<string, readonly string[]>;
  /** Trait definitions, for breakpoints and display names. */
  traits: ReadonlyMap<string, Trait>;
  /** Item id → the trait id it grants, for emblems. */
  emblemGrants?: ReadonlyMap<string, string>;
}

export interface ActiveTrait {
  traitId: string;
  name: string;
  /** Distinct champions contributing. */
  count: number;
  /**
   * The highest breakpoint reached, or null when below the first one.
   * A trait below its first breakpoint is inactive — it still shows in the
   * panel (players need to see progress) but grants nothing.
   */
  activeBreakpoint: number | null;
  /** The next breakpoint above the current count, or null at max. */
  nextBreakpoint: number | null;
  /** Units still needed to reach `nextBreakpoint`. */
  unitsToNext: number | null;
  /** R6.2 — highlight traits one unit away from the next breakpoint. */
  oneAway: boolean;
}

/**
 * Resolves every trait on a board, active or not.
 *
 * Inactive traits are included deliberately: "you have 3 Vanguard, one more
 * unlocks it" is the single most useful thing the panel says, and dropping
 * sub-breakpoint traits would hide exactly that.
 *
 * Sorted by how close to a breakpoint the trait is, so the ones a player can
 * act on rise to the top.
 */
export function resolveTraits(units: readonly BoardUnit[], context: TraitContext): ActiveTrait[] {
  const contributors = new Map<string, Set<string>>();

  for (const unit of units) {
    const native = context.traitsByChampion.get(unit.championId) ?? [];
    // A Set per trait keyed by champion id is what enforces rule 1: a second
    // copy of the same champion lands on the same key and changes nothing.
    for (const traitId of native) {
      addContributor(contributors, traitId, unit.championId);
    }

    for (const itemId of unit.itemIds ?? []) {
      const granted = context.emblemGrants?.get(itemId);
      // An emblem for a trait the unit already has adds nothing — the Set
      // handles that too, without a special case.
      if (granted) addContributor(contributors, granted, unit.championId);
    }
  }

  const resolved: ActiveTrait[] = [];

  for (const [traitId, champions] of contributors) {
    const definition = context.traits.get(traitId);
    const breakpoints = [...(definition?.breakpoints ?? [])].sort((a, b) => a - b);
    const count = champions.size;

    const activeBreakpoint =
      [...breakpoints].reverse().find((breakpoint) => count >= breakpoint) ?? null;
    const nextBreakpoint = breakpoints.find((breakpoint) => count < breakpoint) ?? null;
    const unitsToNext = nextBreakpoint === null ? null : nextBreakpoint - count;

    resolved.push({
      traitId,
      name: definition?.name ?? traitId,
      count,
      activeBreakpoint,
      nextBreakpoint,
      unitsToNext,
      oneAway: unitsToNext === 1,
    });
  }

  return resolved.sort(compareTraits);
}

/**
 * Panel ordering: actionable first.
 *
 * One-away traits lead, then active traits by how deep they are, then the
 * rest by proximity to their next breakpoint. A player scanning the panel
 * mid-edit is looking for "what can I turn on right now".
 */
function compareTraits(a: ActiveTrait, b: ActiveTrait): number {
  if (a.oneAway !== b.oneAway) return a.oneAway ? -1 : 1;

  const aActive = a.activeBreakpoint !== null;
  const bActive = b.activeBreakpoint !== null;
  if (aActive !== bActive) return aActive ? -1 : 1;

  if (aActive && bActive) return b.activeBreakpoint! - a.activeBreakpoint!;

  // Both inactive: closest to unlocking first.
  return (a.unitsToNext ?? Infinity) - (b.unitsToNext ?? Infinity);
}

function addContributor(
  contributors: Map<string, Set<string>>,
  traitId: string,
  championId: string,
): void {
  const existing = contributors.get(traitId);
  if (existing) existing.add(championId);
  else contributors.set(traitId, new Set([championId]));
}

/** Traits currently granting a bonus. */
export function activeTraits(resolved: readonly ActiveTrait[]): ActiveTrait[] {
  return resolved.filter((trait) => trait.activeBreakpoint !== null);
}

/**
 * The trait counts in the shape comp-detection expects, so a builder board can
 * be matched against the registry without a second implementation (R6.4).
 *
 * Only active traits are included — `detectComp` treats a count as evidence a
 * trait is online, which is what `boardFromParticipant` does for real matches.
 * Passing inactive counts here would match comps a board has not actually
 * assembled.
 */
export function toTraitCounts(resolved: readonly ActiveTrait[]): Record<string, number> {
  return Object.fromEntries(activeTraits(resolved).map((trait) => [trait.traitId, trait.count]));
}
