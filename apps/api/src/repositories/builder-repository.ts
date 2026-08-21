/**
 * Saved builder boards (task 4.3).
 *
 * _Requirements: 6.3, 7.4_
 */
import { randomBytes } from 'node:crypto';

import type { Database } from '../db/postgres.js';

export interface BuilderUnit {
  championId: string;
  starLevel: 1 | 2 | 3;
  itemIds: string[];
  /**
   * Free-form slot index from the editor. Front/back is derived in the UI.
   *
   * Explicitly `| undefined` rather than bare optional: under
   * `exactOptionalPropertyTypes` a Zod-parsed object carries `position:
   * undefined` when the key was absent, and a bare `?` would reject it. The
   * looser type is the honest one — an unplaced unit genuinely has no slot.
   */
  position?: number | undefined;
}

export interface BuilderComp {
  id: string;
  puuid: string | null;
  patch: string;
  name: string;
  units: BuilderUnit[];
  level: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A URL-safe, unguessable share id.
 *
 * 12 bytes of randomness rather than a sequential id: a serial in a public URL
 * lets anyone walk every board ever saved. Base64url keeps it copy-pasteable
 * without escaping.
 */
export function newShareId(): string {
  return randomBytes(12).toString('base64url');
}

interface BuilderRow {
  id: string;
  puuid: string | null;
  patch: string;
  name: string;
  units: BuilderUnit[];
  level: number;
  created_at: Date;
  updated_at: Date;
}

const toComp = (row: BuilderRow): BuilderComp => ({
  id: row.id,
  puuid: row.puuid,
  patch: row.patch,
  name: row.name,
  units: row.units,
  level: row.level,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export class BuilderRepository {
  constructor(private readonly db: Database) {}

  async save(input: {
    puuid: string | null;
    patch: string;
    name: string;
    units: BuilderUnit[];
    level: number;
  }): Promise<BuilderComp> {
    const { rows } = await this.db.query<BuilderRow>(
      `INSERT INTO builder_comps (id, puuid, patch, name, units, level)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING *`,
      [
        newShareId(),
        input.puuid,
        input.patch,
        input.name,
        JSON.stringify(input.units),
        input.level,
      ],
    );
    return toComp(rows[0]!);
  }

  /**
   * Loads a board by share id.
   *
   * Deliberately not scoped by owner: the whole point of R6.3 is that the link
   * reconstructs the board for whoever opens it. Ownership only governs
   * *writes* (see `update`).
   */
  async findById(id: string): Promise<BuilderComp | null> {
    const { rows } = await this.db.query<BuilderRow>('SELECT * FROM builder_comps WHERE id = $1', [
      id,
    ]);
    return rows[0] ? toComp(rows[0]) : null;
  }

  /**
   * Updates a board the caller owns.
   *
   * The `puuid` in the WHERE clause is the authorization check — an anonymous
   * board (`puuid IS NULL`) can never be updated by anyone, which is the
   * correct outcome: nobody can prove they created it.
   */
  async update(
    id: string,
    puuid: string,
    changes: { name?: string; units?: BuilderUnit[]; level?: number },
  ): Promise<BuilderComp | null> {
    const { rows } = await this.db.query<BuilderRow>(
      `UPDATE builder_comps SET
         name = COALESCE($3, name),
         units = COALESCE($4::jsonb, units),
         level = COALESCE($5, level),
         updated_at = now()
       WHERE id = $1 AND puuid = $2
       RETURNING *`,
      [
        id,
        puuid,
        changes.name ?? null,
        changes.units ? JSON.stringify(changes.units) : null,
        changes.level ?? null,
      ],
    );
    return rows[0] ? toComp(rows[0]) : null;
  }

  async listForPlayer(puuid: string, limit = 50): Promise<BuilderComp[]> {
    const { rows } = await this.db.query<BuilderRow>(
      'SELECT * FROM builder_comps WHERE puuid = $1 ORDER BY updated_at DESC LIMIT $2',
      [puuid, limit],
    );
    return rows.map(toComp);
  }

  async delete(id: string, puuid: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      'DELETE FROM builder_comps WHERE id = $1 AND puuid = $2',
      [id, puuid],
    );
    return (rowCount ?? 0) > 0;
  }
}
