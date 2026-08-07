/**
 * Pre-game lobby intel — the *compliant* version of "scouting".
 *
 * Computed exactly once, at loading-screen detection, from public participant
 * match history. It is never refreshed, extended, or re-queried once combat
 * starts, and it never reads live board state (R14.2, R14.3). The service that
 * produces it is deliberately isolated from the recommendation engine
 * (design.md §2) so it cannot drift into live opponent tracking.
 *
 * _Requirements: 14.1–14.4_
 */
import { z } from 'zod';

export const LobbyIntelEntrySchema = z.object({
  puuid: z.string().min(1),
  riotId: z.string().min(1),
  /** Average placement over the last N ranked games. */
  recentAvgPlacement: z.number().min(1).max(8).nullable(),
  /** Comp ids, top 3 by play count. */
  mostPlayedComps: z.array(z.string().min(1)).max(3),
  rankTier: z.string().min(1).nullable(),
  /**
   * Set once at loading-screen detection and never updated. A changed value
   * for the same matchId is a compliance bug, not a refresh.
   */
  computedAt: z.iso.datetime(),
  /**
   * True when Riot's API was unavailable for this participant — the panel
   * renders "no recent data" rather than blocking the rest of it (design.md §9).
   */
  unavailable: z.boolean().default(false),
});
export type LobbyIntelEntry = z.infer<typeof LobbyIntelEntrySchema>;

export const LobbyIntelSchema = z.object({
  matchId: z.string().min(1),
  /** Same value for every entry — proof the lookup was one-shot (R14.2). */
  computedAt: z.iso.datetime(),
  entries: z.array(LobbyIntelEntrySchema),
});
export type LobbyIntel = z.infer<typeof LobbyIntelSchema>;
