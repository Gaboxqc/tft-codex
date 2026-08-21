/**
 * Turning two Data Dragon versions into balance-change records (task 6.1).
 *
 * The task text asks for a job that "parses new Riot patch notes". Riot
 * publishes patch notes as prose on a web page with no structured feed, and
 * R12.1 rules out scraping — but the notes are not the only way to learn what
 * changed. A balance change *is* a difference between two versions of the
 * static game data, and Riot publishes that officially through Data Dragon.
 * So this diffs the data rather than reading the prose about it, which is both
 * sanctioned and more reliable than NLP over marketing copy.
 *
 * What that buys and what it costs, verified against the live CDN: Data Dragon
 * carries the roster, costs and rarity tiers, and carries **no** ability
 * values, base stats or trait breakpoints. So this detects units and traits
 * arriving and leaving and shop costs moving, and cannot see "spell damage
 * 280/420/900 → 260/390/850". Those are typed in through the editorial route,
 * and `mergeBalanceChanges` is what stops a re-run from deleting them.
 *
 * Every summary here is rendered from a structured fact. Nothing is
 * paraphrased and nothing is guessed: if the diff cannot characterise a
 * change, it does not emit a record for it.
 *
 * _Requirements: 8.1, 12.1_
 */
import type { BalanceChange } from '@tft-codex/shared-types';
import type { DataDragonEntry, DataDragonSnapshot } from '@tft-codex/riot-client';

export type DiffEntityType = 'champion' | 'trait' | 'item';

export interface BalanceDiffOptions {
  /**
   * Set prefix to keep, e.g. `TFT17`. Data Dragon ships every set — tutorial,
   * current and several past ones — in one file, so without this the diff
   * reports the whole of last set arriving the moment a new set is added.
   */
  setPrefix: string;
}

/**
 * Entities whose display name is worth putting in a summary.
 *
 * Ids like `TFT17_Zoe` are what the rest of the system keys on, but "Zoe" is
 * what a reader recognises. The id stays in `entityId`; the name goes in the
 * prose.
 */
const displayName = (entry: DataDragonEntry): string => entry.name || entry.id;

const inSet = (prefix: string) => (entry: DataDragonEntry) => entry.id.startsWith(`${prefix}_`);

const byId = (entries: readonly DataDragonEntry[]): Map<string, DataDragonEntry> =>
  new Map(entries.map((entry) => [entry.id, entry]));

/**
 * Diffs one entity family.
 *
 * Additions and removals are reported for every family. Cost and rarity moves
 * are champion-only because they are the only numeric fields Data Dragon
 * exposes at all.
 */
function diffFamily(
  entityType: DiffEntityType,
  before: readonly DataDragonEntry[],
  after: readonly DataDragonEntry[],
  options: BalanceDiffOptions,
): BalanceChange[] {
  const keep = inSet(options.setPrefix);
  const previous = byId(before.filter(keep));
  const current = byId(after.filter(keep));
  const changes: BalanceChange[] = [];

  const noun = entityType === 'champion' ? 'Champion' : entityType === 'trait' ? 'Trait' : 'Item';

  for (const [id, entry] of current) {
    const was = previous.get(id);

    if (!was) {
      changes.push({
        entityType,
        entityId: id,
        summary: `${noun} added to the set: ${displayName(entry)}.`,
        source: 'data-dragon',
      });
      continue;
    }

    // Cost is the one balance lever Data Dragon exposes numerically, and it is
    // a real one — a unit moving 4 → 5 changes when it can be played at all.
    if (was.cost !== undefined && entry.cost !== undefined && was.cost !== entry.cost) {
      const direction = entry.cost > was.cost ? 'increased' : 'reduced';
      changes.push({
        entityType,
        entityId: id,
        summary: `${displayName(entry)} shop cost ${direction} from ${was.cost} to ${entry.cost}.`,
        source: 'data-dragon',
      });
    }

    if (was.tier !== undefined && entry.tier !== undefined && was.tier !== entry.tier) {
      changes.push({
        entityType,
        entityId: id,
        summary: `${displayName(entry)} rarity tier changed from ${was.tier} to ${entry.tier}.`,
        source: 'data-dragon',
      });
    }
  }

  for (const [id, entry] of previous) {
    if (!current.has(id)) {
      changes.push({
        entityType,
        entityId: id,
        summary: `${noun} removed from the set: ${displayName(entry)}.`,
        source: 'data-dragon',
      });
    }
  }

  return changes;
}

/**
 * Every change detectable between two Data Dragon versions.
 *
 * Augments are absent by design, not by omission: `tft-augments.json` is a
 * display container with no augment list in it, so there is nothing to diff.
 * Augment changes are editorial-only. (Note that augment *balance* text is
 * game data and unrelated to R3.1, which forbids augment win rates and
 * placements — a summary saying an augment now grants more gold is fine.)
 */
export function diffGameData(
  before: DataDragonSnapshot,
  after: DataDragonSnapshot,
  options: BalanceDiffOptions,
): BalanceChange[] {
  return [
    ...diffFamily('champion', before.champions, after.champions, options),
    ...diffFamily('trait', before.traits, after.traits, options),
    ...diffFamily('item', before.items, after.items, options),
  ];
}

/**
 * Combines a fresh automatic diff with what a person has already written.
 *
 * The rule: **the job owns `data-dragon` rows and never touches `editorial`
 * ones.** A re-run recomputes the derived half from scratch — so a corrected
 * upstream file produces a corrected record rather than a duplicate — while
 * everything typed by hand survives untouched.
 *
 * Editorial rows win outright on a collision. If someone has written a proper
 * description of a champion's change, replacing it with "shop cost reduced
 * from 5 to 4" would be a downgrade, even though the automatic line is
 * technically accurate.
 */
export function mergeBalanceChanges(
  existing: readonly BalanceChange[],
  detected: readonly BalanceChange[],
): BalanceChange[] {
  const editorial = existing.filter((change) => change.source === 'editorial');
  const claimed = new Set(editorial.map((change) => `${change.entityType}:${change.entityId}`));

  const automatic = detected.filter(
    (change) => !claimed.has(`${change.entityType}:${change.entityId}`),
  );

  // Editorial first: a human's account of the patch is the more informative
  // half, and this list is rendered in order.
  return [...editorial, ...automatic];
}
