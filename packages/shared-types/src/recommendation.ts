/**
 * Recommendation engine contract — the other compliance-critical type.
 *
 * Two separate Riot restrictions apply here and they are NOT the same rule:
 *   1. R3.1 — never expose augment win rate / average placement (see augment.ts).
 *   2. R3.7 — never serve board-state-reactive, real-time prescriptions without
 *      written Riot confirmation on file.
 *
 * The `mode` field is a client *request*; `modeServed` is the server's answer.
 * The gateway silently downgrades `tier3-adaptive` to `tier2-lookup` unless the
 * deployment's Riot-confirmation flag is set, so no client build can ship
 * Tier-3 behavior ahead of approval (design.md §5, §8).
 *
 * _Requirements: 3.4, 3.5, 3.7, 5.4, 5.5_
 */
import { z } from 'zod';

import { RECOMMENDATION_MODES } from './compliance.js';

export const RecommendationModeSchema = z.enum(RECOMMENDATION_MODES);

export const RecommendationRequestSchema = z.object({
  /** Champion ids currently on board/bench. */
  boardUnits: z.array(z.string().min(1)).default([]),
  goldAvailable: z.number().int().nonnegative().default(0),
  level: z.number().int().min(1).max(11).default(1),
  /** Present only when requesting augment advice. */
  augmentOptions: z.array(z.string().min(1)).max(3).optional(),
  source: z.enum(['web', 'overwolf-overlay']),
  /**
   * What the client would like. The server decides what it actually gets —
   * see `modeServed` on the response.
   */
  mode: RecommendationModeSchema.default('tier2-lookup'),
});
export type RecommendationRequest = z.infer<typeof RecommendationRequestSchema>;

export const SuggestedCompSchema = z.object({
  compId: z.string().min(1),
  /** 0–1 overlap score against the comp's core units, weighted by trait breakpoints. */
  matchScore: z.number().min(0).max(1),
  missingUnits: z.array(z.string().min(1)),
});
export type SuggestedComp = z.infer<typeof SuggestedCompSchema>;

export const AugmentAdviceSchema = z.object({
  augmentId: z.string().min(1),
  /** 1 = best of the offered options. Ordering only — never a score. */
  rank: z.number().int().positive(),
  /**
   * Always qualitative text from the template bank (design.md §7 step 3).
   * Never a numeric justification derived from placement or win rate.
   */
  reason: z.string().min(1),
});
export type AugmentAdvice = z.infer<typeof AugmentAdviceSchema>;

export const RecommendationResponseSchema = z.object({
  suggestedComps: z.array(SuggestedCompSchema),
  augmentAdvice: z.array(AugmentAdviceSchema).optional(),
  /** false when we fell back to the global tier list (R3.5); always false in Tier-2. */
  contextAware: z.boolean(),
  /** Echoed back so clients label the UI correctly when a Tier-3 request was downgraded. */
  modeServed: RecommendationModeSchema,
});
export type RecommendationResponse = z.infer<typeof RecommendationResponseSchema>;

/**
 * Multi-carry itemization optimizer (R16). Tier-1 by construction: it runs on
 * an explicitly supplied component list from the builder or a post-game view,
 * never on a live bench feed. A live version would be Tier-3 and gated
 * identically to R3.7 (R16.3).
 */
export const ItemOptimizeRequestSchema = z.object({
  /** Held item component/completed item ids. */
  heldItems: z.array(z.string().min(1)),
  /** Champion ids currently planned for the board. */
  boardUnits: z.array(z.string().min(1)).min(1),
  compId: z.string().min(1).optional(),
});
export type ItemOptimizeRequest = z.infer<typeof ItemOptimizeRequestSchema>;

export const ItemAllocationSchema = z.object({
  championId: z.string().min(1),
  itemIds: z.array(z.string().min(1)),
  /** Why these went here rather than on a competing unit (R16.2). */
  rationale: z.string(),
});
export type ItemAllocation = z.infer<typeof ItemAllocationSchema>;

export const ItemOptimizeResponseSchema = z.object({
  allocations: z.array(ItemAllocationSchema),
  /** Components with no good home given the current board. */
  unallocated: z.array(z.string().min(1)),
  /** Explicit contest callouts when two units both want the same components. */
  tradeOffs: z.array(
    z.object({
      itemId: z.string().min(1),
      contestedBy: z.array(z.string().min(1)),
      explanation: z.string(),
    }),
  ),
});
export type ItemOptimizeResponse = z.infer<typeof ItemOptimizeResponseSchema>;

/**
 * Static XP/gold breakpoint reference (R17). A chart, not a calculator — it is
 * sourced from patch-level game constants and is never wired to a player's
 * live gold total (R17.2).
 */
export const BreakpointRowSchema = z.object({
  level: z.number().int().min(2).max(11),
  xpToReach: z.number().int().nonnegative(),
  goldToBuyXp: z.number().int().nonnegative(),
  /** e.g. "50 gold + no losses reaches level 8 by 4-1". */
  note: z.string().default(''),
});
export type BreakpointRow = z.infer<typeof BreakpointRowSchema>;

export const BreakpointReferenceSchema = z.object({
  patch: z.string().min(1),
  rows: z.array(BreakpointRowSchema),
  /** Gold interest thresholds, e.g. [10, 20, 30, 40, 50]. */
  interestThresholds: z.array(z.number().int().positive()),
});
export type BreakpointReference = z.infer<typeof BreakpointReferenceSchema>;
