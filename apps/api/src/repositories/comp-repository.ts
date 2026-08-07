/**
 * Comp metadata and the signature registry.
 *
 * Postgres holds what a comp *is* (name, units, items, formation, guide copy);
 * ClickHouse holds how it is *performing*. Neither is complete alone — the tier
 * list and the comp detail view are both joins of the two (design.md §2).
 *
 * _Requirements: 1.3, 2.1–2.5_
 */
import type { CompSignature, CompUnit, Difficulty, Playstyle } from '@tft-codex/shared-types';

import type { Database } from '../db/postgres.js';

/** Everything about a comp except its computed stats. */
export interface CompMetadata {
  id: string;
  patch: string;
  name: string;
  altName: string | null;
  playstyle: Playstyle;
  difficulty: Difficulty;
  coreTraits: string[];
  carries: string[];
  units: CompUnit[];
  formation: { front: string[]; back: string[] };
  augmentPriority: string[];
  curatedAugments: string[];
  explanation: string;
  stageGuides: { stage2: string; stage3: string; stage4: string };
  flexSlots: { replacesChampionId: string; alternatives: string[]; note: string }[];
}

interface CompRow {
  id: string;
  patch: string;
  name: string;
  alt_name: string | null;
  playstyle: string;
  difficulty: string;
  core_traits: string[];
  carries: string[];
  units: CompUnit[];
  formation: { front: string[]; back: string[] };
  augment_priority: string[];
  curated_augments: string[];
  explanation: string;
  stage_guides: { stage2: string; stage3: string; stage4: string };
  flex_slots: { replacesChampionId: string; alternatives: string[]; note: string }[];
}

const toMetadata = (row: CompRow): CompMetadata => ({
  id: row.id,
  patch: row.patch,
  name: row.name,
  altName: row.alt_name,
  playstyle: row.playstyle as Playstyle,
  difficulty: row.difficulty as Difficulty,
  coreTraits: row.core_traits,
  carries: row.carries,
  units: row.units,
  formation: row.formation,
  augmentPriority: row.augment_priority,
  curatedAugments: row.curated_augments,
  explanation: row.explanation,
  stageGuides: row.stage_guides,
  flexSlots: row.flex_slots,
});

const SELECT_COLUMNS = `
  id, patch, name, alt_name, playstyle, difficulty, core_traits, carries,
  units, formation, augment_priority, curated_augments, explanation,
  stage_guides, flex_slots
`;

export class CompRepository {
  constructor(private readonly db: Database) {}

  async listMetadata(patch: string): Promise<CompMetadata[]> {
    const { rows } = await this.db.query<CompRow>(
      `SELECT ${SELECT_COLUMNS} FROM comps WHERE patch = $1 ORDER BY name`,
      [patch],
    );
    return rows.map(toMetadata);
  }

  async findById(compId: string, patch: string): Promise<CompMetadata | null> {
    const { rows } = await this.db.query<CompRow>(
      `SELECT ${SELECT_COLUMNS} FROM comps WHERE id = $1 AND patch = $2`,
      [compId, patch],
    );
    return rows[0] ? toMetadata(rows[0]) : null;
  }

  /**
   * Free-text search over name, carries and traits (R2.6).
   *
   * Deliberately simple ILIKE/array-overlap matching rather than full-text
   * search: the corpus is a few hundred comps per patch, the queries are
   * cached at the gateway, and a tsvector index would be more machinery than
   * the 300ms budget needs.
   */
  async search(options: {
    patch: string;
    query?: string;
    carry?: string;
    trait?: string;
    playstyle?: Playstyle;
    difficulty?: Difficulty;
  }): Promise<CompMetadata[]> {
    const conditions: string[] = ['patch = $1'];
    const params: unknown[] = [options.patch];

    if (options.query) {
      params.push(`%${options.query}%`);
      conditions.push(`(name ILIKE $${params.length} OR alt_name ILIKE $${params.length})`);
    }
    if (options.carry) {
      params.push(options.carry);
      conditions.push(`$${params.length} = ANY(carries)`);
    }
    if (options.trait) {
      params.push(options.trait);
      conditions.push(`$${params.length} = ANY(core_traits)`);
    }
    if (options.playstyle) {
      params.push(options.playstyle);
      conditions.push(`playstyle = $${params.length}`);
    }
    if (options.difficulty) {
      params.push(options.difficulty);
      conditions.push(`difficulty = $${params.length}`);
    }

    const { rows } = await this.db.query<CompRow>(
      `SELECT ${SELECT_COLUMNS} FROM comps WHERE ${conditions.join(' AND ')} ORDER BY name`,
      params,
    );
    return rows.map(toMetadata);
  }

  /** The signature registry for a patch, consumed by the aggregation job. */
  async listSignatures(patch: string): Promise<CompSignature[]> {
    const { rows } = await this.db.query<{
      comp_id: string;
      patch: string;
      core_traits: string[];
      min_trait_counts: Record<string, number>;
      carry_champion_ids: string[];
    }>(
      `SELECT comp_id, patch, core_traits, min_trait_counts, carry_champion_ids
       FROM comp_signatures WHERE patch = $1`,
      [patch],
    );

    return rows.map((row) => ({
      compId: row.comp_id,
      patch: row.patch,
      coreTraits: row.core_traits,
      minTraitCounts: row.min_trait_counts,
      carryChampionIds: row.carry_champion_ids,
    }));
  }

  /** All signatures, grouped by patch — what the aggregator loads per run. */
  async signaturesByPatch(): Promise<Map<string, CompSignature[]>> {
    const { rows } = await this.db.query<{
      comp_id: string;
      patch: string;
      core_traits: string[];
      min_trait_counts: Record<string, number>;
      carry_champion_ids: string[];
    }>(
      `SELECT comp_id, patch, core_traits, min_trait_counts, carry_champion_ids
       FROM comp_signatures`,
    );

    const grouped = new Map<string, CompSignature[]>();
    for (const row of rows) {
      const list = grouped.get(row.patch) ?? [];
      list.push({
        compId: row.comp_id,
        patch: row.patch,
        coreTraits: row.core_traits,
        minTraitCounts: row.min_trait_counts,
        carryChampionIds: row.carry_champion_ids,
      });
      grouped.set(row.patch, list);
    }
    return grouped;
  }

  async currentPatch(): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>(
      'SELECT id FROM patches WHERE is_current_patch LIMIT 1',
    );
    return rows[0]?.id ?? null;
  }
}
