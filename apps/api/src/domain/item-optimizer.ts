/**
 * Multi-carry itemization optimizer (task 4.8, R16).
 *
 * `review-and-roadmap.md` §2 lists this as something **no competitor does**:
 * they all show the ideal build for one unit in isolation. The actual decision
 * a player faces is different — "I hold these six components and three units
 * that want them; who gets what?" — and answering *that* is the whole point.
 *
 * ## Compliance
 *
 * Tier-1 by construction (R16.3). It takes an explicitly supplied component
 * list from the builder or a post-game view. It does not read a live bench,
 * and there is no parameter here through which it could — a live version would
 * be Tier-3 and gated identically to R3.7.
 *
 * ## Why greedy rather than exhaustive
 *
 * Optimal assignment is an assignment problem, and with ~10 components across
 * ~8 units the exhaustive search is large enough to matter on a request path
 * while being *wrong* in a way that is worse than greedy: it would optimise a
 * board-strength number the player cannot see and does not share our weights.
 *
 * Greedy-by-priority matches how players actually think — the primary carry
 * gets fed first, the tank takes what survives — and it produces an allocation
 * a player can look at and immediately agree or disagree with. An opaque
 * optimum they cannot follow is not advice.
 *
 * _Requirements: 16.1, 16.2, 16.3_
 */

/** A completed item and what it is made of. */
export interface ItemRecipe {
  id: string;
  name: string;
  /** Two component ids. Null for a component itself. */
  components: [string, string] | null;
  tags: string[];
}

/** A unit competing for items. */
export interface OptimizerUnit {
  championId: string;
  name: string;
  /** carry gets fed first; support last. */
  role: 'carry' | 'tank' | 'support';
  /**
   * Item ids this unit wants, best first. From the comp's own item priority
   * when a comp is supplied, so the optimizer inherits editorial judgement
   * rather than inventing its own.
   */
  wants: string[];
  starLevel?: 1 | 2 | 3;
}

export interface OptimizeInput {
  /** Held components and completed items, as ids. Duplicates are meaningful. */
  heldItems: readonly string[];
  units: readonly OptimizerUnit[];
  /** Recipe lookup for completed items. */
  recipes: ReadonlyMap<string, ItemRecipe>;
}

export interface Allocation {
  championId: string;
  name: string;
  /** Completed item ids assigned to this unit. */
  itemIds: string[];
  /** Why these went here rather than to a competing unit (R16.2). */
  rationale: string;
}

export interface TradeOff {
  itemId: string;
  /** Champion ids that both wanted it. */
  contestedBy: string[];
  explanation: string;
}

export interface OptimizeResult {
  allocations: Allocation[];
  /** Component ids with no good home given this board. */
  unallocated: string[];
  tradeOffs: TradeOff[];
}

/** Units hold three items in every TFT set to date. */
const MAX_ITEMS_PER_UNIT = 3;

const ROLE_PRIORITY: Record<OptimizerUnit['role'], number> = { carry: 0, tank: 1, support: 2 };

/**
 * Allocates held components across the board.
 *
 * Returns an allocation per unit plus explicit trade-off callouts wherever two
 * units wanted the same item and only one could have it.
 */
export function optimizeItems(input: OptimizeInput): OptimizeResult {
  // A multiset: two Recurve Bows are two Recurve Bows, and collapsing them to
  // a Set would silently halve what the player is holding.
  const pool = new Map<string, number>();
  for (const itemId of input.heldItems) pool.set(itemId, (pool.get(itemId) ?? 0) + 1);

  const ordered = [...input.units].sort(
    (a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role] || b.wants.length - a.wants.length,
  );

  const allocations: Allocation[] = [];
  const tradeOffs: TradeOff[] = [];
  /** Item id → champions that wanted it but did not get it. */
  const missedOut = new Map<string, string[]>();

  for (const unit of ordered) {
    const granted: string[] = [];

    for (const wanted of unit.wants) {
      if (granted.length >= MAX_ITEMS_PER_UNIT) break;

      if (takeCompleted(pool, wanted) || buildFromComponents(pool, wanted, input.recipes)) {
        granted.push(wanted);
      } else if (someoneElseWants(input.units, unit.championId, wanted)) {
        // Not available AND contested — worth telling the player why.
        missedOut.set(wanted, [...(missedOut.get(wanted) ?? []), unit.championId]);
      }
    }

    allocations.push({
      championId: unit.championId,
      name: unit.name,
      itemIds: granted,
      rationale: rationaleFor(unit, granted),
    });
  }

  for (const [itemId, losers] of missedOut) {
    const winner = allocations.find((allocation) => allocation.itemIds.includes(itemId));
    if (!winner) continue;

    const contested = [winner.championId, ...losers];
    tradeOffs.push({
      itemId,
      contestedBy: contested,
      explanation: explainContest(itemId, winner, input.units, losers),
    });
  }

  return {
    allocations,
    unallocated: [...pool.entries()].flatMap(([itemId, count]) =>
      Array.from({ length: count }, () => itemId),
    ),
    tradeOffs,
  };
}

/** Consumes an already-completed item from the pool. */
function takeCompleted(pool: Map<string, number>, itemId: string): boolean {
  const held = pool.get(itemId) ?? 0;
  if (held <= 0) return false;
  decrement(pool, itemId);
  return true;
}

/**
 * Consumes the two components for `itemId`, if both are held.
 *
 * All-or-nothing: a partial take would consume one component and leave the
 * player holding an orphan, which is exactly the mistake the optimizer exists
 * to prevent.
 */
function buildFromComponents(
  pool: Map<string, number>,
  itemId: string,
  recipes: ReadonlyMap<string, ItemRecipe>,
): boolean {
  const recipe = recipes.get(itemId);
  if (!recipe?.components) return false;

  const [first, second] = recipe.components;
  const needed = new Map<string, number>();
  needed.set(first, (needed.get(first) ?? 0) + 1);
  needed.set(second, (needed.get(second) ?? 0) + 1);

  for (const [componentId, count] of needed) {
    if ((pool.get(componentId) ?? 0) < count) return false;
  }

  for (const [componentId, count] of needed) {
    for (let index = 0; index < count; index += 1) decrement(pool, componentId);
  }
  return true;
}

function decrement(pool: Map<string, number>, itemId: string): void {
  const next = (pool.get(itemId) ?? 0) - 1;
  if (next <= 0) pool.delete(itemId);
  else pool.set(itemId, next);
}

function someoneElseWants(
  units: readonly OptimizerUnit[],
  exceptChampionId: string,
  itemId: string,
): boolean {
  return units.some((unit) => unit.championId !== exceptChampionId && unit.wants.includes(itemId));
}

/**
 * Explains an allocation in terms a player can disagree with.
 *
 * Deliberately concrete — naming the unit and what it got — rather than
 * "optimal allocation". Advice a player cannot follow is not advice.
 */
function rationaleFor(unit: OptimizerUnit, granted: readonly string[]): string {
  if (granted.length === 0) {
    return `Nothing spare for ${unit.name} — you are short the components its build wants.`;
  }

  const shortfall = Math.min(MAX_ITEMS_PER_UNIT, unit.wants.length) - granted.length;

  if (unit.role === 'carry') {
    return shortfall > 0
      ? `${unit.name} is your primary carry, so it gets fed first — but you are ${shortfall} item${shortfall === 1 ? '' : 's'} short of its full build.`
      : `${unit.name} is your primary carry and its build is complete.`;
  }

  if (unit.role === 'tank') {
    return `${unit.name} takes what the carries did not need — enough to hold the front line without starving your damage.`;
  }

  return `${unit.name} only gets leftovers here; support items are worth less than a completed carry item.`;
}

function explainContest(
  itemId: string,
  winner: Allocation,
  units: readonly OptimizerUnit[],
  losers: readonly string[],
): string {
  const loserNames = losers
    .map((championId) => units.find((unit) => unit.championId === championId)?.name ?? championId)
    .join(' and ');

  const winnerUnit = units.find((unit) => unit.championId === winner.championId);
  const winnerPriority = winnerUnit ? winnerUnit.wants.indexOf(itemId) : -1;

  // Naming *why* the winner won — role and where the item sits in its build —
  // is what makes this a trade-off explanation rather than an announcement.
  const reason =
    winnerUnit?.role === 'carry'
      ? 'it is your primary carry'
      : winnerPriority === 0
        ? 'this is the first item in its build'
        : 'it needed this one more';

  return `${loserNames} wanted this too, but ${winner.name} took it because ${reason}. If you would rather commit to ${loserNames}, move it there and rebuild around that instead.`;
}
