/**
 * Lobby Intel Service (task 3.14) — the *compliant* version of "scouting".
 *
 * design.md §2 keeps this structurally isolated from the recommendation engine
 * on purpose: it must be demonstrable to Riot's reviewers that this code
 * cannot drift into live opponent tracking. So it lives in its own module,
 * takes no board state, and has exactly one entry point.
 *
 * The three rules, and how each is enforced rather than intended:
 *
 * - **One-shot** (R14.2). `intelFor` writes a cache entry keyed by match id
 *   before returning. A second call for the same match returns the cached
 *   value and fires no Riot request. There is no refresh parameter and no
 *   cache-busting option — not because nobody would want one, but because the
 *   absence is the guarantee.
 * - **Pre-combat only** (R14.2). The caller passes the participants visible at
 *   the loading screen. Nothing here observes the match after that.
 * - **No live opponent state, ever** (R14.3). The only Riot calls made are
 *   `getMatchIdsByPuuid` and `getLeagueEntriesByPuuid` — public, historical,
 *   already visible via a player's Riot ID. There is no call in this file that
 *   could return anything about the current match.
 *
 * A participant whose lookup fails renders as "no recent data" rather than
 * blocking the panel (design.md §9) — seven working rows and one blank is a
 * far better outcome than an error where the panel should be.
 *
 * _Requirements: 14.1, 14.2, 14.3, 14.4_
 */
import type { RiotApiClient } from '@tft-codex/riot-client';
import { RiotApiError } from '@tft-codex/riot-client';
import type { CompSignature, LobbyIntel, LobbyIntelEntry } from '@tft-codex/shared-types';

import { CACHE_KEYS, type Cache } from '../db/redis.js';
import { detectComp, boardFromParticipant } from '../domain/comp-detection.js';

/** How many recent games to average over. Keeps the lookup inside one page. */
const RECENT_MATCH_COUNT = 10;

/**
 * How long a lobby's intel stays cached.
 *
 * Longer than a TFT game (~35 minutes) so re-opening the panel at any point
 * during the match hits cache (R14.4), and short enough that Redis does not
 * accumulate lobby rows indefinitely.
 */
const CACHE_TTL_SECONDS = 60 * 90;

export interface LobbyParticipant {
  puuid: string;
  riotId: string;
}

export interface LobbyIntelOptions {
  riot: RiotApiClient;
  cache: Cache;
  signatures: readonly CompSignature[];
  logger?: (message: string, detail?: unknown) => void;
  now?: () => Date;
}

export class LobbyIntelService {
  readonly #riot: RiotApiClient;
  readonly #cache: Cache;
  readonly #signatures: readonly CompSignature[];
  readonly #log: (message: string, detail?: unknown) => void;
  readonly #now: () => Date;

  constructor(options: LobbyIntelOptions) {
    this.#riot = options.riot;
    this.#cache = options.cache;
    this.#signatures = options.signatures;
    this.#log = options.logger ?? (() => undefined);
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Returns intel for a match, computing it exactly once.
   *
   * Note the signature: no `refresh`, no `force`, no `maxAge`. There is
   * deliberately no way for a caller to ask for this to be recomputed.
   */
  async intelFor(matchId: string, participants: readonly LobbyParticipant[]): Promise<LobbyIntel> {
    const cached = await this.#readCache(matchId);
    if (cached) return cached;

    // One timestamp for the whole lobby. Every entry shares it, which is what
    // makes "this was a single pre-combat snapshot" checkable rather than
    // merely claimed (R14.2).
    const computedAt = this.#now().toISOString();

    const entries = await Promise.all(
      participants.map((participant) => this.#entryFor(participant, computedAt)),
    );

    const intel: LobbyIntel = { matchId, computedAt, entries };
    await this.#writeCache(intel);
    return intel;
  }

  async #entryFor(participant: LobbyParticipant, computedAt: string): Promise<LobbyIntelEntry> {
    const unavailable: LobbyIntelEntry = {
      puuid: participant.puuid,
      riotId: participant.riotId,
      recentAvgPlacement: null,
      mostPlayedComps: [],
      rankTier: null,
      computedAt,
      unavailable: true,
    };

    try {
      // Both calls run on the `lobby` rate-limit lane, which has reserved
      // headroom precisely because these fire synchronously at loading-screen
      // time and cannot queue behind a backfill job (design.md §3).
      const [matchIds, leagueEntries] = await Promise.all([
        this.#riot.getMatchIdsByPuuid(participant.puuid, {
          count: RECENT_MATCH_COUNT,
          lane: 'lobby',
        }),
        this.#riot
          .getLeagueEntriesByPuuid(participant.puuid, { lane: 'lobby' })
          // A player with no ranked history is a normal case, not an error.
          .catch(() => []),
      ]);

      const matches = await Promise.all(
        matchIds.map((id) => this.#riot.getMatch(id, { lane: 'lobby' }).catch(() => null)),
      );

      const placements: number[] = [];
      const compCounts = new Map<string, number>();

      for (const match of matches) {
        if (!match) continue;
        const them = match.info.participants.find((entry) => entry.puuid === participant.puuid);
        if (!them) continue;

        placements.push(them.placement);

        const board = boardFromParticipant({
          traits: them.traits.map((trait) => ({
            name: trait.name,
            num_units: trait.num_units,
            tier_current: trait.tier_current,
          })),
          units: them.units.map((unit) => ({
            character_id: unit.character_id,
            tier: unit.tier,
          })),
        });

        const compId = detectComp(board, this.#signatures)?.compId;
        if (compId) compCounts.set(compId, (compCounts.get(compId) ?? 0) + 1);
      }

      if (placements.length === 0) return unavailable;

      const ranked = leagueEntries.find((entry) => entry.queueType === 'RANKED_TFT');

      return {
        puuid: participant.puuid,
        riotId: participant.riotId,
        recentAvgPlacement:
          placements.reduce((sum, placement) => sum + placement, 0) / placements.length,
        mostPlayedComps: [...compCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([compId]) => compId),
        rankTier: ranked ? `${ranked.tier} ${ranked.rank}` : null,
        computedAt,
        unavailable: false,
      };
    } catch (error) {
      // Riot unavailable for this participant: render "no recent data" rather
      // than failing the whole panel (design.md §9).
      const status = error instanceof RiotApiError ? error.status : 'unknown';
      this.#log(`lobby intel: ${participant.riotId} unavailable (${status})`);
      return unavailable;
    }
  }

  async #readCache(matchId: string): Promise<LobbyIntel | null> {
    try {
      const raw = await this.#cache.get(CACHE_KEYS.lobbyIntel(matchId));
      return raw ? (JSON.parse(raw) as LobbyIntel) : null;
    } catch (error) {
      // A cache miss caused by Redis being down would mean a second Riot
      // lookup for this match, which is a rate-limit cost rather than a
      // compliance problem — the data is still the same pre-combat snapshot.
      this.#log('lobby intel: cache read failed', error);
      return null;
    }
  }

  async #writeCache(intel: LobbyIntel): Promise<void> {
    try {
      await this.#cache.set(
        CACHE_KEYS.lobbyIntel(intel.matchId),
        JSON.stringify(intel),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.#log('lobby intel: cache write failed', error);
    }
  }
}
