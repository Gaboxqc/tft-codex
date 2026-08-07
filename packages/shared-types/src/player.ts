/**
 * Linked player profiles and personal match analytics.
 * Mirrors design.md §4. _Requirements: 4.1–4.7, 7.1–7.5, 9.1_
 */
import { z } from 'zod';

export const NotificationChannelSchema = z.enum(['email', 'webpush', 'overwolf-native']);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationCategorySchema = z.enum(['patch', 'bookmarkedComp', 'bookmarkedChampion']);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export const NotificationPrefSchema = z.object({
  channel: NotificationChannelSchema,
  category: NotificationCategorySchema,
  enabled: z.boolean(),
});
export type NotificationPref = z.infer<typeof NotificationPrefSchema>;

/**
 * Only PUUID, region, and display Riot ID are persisted — no password, no
 * unrelated PII (R7.2). Unlink hard-deletes this and all derived analytics
 * within 30 days (R7.3).
 */
export const PlayerProfileSchema = z.object({
  puuid: z.string().min(1),
  region: z.string().min(1),
  /** "Name#TAG". */
  riotId: z.string().min(1),
  linkedAt: z.iso.datetime(),
  lastSyncedAt: z.iso.datetime().nullable(),
  notificationPrefs: z.array(NotificationPrefSchema).default([]),
  /** R15.4 — users who prefer numbers can opt out of AI narrative text. */
  coachingNarrativeOptOut: z.boolean().default(false),
});
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;

export const CurvePointSchema = z.object({
  /** Game round label, e.g. "3-2". */
  round: z.string().min(1),
  value: z.number(),
});
export type CurvePoint = z.infer<typeof CurvePointSchema>;

export const MatchSummarySchema = z.object({
  matchId: z.string().min(1),
  puuid: z.string().min(1),
  patch: z.string().min(1),
  placement: z.number().int().min(1).max(8),
  detectedCompId: z.string().min(1).nullable(),
  /**
   * Augment ids only. R4.7: no placement or outcome is ever joined to this in
   * any exposed view — even for the user's own data — until Riot's approval
   * process explicitly confirms personal augment-placement analytics are in
   * scope. Do not add a field here without that answer on file.
   */
  augmentsPicked: z.array(z.string().min(1)),
  levelCurve: z.array(CurvePointSchema),
  goldCurve: z.array(CurvePointSchema),
  timestamp: z.iso.datetime(),
});
export type MatchSummary = z.infer<typeof MatchSummarySchema>;

/** One concrete, qualitative improvement suggestion per reviewed match (R4.5). */
export const ImprovementSuggestionSchema = z.object({
  /** Machine-readable signal that produced this, e.g. "leveling-timing". */
  signal: z.enum([
    'leveling-timing',
    'econ-deviation',
    'itemization-completeness',
    'augment-fit',
    'positioning',
  ]),
  /** The stage the deviation was detected at, e.g. "3-2". */
  round: z.string().min(1).nullable(),
  /** Plain-language text. Never contains an augment win rate or placement (R3.1). */
  message: z.string().min(1),
});
export type ImprovementSuggestion = z.infer<typeof ImprovementSuggestionSchema>;

/**
 * Post-game coaching narrative (R15). Generated strictly after the match ends —
 * this sits squarely in the "post-game analysis" category Riot's policy
 * explicitly encourages, and must never be produced mid-match (R15.3).
 */
export const CoachingNarrativeSchema = z.object({
  matchId: z.string().min(1),
  /** 3–5 sentences of plain-language summary (R15.1). */
  narrative: z.string().min(1),
  /** The round/stage of the biggest deviation from the top-4 baseline (R15.2). */
  keyDeviationRound: z.string().min(1).nullable(),
  suggestions: z.array(ImprovementSuggestionSchema),
  generatedAt: z.iso.datetime(),
});
export type CoachingNarrative = z.infer<typeof CoachingNarrativeSchema>;
