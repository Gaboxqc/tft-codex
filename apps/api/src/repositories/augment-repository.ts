/**
 * Public augment records — the only augment data a request handler can reach.
 *
 * Backed by Postgres, which stores the *result* of tiering (a letter and a play
 * rate) rather than the inputs. The inputs live in ClickHouse behind
 * credentials this layer does not hold. Even a SQL injection here could not
 * surface a win rate, because the number is not in this database.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.6_
 */
import type { AugmentKind, Tier } from '@tft-codex/shared-types';

import type { Database } from '../db/postgres.js';

export interface PublicAugmentRecord {
  id: string;
  patch: string;
  name: string;
  kind: AugmentKind;
  tier: Tier;
  playRate: number;
  provisional: boolean;
  roundsOffered: number[];
  description: string;
  category: string | null;
  relatedTraits: string[];
  relatedCarries: string[];
  requiresTraits: string[];
  curatedForCompIds: string[];
  qualitativeNotes: string;
}

interface AugmentRow {
  id: string;
  patch: string;
  name: string;
  kind: string;
  tier: string;
  play_rate: string | number;
  provisional: boolean;
  rounds_offered: number[];
  description: string;
  category: string | null;
  related_traits: string[];
  related_carries: string[];
  requires_traits: string[];
  curated_for_comp_ids: string[];
  qualitative_notes: string;
}

const toRecord = (row: AugmentRow): PublicAugmentRecord => ({
  id: row.id,
  patch: row.patch,
  name: row.name,
  kind: row.kind as AugmentKind,
  tier: row.tier as Tier,
  // Postgres NUMERIC comes back as a string; Number() here keeps the API
  // contract numeric rather than leaking a driver detail to clients.
  playRate: Number(row.play_rate),
  provisional: row.provisional,
  roundsOffered: row.rounds_offered,
  description: row.description,
  category: row.category,
  relatedTraits: row.related_traits,
  relatedCarries: row.related_carries,
  requiresTraits: row.requires_traits,
  curatedForCompIds: row.curated_for_comp_ids,
  qualitativeNotes: row.qualitative_notes,
});

/**
 * Explicit column list, never `SELECT *`.
 *
 * If someone adds a column to `augments` holding something they shouldn't,
 * this query will not pick it up. Cheap defence, and it makes the set of
 * fields that can reach a client reviewable in one place.
 */
const SELECT_COLUMNS = `
  id, patch, name, kind, tier, play_rate, provisional, rounds_offered,
  description, category, related_traits, related_carries, requires_traits,
  curated_for_comp_ids, qualitative_notes
`;

export class AugmentRepository {
  constructor(private readonly db: Database) {}

  async list(patch: string, kind: AugmentKind = 'augment'): Promise<PublicAugmentRecord[]> {
    const { rows } = await this.db.query<AugmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM augments
       WHERE patch = $1 AND kind = $2
       ORDER BY CASE tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, name`,
      [patch, kind],
    );
    return rows.map(toRecord);
  }

  async findById(id: string, patch: string): Promise<PublicAugmentRecord | null> {
    const { rows } = await this.db.query<AugmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM augments WHERE id = $1 AND patch = $2`,
      [id, patch],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  /** Descriptors for the recommendation engine — static metadata, no outcomes. */
  async descriptorsFor(patch: string, ids: readonly string[]): Promise<PublicAugmentRecord[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query<AugmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM augments WHERE patch = $1 AND id = ANY($2::text[])`,
      [patch, [...ids]],
    );
    return rows.map(toRecord);
  }

  /**
   * Writes the tiering result (task 2.3).
   *
   * Takes a letter and a play rate — the caller has already discarded the
   * scores. There is no parameter here that could carry a win rate.
   */
  async upsertTiers(
    patch: string,
    tiers: readonly { augmentId: string; tier: Tier; playRate: number; provisional: boolean }[],
  ): Promise<number> {
    if (tiers.length === 0) return 0;

    const { rowCount } = await this.db.query(
      `
      UPDATE augments AS a SET
        tier = t.tier,
        play_rate = t.play_rate,
        provisional = t.provisional
      FROM (
        SELECT * FROM UNNEST($2::text[], $3::text[], $4::numeric[], $5::boolean[])
          AS x(augment_id, tier, play_rate, provisional)
      ) AS t
      WHERE a.id = t.augment_id AND a.patch = $1
      `,
      [
        patch,
        tiers.map((entry) => entry.augmentId),
        tiers.map((entry) => entry.tier),
        tiers.map((entry) => entry.playRate),
        tiers.map((entry) => entry.provisional),
      ],
    );
    return rowCount ?? 0;
  }
}
