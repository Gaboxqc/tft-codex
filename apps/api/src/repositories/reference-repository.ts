/**
 * Static game-constant reference data (R17.1).
 *
 * Sourced per patch from game constants, never from player state. The whole
 * table is public and cacheable for hours — nothing here changes between
 * matches, which is precisely what makes it Tier-1 compliant.
 *
 * _Requirements: 17.1, 17.2_
 */
import type { BreakpointReference } from '@tft-codex/shared-types';

import type { Database } from '../db/postgres.js';

export class ReferenceRepository {
  constructor(private readonly db: Database) {}

  async breakpoints(patch: string): Promise<BreakpointReference> {
    const { rows } = await this.db.query<{
      level: number;
      xp_to_reach: number;
      gold_to_buy_xp: number;
      note: string;
    }>(
      `SELECT level, xp_to_reach, gold_to_buy_xp, note
       FROM level_breakpoints WHERE patch = $1 ORDER BY level`,
      [patch],
    );

    const { rows: econ } = await this.db.query<{ interest_thresholds: number[] }>(
      'SELECT interest_thresholds FROM econ_constants WHERE patch = $1',
      [patch],
    );

    return {
      patch,
      rows: rows.map((row) => ({
        level: row.level,
        xpToReach: row.xp_to_reach,
        goldToBuyXp: row.gold_to_buy_xp,
        note: row.note,
      })),
      // Interest caps at 5 gold per round in every Set to date; the default
      // matches that rather than leaving an empty array the UI has to special-case.
      interestThresholds: econ[0]?.interest_thresholds ?? [10, 20, 30, 40, 50],
    };
  }
}
