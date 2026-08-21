/**
 * Patch metadata and balance changes.
 * Mirrors design.md §4. _Requirements: 1.8, 8.1–8.4_
 */
import { z } from 'zod';

/**
 * Where a balance-change record came from (task 6.1).
 *
 * This is not bookkeeping — it decides what a re-run of the ingestion job is
 * allowed to overwrite. `data-dragon` rows are derived and disposable: the job
 * recomputes them from scratch every time. `editorial` rows were typed by a
 * person to cover what Riot's static data does not expose (ability numbers,
 * trait breakpoint values), and a job that replaced them wholesale would
 * silently delete human work on every run.
 */
export const BalanceChangeSourceSchema = z.enum(['data-dragon', 'editorial']);
export type BalanceChangeSource = z.infer<typeof BalanceChangeSourceSchema>;

export const BalanceChangeSchema = z.object({
  entityType: z.enum(['champion', 'trait', 'item', 'augment']),
  entityId: z.string().min(1),
  summary: z.string(),
  /**
   * Defaulted for rows written before the ingestion job existed. Treating an
   * unlabelled row as editorial is the safe direction: the worst case is that
   * the job declines to overwrite something it could have, rather than
   * discarding a change nobody can recover.
   */
  source: BalanceChangeSourceSchema.default('editorial'),
});
export type BalanceChange = z.infer<typeof BalanceChangeSchema>;

export const PatchVersionSchema = z.object({
  /** e.g. "17.9". */
  id: z.string().min(1),
  setNumber: z.number().int().positive(),
  setName: z.string().min(1),
  releaseDate: z.iso.date(),
  isCurrentPatch: z.boolean(),
  /** True once a Set has rotated — data is archived, never deleted (R1.8). */
  archived: z.boolean().default(false),
  balanceChanges: z.array(BalanceChangeSchema),
  /** null until a human approves the AI-drafted summary (R8.2). */
  metaImpactSummary: z.string().nullable(),
});
export type PatchVersion = z.infer<typeof PatchVersionSchema>;
