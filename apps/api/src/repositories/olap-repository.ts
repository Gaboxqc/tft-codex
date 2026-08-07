/**
 * ClickHouse reads and writes.
 *
 * Split into two classes on purpose, mirroring the two clients in db/clickhouse.ts:
 *
 * - `OlapWriteRepository` takes the admin client and is used by the aggregation
 *   job. It can write every table, including the restricted augment stats.
 * - `OlapReadRepository` takes the gateway client and is used by request
 *   handlers. It has no method that touches `augment_internal_stats`, and its
 *   credentials could not read it anyway (R3.1, design.md §7 step 1).
 *
 * If you find yourself wanting to add an augment win-rate read to the read
 * repository, that is the compliance boundary doing its job — the answer is a
 * qualitative reason string from the recommendation engine, not the number.
 *
 * _Requirements: 1.1, 3.1_
 */
import type { OlapClient } from '../db/clickhouse.js';
import type { CompCounters } from '../domain/tier-scoring.js';

/** A delta row — added to whatever the SummingMergeTree already holds. */
export interface CompStatDelta {
  patch: string;
  comp_id: string;
  games: number;
  top4_count: number;
  win_count: number;
  placement_sum: number;
}

export interface UnitStatDelta {
  patch: string;
  champion_id: string;
  games: number;
  top4_count: number;
  win_count: number;
  placement_sum: number;
}

export interface TraitStatDelta {
  patch: string;
  trait_id: string;
  tier_hit: number;
  games: number;
  top4_count: number;
  win_count: number;
  placement_sum: number;
}

export class OlapWriteRepository {
  constructor(private readonly client: OlapClient) {}

  async insertCompStats(rows: readonly CompStatDelta[]): Promise<void> {
    if (rows.length === 0) return;
    await this.client.insert({ table: 'comp_stats', values: rows, format: 'JSONEachRow' });
  }

  async insertUnitStats(rows: readonly UnitStatDelta[]): Promise<void> {
    if (rows.length === 0) return;
    await this.client.insert({ table: 'unit_stats', values: rows, format: 'JSONEachRow' });
  }

  async insertTraitStats(rows: readonly TraitStatDelta[]): Promise<void> {
    if (rows.length === 0) return;
    await this.client.insert({ table: 'trait_stats', values: rows, format: 'JSONEachRow' });
  }
}

export class OlapReadRepository {
  constructor(private readonly client: OlapClient) {}

  /**
   * Summed comp counters for a patch.
   *
   * The explicit `sum()` + `GROUP BY` is required, not stylistic:
   * SummingMergeTree only merges parts in the background, so reading raw rows
   * would return partially-merged duplicates and understate every comp.
   */
  async compCounters(patch: string): Promise<CompCounters[]> {
    const result = await this.client.query({
      query: `
        SELECT
          comp_id                AS compId,
          sum(games)             AS games,
          sum(top4_count)        AS top4Count,
          sum(win_count)         AS winCount,
          sum(placement_sum)     AS placementSum
        FROM comp_stats
        WHERE patch = {patch:String}
        GROUP BY comp_id
      `,
      query_params: { patch },
      format: 'JSONEachRow',
    });

    const rows = await result.json<{
      compId: string;
      games: string;
      top4Count: string;
      winCount: string;
      placementSum: string;
    }>();

    // ClickHouse returns UInt64 as strings in JSON to avoid precision loss.
    return rows.map((row) => ({
      compId: row.compId,
      games: Number(row.games),
      top4Count: Number(row.top4Count),
      winCount: Number(row.winCount),
      placementSum: Number(row.placementSum),
    }));
  }

  /** Patches that have any computed stats, newest-looking first. */
  async patchesWithStats(): Promise<string[]> {
    const result = await this.client.query({
      query: 'SELECT DISTINCT patch FROM comp_stats ORDER BY patch DESC',
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ patch: string }>();
    return rows.map((row) => row.patch);
  }
}
