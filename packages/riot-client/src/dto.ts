/**
 * Riot API response shapes.
 *
 * Every schema is a *loose* object: unknown fields pass through untouched.
 * Riot adds fields between patches, and a strict schema would turn a harmless
 * additive change into a full ingestion outage. We validate what we depend on
 * and ignore the rest — the nightly schema-drift job (design.md §11) is what
 * catches genuine breaking changes, not a runtime parse failure in production.
 */
import { z } from 'zod';

export const LeagueItemSchema = z.looseObject({
  puuid: z.string(),
  leaguePoints: z.number().int(),
  rank: z.string().optional(),
  wins: z.number().int(),
  losses: z.number().int(),
});
export type LeagueItem = z.infer<typeof LeagueItemSchema>;

export const LeagueListSchema = z.looseObject({
  tier: z.string(),
  leagueId: z.string().optional(),
  queue: z.string().optional(),
  entries: z.array(LeagueItemSchema),
});
export type LeagueList = z.infer<typeof LeagueListSchema>;

export const LeagueEntrySchema = z.looseObject({
  puuid: z.string(),
  queueType: z.string(),
  tier: z.string(),
  rank: z.string(),
  leaguePoints: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
});
export type LeagueEntry = z.infer<typeof LeagueEntrySchema>;

export const AccountSchema = z.looseObject({
  puuid: z.string(),
  gameName: z.string().optional(),
  tagLine: z.string().optional(),
});
export type Account = z.infer<typeof AccountSchema>;

export const MatchTraitSchema = z.looseObject({
  name: z.string(),
  num_units: z.number().int(),
  /** 0 = inactive, 1..n = which breakpoint was hit. */
  style: z.number().int().optional(),
  tier_current: z.number().int(),
  tier_total: z.number().int().nullable().optional(),
});
export type MatchTrait = z.infer<typeof MatchTraitSchema>;

export const MatchUnitSchema = z.looseObject({
  character_id: z.string(),
  itemNames: z.array(z.string()).optional(),
  name: z.string().optional(),
  rarity: z.number().int(),
  /** Star level, 1-3. */
  tier: z.number().int(),
});
export type MatchUnit = z.infer<typeof MatchUnitSchema>;

export const MatchParticipantSchema = z.looseObject({
  puuid: z.string(),
  placement: z.number().int(),
  level: z.number().int(),
  last_round: z.number().int(),
  /** Augment ids picked this game. Ingested for internal ranking only (R3.1). */
  augments: z.array(z.string()).optional(),
  gold_left: z.number().int(),
  players_eliminated: z.number().int(),
  time_eliminated: z.number(),
  total_damage_to_players: z.number(),
  traits: z.array(MatchTraitSchema),
  units: z.array(MatchUnitSchema),
  riotIdGameName: z.string().optional(),
  riotIdTagline: z.string().optional(),
});
export type MatchParticipant = z.infer<typeof MatchParticipantSchema>;

export const MatchInfoSchema = z.looseObject({
  game_datetime: z.number(),
  game_length: z.number(),
  /** e.g. "Version 17.9.123.4567 (Jul 30 2026/...)". */
  game_version: z.string(),
  queue_id: z.number().int().optional(),
  queueId: z.number().int().optional(),
  tft_set_number: z.number().int().optional(),
  tft_game_type: z.string().optional(),
  participants: z.array(MatchParticipantSchema),
});
export type MatchInfo = z.infer<typeof MatchInfoSchema>;

export const MatchSchema = z.looseObject({
  metadata: z.looseObject({
    data_version: z.string().optional(),
    match_id: z.string(),
    participants: z.array(z.string()),
  }),
  info: MatchInfoSchema,
});
export type Match = z.infer<typeof MatchSchema>;

/**
 * Riot reports the queue as `queue_id` on some payload versions and `queueId`
 * on others. Reading it directly at call sites has bitten every TFT tool that
 * has tried; read it through here.
 */
export function queueIdOf(info: MatchInfo): number | null {
  return info.queue_id ?? info.queueId ?? null;
}

/**
 * Extracts the "17.9" patch label from Riot's verbose `game_version` string.
 * Returns null rather than guessing when the format changes, so a drifted
 * format shows up as unpatched rows instead of silently mislabeled stats.
 */
export function patchOf(info: MatchInfo): string | null {
  const match = /Version\s+(\d+)\.(\d+)/.exec(info.game_version);
  if (!match) return null;
  return `${match[1]}.${match[2]}`;
}
