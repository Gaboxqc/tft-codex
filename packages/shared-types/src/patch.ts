/**
 * Patch metadata and balance changes.
 * Mirrors design.md §4. _Requirements: 1.8, 8.1–8.4_
 */
import { z } from 'zod';

export const BalanceChangeSchema = z.object({
  entityType: z.enum(['champion', 'trait', 'item', 'augment']),
  entityId: z.string().min(1),
  summary: z.string(),
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
