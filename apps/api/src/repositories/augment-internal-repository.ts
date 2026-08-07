/**
 * Reads the restricted augment stats.
 *
 * This class is quarantined from the HTTP layer by construction:
 *
 * - It requires the ADMIN ClickHouse client. Gateway credentials cannot query
 *   the backing table at all (infra/clickhouse/init/01-gateway-user.sql).
 * - It is not reachable from `AppContext` (http/context.ts), so no route
 *   handler can obtain one.
 * - Its only consumer is the recommendation service, which uses it to *order*
 *   options and then emits a qualitative reason string instead of the number.
 *
 * If you need this data in a response path, you have found the compliance
 * boundary rather than a missing feature. The answer is a reason string.
 *
 * _Requirements: 3.1, 3.4, 3.6_
 */
import type { OlapClient } from '../db/clickhouse.js';
import type { AugmentCounters } from '../domain/augment-tiering.js';

export class AugmentInternalRepository {
  /**
   * @param client MUST be the admin client from `createAdminClickHouse`.
   *   Constructing this with the gateway client produces a class whose every
   *   method throws a permissions error at runtime.
   */
  constructor(private readonly client: OlapClient) {}

  /** All counters for a patch, global and per-comp. Server-side only. */
  async countersForPatch(patch: string): Promise<AugmentCounters[]> {
    return this.#query(
      `
        SELECT
          augment_id         AS augmentId,
          comp_id            AS compId,
          sum(games)         AS games,
          sum(top4_count)    AS top4Count,
          sum(win_count)     AS winCount,
          sum(placement_sum) AS placementSum
        FROM augment_internal_stats
        WHERE patch = {patch:String}
        GROUP BY augment_id, comp_id
      `,
      { patch },
    );
  }

  /**
   * Counters for a specific set of offered augments — the Tier-2 hot path.
   *
   * Scoped rather than fetching the whole patch because this runs synchronously
   * while a player is staring at three augment options with a timer running.
   */
  async countersForAugments(
    patch: string,
    augmentIds: readonly string[],
  ): Promise<AugmentCounters[]> {
    if (augmentIds.length === 0) return [];

    return this.#query(
      `
        SELECT
          augment_id         AS augmentId,
          comp_id            AS compId,
          sum(games)         AS games,
          sum(top4_count)    AS top4Count,
          sum(win_count)     AS winCount,
          sum(placement_sum) AS placementSum
        FROM augment_internal_stats
        WHERE patch = {patch:String} AND augment_id IN {ids:Array(String)}
        GROUP BY augment_id, comp_id
      `,
      { patch, ids: [...augmentIds] },
    );
  }

  async #query(query: string, params: Record<string, unknown>): Promise<AugmentCounters[]> {
    const result = await this.client.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    });

    const rows = await result.json<{
      augmentId: string;
      compId: string;
      games: string;
      top4Count: string;
      winCount: string;
      placementSum: string;
    }>();

    return rows.map((row) => ({
      augmentId: row.augmentId,
      // Empty string is the table's encoding for "global".
      compId: row.compId === '' ? null : row.compId,
      games: Number(row.games),
      top4Count: Number(row.top4Count),
      winCount: Number(row.winCount),
      placementSum: Number(row.placementSum),
    }));
  }
}
