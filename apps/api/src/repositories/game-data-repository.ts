/**
 * Static game data — champions, traits, items — for a patch.
 *
 * Everything the builder needs to resolve traits and recipes, loaded once per
 * patch and cached in-process. This data changes only when a patch does, and
 * it is small (a few hundred rows), so a per-request query would be pure
 * overhead on a route a player hits on every board edit.
 *
 * _Requirements: 6.1, 6.2, 16.1_
 */
import type { Trait } from '@tft-codex/shared-types';

import type { Database } from '../db/postgres.js';
import type { ItemRecipe } from '../domain/item-optimizer.js';

export interface PatchGameData {
  patch: string;
  championNames: ReadonlyMap<string, string>;
  costs: ReadonlyMap<string, number>;
  traitsByChampion: ReadonlyMap<string, string[]>;
  traits: ReadonlyMap<string, Trait>;
  recipes: ReadonlyMap<string, ItemRecipe>;
  /** Item id → trait id, for emblems. */
  emblemGrants: ReadonlyMap<string, string>;
  /**
   * Champion id → its usual role, derived from the comp registry rather than
   * from static data — Riot does not label units "carry" or "tank", and the
   * comps we track already encode that judgement per unit.
   */
  roles: ReadonlyMap<string, 'carry' | 'tank' | 'support'>;
}

export class GameDataRepository {
  readonly #cache = new Map<string, PatchGameData>();

  constructor(private readonly db: Database) {}

  /** Clears the cache. Call after ingesting new static data for a patch. */
  invalidate(patch?: string): void {
    if (patch) this.#cache.delete(patch);
    else this.#cache.clear();
  }

  async forPatch(patch: string): Promise<PatchGameData> {
    const cached = this.#cache.get(patch);
    if (cached) return cached;

    const [champions, traits, items, compUnits] = await Promise.all([
      this.db.query<{ id: string; name: string; cost: number; traits: string[] }>(
        'SELECT id, name, cost, traits FROM champions WHERE patch = $1',
        [patch],
      ),
      this.db.query<{ id: string; name: string; type: string; breakpoints: number[] }>(
        'SELECT id, name, type, breakpoints FROM traits WHERE patch = $1',
        [patch],
      ),
      this.db.query<{ id: string; name: string; components: string[] | null; tags: string[] }>(
        'SELECT id, name, components, tags FROM items WHERE patch = $1',
        [patch],
      ),
      this.db.query<{ units: { championId: string; role: string }[] }>(
        'SELECT units FROM comps WHERE patch = $1',
        [patch],
      ),
    ]);

    const emblemGrants = new Map<string, string>();
    const recipes = new Map<string, ItemRecipe>();

    for (const item of items.rows) {
      recipes.set(item.id, {
        id: item.id,
        name: item.name,
        components:
          item.components && item.components.length === 2
            ? [item.components[0]!, item.components[1]!]
            : null,
        tags: item.tags,
      });

      // Emblems are tagged rather than name-matched: "TFT_Item_VanguardEmblem"
      // parsing works until a set ships an emblem named differently, and a tag
      // is something the data pipeline controls.
      const emblemTag = item.tags.find((tag) => tag.startsWith('emblem:'));
      if (emblemTag) emblemGrants.set(item.id, emblemTag.slice('emblem:'.length));
    }

    // Roles come from the comp registry: the same champion is a carry in one
    // comp and a support in another, so this takes the most common assignment
    // across tracked comps rather than pretending there is one right answer.
    const roleVotes = new Map<string, Map<string, number>>();
    for (const row of compUnits.rows) {
      for (const unit of row.units ?? []) {
        const votes = roleVotes.get(unit.championId) ?? new Map<string, number>();
        votes.set(unit.role, (votes.get(unit.role) ?? 0) + 1);
        roleVotes.set(unit.championId, votes);
      }
    }

    const roles = new Map<string, 'carry' | 'tank' | 'support'>();
    for (const [championId, votes] of roleVotes) {
      const [winner] = [...votes.entries()].sort((a, b) => b[1] - a[1]);
      if (winner) roles.set(championId, winner[0] as 'carry' | 'tank' | 'support');
    }

    const data: PatchGameData = {
      patch,
      championNames: new Map(champions.rows.map((row) => [row.id, row.name])),
      costs: new Map(champions.rows.map((row) => [row.id, row.cost])),
      traitsByChampion: new Map(champions.rows.map((row) => [row.id, row.traits])),
      traits: new Map(
        traits.rows.map((row) => [
          row.id,
          {
            id: row.id,
            name: row.name,
            type: row.type as Trait['type'],
            breakpoints: row.breakpoints,
          },
        ]),
      ),
      recipes,
      emblemGrants,
      roles,
    };

    this.#cache.set(patch, data);
    return data;
  }
}
