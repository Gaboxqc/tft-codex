/**
 * Team compositions — the product's core entity.
 * Mirrors design.md §4. _Requirements: 1.3, 1.4, 2.1–2.5_
 */
import { z } from 'zod';

import { DifficultySchema, PlaystyleSchema, TierSchema } from './game.js';

/**
 * A comp's displayed tier. `provisional` is a first-class value rather than a
 * null tier: R1.4 requires low-sample comps be marked provisional instead of
 * being assigned a confident rank.
 */
export const CompTierSchema = z.union([TierSchema, z.literal('provisional')]);
export type CompTier = z.infer<typeof CompTierSchema>;

export const TrendSchema = z.enum(['rising', 'falling', 'stable']);
export type Trend = z.infer<typeof TrendSchema>;

export const CompUnitSchema = z.object({
  championId: z.string().min(1),
  role: z.enum(['carry', 'tank', 'support']),
  starTarget: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Item ids, ordered by priority. */
  items: z.array(z.string().min(1)),
});
export type CompUnit = z.infer<typeof CompUnitSchema>;

export const CompStatsSchema = z.object({
  avgPlacement: z.number().min(1).max(8),
  top4Rate: z.number().min(0).max(1),
  winRate: z.number().min(0).max(1),
  playRate: z.number().min(0).max(1),
  sampleSize: z.number().int().nonnegative(),
  /** ISO timestamp of the aggregation run that produced these numbers. */
  computedAt: z.iso.datetime(),
});
export type CompStats = z.infer<typeof CompStatsSchema>;

export const CompSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  altName: z.string().optional(),
  patch: z.string().min(1),
  tier: CompTierSchema,
  trend: TrendSchema,
  playstyle: PlaystyleSchema,
  difficulty: DifficultySchema,
  coreTraits: z.array(z.string().min(1)),
  /** Champion ids. */
  carries: z.array(z.string().min(1)),
  units: z.array(CompUnitSchema),
  formation: z.object({
    front: z.array(z.string().min(1)),
    back: z.array(z.string().min(1)),
  }),
  /** Ordered category labels only, e.g. ["Items","Combat","Econ"] (R2.4). */
  augmentPriority: z.array(z.string().min(1)),
  /** Augment ids that suit this comp — editorially curated, not win-rate ranked (R2.4). */
  curatedAugments: z.array(z.string().min(1)),
  /** Plain-language "why it works" copy, distinct from the stat block (R2.2). */
  explanation: z.string(),
  /** Stage-by-stage game plan derived from top-4 leveling/econ curves (R2.3). */
  stageGuides: z.object({
    stage2: z.string(),
    stage3: z.string(),
    stage4: z.string(),
  }),
  /** Alternate units to run when core units are contested (R2.5). */
  flexSlots: z
    .array(
      z.object({
        replacesChampionId: z.string().min(1),
        alternatives: z.array(z.string().min(1)),
        note: z.string().default(''),
      }),
    )
    .default([]),
  computedStats: CompStatsSchema,
});
export type Comp = z.infer<typeof CompSchema>;

/**
 * A registry entry mapping a trait/carry signature to a named comp
 * (design.md §3 step 2). Seeded manually per patch so no comp gets a tier
 * until a human confirms its signature — while the stats stay 100% computed.
 */
export const CompSignatureSchema = z.object({
  compId: z.string().min(1),
  patch: z.string().min(1),
  /** Traits that must be active at or above `minTraitCount` for a board to match. */
  coreTraits: z.array(z.string().min(1)).min(1),
  minTraitCounts: z.record(z.string(), z.number().int().positive()),
  /** At least one of these champions must be on the board. */
  carryChampionIds: z.array(z.string().min(1)).min(1),
});
export type CompSignature = z.infer<typeof CompSignatureSchema>;

/** A tier-list row: the comp plus the display metadata the list view needs. */
export const TierListEntrySchema = z.object({
  compId: z.string().min(1),
  name: z.string().min(1),
  tier: CompTierSchema,
  trend: TrendSchema,
  playstyle: PlaystyleSchema,
  difficulty: DifficultySchema,
  coreTraits: z.array(z.string().min(1)),
  carries: z.array(z.string().min(1)),
  /** The documented composite score from design.md §3, shown on request (R1.3). */
  compositeScore: z.number(),
  stats: CompStatsSchema,
  /** True when a comp moved more than one full tier since the last snapshot (R8.3). */
  metaShift: z.boolean().default(false),
});
export type TierListEntry = z.infer<typeof TierListEntrySchema>;

export const TierListSchema = z.object({
  patch: z.string().min(1),
  /** ISO timestamp of the last successful refresh, shown to users (R1.5). */
  lastRefreshedAt: z.iso.datetime(),
  /** True when the pipeline has missed 2x its normal interval (R1.6). */
  stale: z.boolean(),
  /** Version of the scoring formula that produced these tiers (R1.3). */
  scoringFormulaVersion: z.string().min(1),
  entries: z.array(TierListEntrySchema),
});
export type TierList = z.infer<typeof TierListSchema>;
