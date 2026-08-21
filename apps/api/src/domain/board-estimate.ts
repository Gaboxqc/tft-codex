/**
 * Rough board-strength estimate (task 4.6, R6.1).
 *
 * `design.md` §1 is explicit that this is **not a combat simulator**: no
 * damage calculation, no positioning, no ability modelling. It is a documented
 * heuristic that tells a player whether a board they are theorycrafting is
 * front-loaded, back-loaded, or thin — the questions a builder can actually
 * answer without simulating a fight.
 *
 * The honesty matters more than the accuracy here. A number presented as
 * authoritative that is quietly a guess is worse than a clearly-labelled
 * guess, so:
 *
 * - Output is a 0–100 index with an explicit `confidence`, never a "win
 *   chance" or a predicted placement.
 * - `formulaVersion` ships with every result, and the formula is published in
 *   the UI the same way the tier formula is on `/methodology`.
 * - `caveats` names what the estimate ignored, so a player can weigh it.
 *
 * _Requirements: 6.1_
 */

/** Bump when weights change, so a stored estimate can be read in context. */
export const ESTIMATE_FORMULA_VERSION = '1.0.0';

/**
 * Cost is the best single proxy for raw unit power available without
 * simulating anything — Riot prices units roughly by strength, and star level
 * multiplies it. These are the published weights.
 */
export const ESTIMATE_WEIGHTS = {
  /** Contribution of unit costs, scaled by star level. */
  unitPower: 0.45,
  /** Contribution of active trait breakpoints. */
  traitPower: 0.35,
  /** Contribution of completed items on the board. */
  itemPower: 0.2,
} as const;

/** A 3-star unit is roughly a unit two costs higher; a 1-star is baseline. */
const STAR_MULTIPLIER: Record<1 | 2 | 3, number> = { 1: 1, 2: 1.8, 3: 3.2 };

export interface EstimateUnit {
  championId: string;
  cost: 1 | 2 | 3 | 4 | 5;
  starLevel: 1 | 2 | 3;
  role: 'carry' | 'tank' | 'support';
  completedItems: number;
}

export interface EstimateInput {
  units: readonly EstimateUnit[];
  /** Active trait breakpoints, as returned by `resolveTraits`. */
  activeBreakpoints: readonly number[];
  /** The level this board is legal at — normalises for board size. */
  level: number;
}

export type Confidence = 'low' | 'medium';

export interface BoardEstimate {
  /** 0–100. Comparative only — meaningless in isolation. */
  index: number;
  frontline: number;
  damage: number;
  /**
   * Never `high`. This is a heuristic over static data; claiming high
   * confidence in it would be the dishonest part.
   */
  confidence: Confidence;
  caveats: string[];
  formulaVersion: string;
}

/**
 * Estimates board strength.
 *
 * Normalised against what a full board at the given level *could* hold, so a
 * 5-unit board at level 5 is not penalised for being small — it is judged
 * against other 5-unit boards. Comparing raw totals would just tell the player
 * that more units is better, which they know.
 */
export function estimateBoard(input: EstimateInput): BoardEstimate {
  const { units, level } = input;

  if (units.length === 0) {
    return {
      index: 0,
      frontline: 0,
      damage: 0,
      confidence: 'low',
      caveats: ['Empty board.'],
      formulaVersion: ESTIMATE_FORMULA_VERSION,
    };
  }

  const boardSlots = Math.max(units.length, level);

  // A board of `boardSlots` 4-cost 2-stars is the reference point for "strong".
  const referenceUnitPower = boardSlots * 4 * STAR_MULTIPLIER[2];
  const unitPower = units.reduce(
    (total, unit) => total + unit.cost * STAR_MULTIPLIER[unit.starLevel],
    0,
  );

  // Deeper breakpoints are worth more than many shallow ones — 6 Vanguard beats
  // three separate 2-traits, and a linear sum would say the opposite.
  const traitPower = input.activeBreakpoints.reduce(
    (total, breakpoint) => total + breakpoint ** 1.4,
    0,
  );
  const referenceTraitPower = Math.max(1, boardSlots) * 2 ** 1.4;

  const completedItems = units.reduce((total, unit) => total + unit.completedItems, 0);
  // Three items on each of three carries is a realistically strong board.
  const referenceItems = 9;

  const index = Math.round(
    100 *
      Math.min(
        1,
        ESTIMATE_WEIGHTS.unitPower * ratio(unitPower, referenceUnitPower) +
          ESTIMATE_WEIGHTS.traitPower * ratio(traitPower, referenceTraitPower) +
          ESTIMATE_WEIGHTS.itemPower * ratio(completedItems, referenceItems),
      ),
  );

  const frontline = subScore(units, 'tank', boardSlots);
  const damage = subScore(units, 'carry', boardSlots);

  return {
    index,
    frontline,
    damage,
    // Star levels are the strongest signal available here, so a board with
    // none specified is a weaker read than one with them.
    confidence: units.every((unit) => unit.starLevel >= 2) ? 'medium' : 'low',
    caveats: caveatsFor(input, { frontline, damage }),
    formulaVersion: ESTIMATE_FORMULA_VERSION,
  };
}

function ratio(value: number, reference: number): number {
  if (reference <= 0) return 0;
  return Math.min(1, value / reference);
}

function subScore(
  units: readonly EstimateUnit[],
  role: EstimateUnit['role'],
  boardSlots: number,
): number {
  const inRole = units.filter((unit) => unit.role === role);
  if (inRole.length === 0) return 0;

  const power = inRole.reduce(
    (total, unit) => total + unit.cost * STAR_MULTIPLIER[unit.starLevel] + unit.completedItems,
    0,
  );
  // Roughly a third of a board in each of tank and carry is a balanced shape.
  const reference = Math.max(1, boardSlots / 3) * (4 * STAR_MULTIPLIER[2] + 2);
  return Math.round(100 * ratio(power, reference));
}

/**
 * Names what the estimate ignored.
 *
 * This is the part that keeps the number honest — a player who can see what
 * was left out can weigh the score properly instead of trusting it.
 */
function caveatsFor(input: EstimateInput, scores: { frontline: number; damage: number }): string[] {
  const caveats: string[] = [
    'Positioning, ability damage and item interactions are not modelled — this is a shape check, not a fight.',
  ];

  if (scores.frontline < 25) {
    caveats.push('Almost no front line: this board dies before its carries deal damage.');
  }
  if (scores.damage < 25) {
    caveats.push('Very little damage: this board survives but cannot close a round.');
  }
  if (input.activeBreakpoints.length === 0) {
    caveats.push('No trait is active, so none of the board’s synergy bonuses are online.');
  }
  if (input.units.length < input.level) {
    caveats.push(
      `You have room for ${input.level - input.units.length} more unit${input.level - input.units.length === 1 ? '' : 's'} at this level.`,
    );
  }

  return caveats;
}
