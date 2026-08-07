/**
 * Augments — the compliance-critical type in this system.
 *
 * The public `Augment` record deliberately has NO win-rate and NO average-
 * placement field. This is not an oversight (design.md §4/§7): the restriction
 * is structural, so a client cannot render a number it was never sent, and a
 * future engineer cannot leak one by forgetting a filter.
 *
 * Any addition to `AugmentSchema` must be checked against requirements.md R3.1
 * before merging. The CI suite in tasks.md 2.6 enforces this automatically.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.6_
 */
import { z } from 'zod';

import { TierSchema } from './game.js';

/**
 * Public augment record. Everything here is safe to serialize to any client.
 *
 * - `tier` is categorical only (R3.2) — the letter, never the score behind it.
 * - `playRate` is explicitly permitted (R3.3): Riot's restriction names win
 *   rate and average placement, not pick frequency.
 */
export const AugmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: TierSchema,
  /** Pick frequency, 0–1. Permitted by R3.3. */
  playRate: z.number().min(0).max(1),
  /** Stages at which this augment can be offered. */
  roundsOffered: z.array(z.union([z.literal(2), z.literal(3), z.literal(4)])),
  description: z.string(),
  patch: z.string().min(1),
});
export type Augment = z.infer<typeof AugmentSchema>;

/**
 * Whether this entity is an Augment or a Legend. R3.6 requires the same
 * compliance machinery apply to Legends the moment a Set reintroduces them,
 * with no code change needed to "re-enable" compliance — hence one shared
 * shape rather than a parallel Legend type that could drift.
 */
export const AUGMENT_KINDS = ['augment', 'legend'] as const;
export const AugmentKindSchema = z.enum(AUGMENT_KINDS);
export type AugmentKind = z.infer<typeof AugmentKindSchema>;

export const AugmentDetailSchema = AugmentSchema.extend({
  kind: AugmentKindSchema.default('augment'),
  /** Comps this augment suits well — editorially curated, never win-rate ranked (R2.4). */
  curatedForCompIds: z.array(z.string().min(1)).default([]),
  /** Qualitative fit copy, e.g. "wants a front line already in place". */
  qualitativeNotes: z.string().default(''),
});
export type AugmentDetail = z.infer<typeof AugmentDetailSchema>;

/**
 * SERVER-SIDE ONLY. Never serialized into any API response, ever.
 *
 * Lives in a ClickHouse table the API gateway's DB credentials cannot reach
 * (design.md §7 step 1) — "structurally unreachable", not "filtered". It exists
 * purely to order the recommendation engine's output, which then emits a
 * qualitative reason string instead of the number that produced it.
 *
 * It is defined in this package (rather than inside the API) so the type is
 * available to the aggregation job and the compliance tests, and so its
 * server-only status is documented at the point of definition.
 */
export const AugmentInternalStatsSchema = z.object({
  augmentId: z.string().min(1),
  /** null = global (not scoped to a comp). */
  compId: z.string().min(1).nullable(),
  avgPlacement: z.number(),
  winRate: z.number(),
  sampleSize: z.number().int().nonnegative(),
});
export type AugmentInternalStats = z.infer<typeof AugmentInternalStatsSchema>;
