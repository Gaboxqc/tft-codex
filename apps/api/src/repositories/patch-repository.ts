/**
 * Patch metadata, tier-list snapshot history, and meta shifts (tasks 6.3, 6.4).
 *
 * Redis holds the *live* snapshot for serving; this holds the history. A
 * browsable archive (R8.4) cannot live behind a TTL, and R1.8 requires a
 * rotated Set's data be retained rather than deleted.
 *
 * _Requirements: 1.8, 8.1, 8.3, 8.4_
 */
import type { BalanceChange, PatchVersion, TierListEntry } from '@tft-codex/shared-types';

import type { Database } from '../db/postgres.js';

export interface SnapshotSummary {
  version: string;
  patch: string;
  formulaVersion: string;
  publishedAt: string;
  compCount: number;
}

export interface StoredSnapshot extends SnapshotSummary {
  entries: TierListEntry[];
}

export interface MetaShiftRecord {
  patch: string;
  compId: string;
  fromTier: string;
  toTier: string;
  fromVersion: string;
  toVersion: string;
  detectedAt: string;
}

interface PatchRow {
  id: string;
  set_number: number;
  set_name: string;
  release_date: Date;
  is_current_patch: boolean;
  archived: boolean;
  balance_changes: PatchVersion['balanceChanges'];
  meta_impact_summary: string | null;
}

const toPatch = (row: PatchRow): PatchVersion => ({
  id: row.id,
  setNumber: row.set_number,
  setName: row.set_name,
  // The column is DATE; toISOString would add a spurious time component.
  releaseDate: row.release_date.toISOString().slice(0, 10),
  isCurrentPatch: row.is_current_patch,
  archived: row.archived,
  balanceChanges: row.balance_changes,
  metaImpactSummary: row.meta_impact_summary,
});

export class PatchRepository {
  constructor(private readonly db: Database) {}

  // ── Patches (R8.1, R8.4) ─────────────────────────────────────────────────

  async list(limit = 30): Promise<PatchVersion[]> {
    const { rows } = await this.db.query<PatchRow>(
      'SELECT * FROM patches ORDER BY release_date DESC LIMIT $1',
      [limit],
    );
    return rows.map(toPatch);
  }

  async findById(id: string): Promise<PatchVersion | null> {
    const { rows } = await this.db.query<PatchRow>('SELECT * FROM patches WHERE id = $1', [id]);
    return rows[0] ? toPatch(rows[0]) : null;
  }

  async latest(): Promise<PatchVersion | null> {
    const { rows } = await this.db.query<PatchRow>(
      'SELECT * FROM patches ORDER BY is_current_patch DESC, release_date DESC LIMIT 1',
    );
    return rows[0] ? toPatch(rows[0]) : null;
  }

  /**
   * Publishes an editorially-approved meta summary (R8.2).
   *
   * There is deliberately no method that writes this without going through a
   * caller that has confirmed approval — the column stays null until a human
   * signs off, and a "generate and store" convenience would quietly bypass
   * that.
   */
  async approveMetaSummary(patchId: string, summary: string): Promise<void> {
    await this.db.query('UPDATE patches SET meta_impact_summary = $2 WHERE id = $1', [
      patchId,
      summary,
    ]);
  }

  // ── Balance changes and the summary draft (tasks 6.1, 6.2) ───────────────

  /**
   * Replaces a patch's balance changes and records the version they came from.
   *
   * Whole-array replacement is safe here only because the caller has already
   * merged the editorial records back in (`mergeBalanceChanges`). Writing a
   * bare diff through this method would delete every hand-written record on
   * the patch, which is the one failure mode task 6.1 has to avoid.
   */
  async saveBalanceChanges(
    patchId: string,
    changes: readonly BalanceChange[],
    dataDragonVersion: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE patches
          SET balance_changes = $2::jsonb,
              data_dragon_version = $3
        WHERE id = $1`,
      [patchId, JSON.stringify(changes), dataDragonVersion],
    );
  }

  /** The Data Dragon version a patch was last diffed against, if any. */
  async dataDragonVersion(patchId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ data_dragon_version: string | null }>(
      'SELECT data_dragon_version FROM patches WHERE id = $1',
      [patchId],
    );
    return rows[0]?.data_dragon_version ?? null;
  }

  /**
   * Stores an unapproved draft (R8.2).
   *
   * Writes `meta_impact_draft`, never `meta_impact_summary`. Publishing is a
   * separate, human action — see `approveMetaSummary`.
   */
  async saveMetaSummaryDraft(patchId: string, draft: string): Promise<void> {
    await this.db.query(
      `UPDATE patches
          SET meta_impact_draft = $2,
              meta_impact_drafted_at = now()
        WHERE id = $1`,
      [patchId, draft],
    );
  }

  /** Drops a draft an editor has decided against, leaving anything published alone. */
  async discardMetaSummaryDraft(patchId: string): Promise<void> {
    await this.db.query(
      `UPDATE patches
          SET meta_impact_draft = NULL,
              meta_impact_drafted_at = NULL
        WHERE id = $1`,
      [patchId],
    );
  }

  /** The pending draft and whatever is already published, for a review screen. */
  async metaSummaryReview(patchId: string): Promise<{
    draft: string | null;
    draftedAt: string | null;
    published: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
  } | null> {
    const { rows } = await this.db.query<{
      meta_impact_draft: string | null;
      meta_impact_drafted_at: Date | null;
      meta_impact_summary: string | null;
      meta_impact_approved_by: string | null;
      meta_impact_approved_at: Date | null;
    }>(
      `SELECT meta_impact_draft, meta_impact_drafted_at, meta_impact_summary,
              meta_impact_approved_by, meta_impact_approved_at
         FROM patches WHERE id = $1`,
      [patchId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      draft: row.meta_impact_draft,
      draftedAt: row.meta_impact_drafted_at?.toISOString() ?? null,
      published: row.meta_impact_summary,
      approvedBy: row.meta_impact_approved_by,
      approvedAt: row.meta_impact_approved_at?.toISOString() ?? null,
    };
  }

  /**
   * Publishes a draft under a named approver (R8.2).
   *
   * The approved text is passed in rather than copied from the draft column so
   * an editor can correct it on the way through — which is most of what
   * reviewing an AI draft consists of. The name is required by the signature:
   * an approval nobody is accountable for is a rubber stamp.
   */
  async approveMetaSummaryAs(patchId: string, summary: string, approvedBy: string): Promise<void> {
    await this.db.query(
      `UPDATE patches
          SET meta_impact_summary = $2,
              meta_impact_approved_by = $3,
              meta_impact_approved_at = now()
        WHERE id = $1`,
      [patchId, summary, approvedBy],
    );
  }

  // ── Snapshots (R8.4) ─────────────────────────────────────────────────────

  /**
   * Archives a published snapshot.
   *
   * Idempotent on `(patch, version)` so a re-run of the publisher does not
   * duplicate history.
   */
  async saveSnapshot(snapshot: {
    patch: string;
    version: string;
    formulaVersion: string;
    entries: TierListEntry[];
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO tier_list_snapshots (patch, version, formula_version, entries)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (patch, version) DO NOTHING`,
      [snapshot.patch, snapshot.version, snapshot.formulaVersion, JSON.stringify(snapshot.entries)],
    );
  }

  async listSnapshots(patch: string, limit = 20): Promise<SnapshotSummary[]> {
    const { rows } = await this.db.query<{
      version: string;
      patch: string;
      formula_version: string;
      published_at: Date;
      comp_count: string;
    }>(
      `SELECT version, patch, formula_version, published_at,
              jsonb_array_length(entries) AS comp_count
       FROM tier_list_snapshots
       WHERE patch = $1
       ORDER BY published_at DESC
       LIMIT $2`,
      [patch, limit],
    );

    return rows.map((row) => ({
      version: row.version,
      patch: row.patch,
      formulaVersion: row.formula_version,
      publishedAt: row.published_at.toISOString(),
      compCount: Number(row.comp_count),
    }));
  }

  async findSnapshot(patch: string, version: string): Promise<StoredSnapshot | null> {
    const { rows } = await this.db.query<{
      version: string;
      patch: string;
      formula_version: string;
      published_at: Date;
      entries: TierListEntry[];
    }>('SELECT * FROM tier_list_snapshots WHERE patch = $1 AND version = $2', [patch, version]);

    const row = rows[0];
    return row
      ? {
          version: row.version,
          patch: row.patch,
          formulaVersion: row.formula_version,
          publishedAt: row.published_at.toISOString(),
          compCount: row.entries.length,
          entries: row.entries,
        }
      : null;
  }

  /** The snapshot published immediately before `version`, for diffing. */
  async previousSnapshot(patch: string, version: string): Promise<StoredSnapshot | null> {
    const { rows } = await this.db.query<{
      version: string;
      patch: string;
      formula_version: string;
      published_at: Date;
      entries: TierListEntry[];
    }>(
      `SELECT * FROM tier_list_snapshots
       WHERE patch = $1
         AND published_at < (
           SELECT published_at FROM tier_list_snapshots WHERE patch = $1 AND version = $2
         )
       ORDER BY published_at DESC
       LIMIT 1`,
      [patch, version],
    );

    const row = rows[0];
    return row
      ? {
          version: row.version,
          patch: row.patch,
          formulaVersion: row.formula_version,
          publishedAt: row.published_at.toISOString(),
          compCount: row.entries.length,
          entries: row.entries,
        }
      : null;
  }

  // ── Meta shifts (R8.3) ───────────────────────────────────────────────────

  async recordMetaShifts(shifts: readonly Omit<MetaShiftRecord, 'detectedAt'>[]): Promise<number> {
    if (shifts.length === 0) return 0;

    const { rowCount } = await this.db.query(
      `INSERT INTO meta_shifts (patch, comp_id, from_tier, to_tier, from_version, to_version)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
       ON CONFLICT (patch, comp_id, to_version) DO NOTHING`,
      [
        shifts.map((shift) => shift.patch),
        shifts.map((shift) => shift.compId),
        shifts.map((shift) => shift.fromTier),
        shifts.map((shift) => shift.toTier),
        shifts.map((shift) => shift.fromVersion),
        shifts.map((shift) => shift.toVersion),
      ],
    );
    return rowCount ?? 0;
  }

  async recentMetaShifts(patch: string, limit = 20): Promise<MetaShiftRecord[]> {
    const { rows } = await this.db.query<{
      patch: string;
      comp_id: string;
      from_tier: string;
      to_tier: string;
      from_version: string;
      to_version: string;
      detected_at: Date;
    }>('SELECT * FROM meta_shifts WHERE patch = $1 ORDER BY detected_at DESC LIMIT $2', [
      patch,
      limit,
    ]);

    return rows.map((row) => ({
      patch: row.patch,
      compId: row.comp_id,
      fromTier: row.from_tier,
      toTier: row.to_tier,
      fromVersion: row.from_version,
      toVersion: row.to_version,
      detectedAt: row.detected_at.toISOString(),
    }));
  }
}
