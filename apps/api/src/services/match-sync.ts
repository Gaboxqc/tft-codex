/**
 * Per-user match sync (task 3.3).
 *
 * Pulls a linked player's recent ranked matches, tags each with a detected
 * comp (task 3.4), extracts what curve data Riot actually exposes (task 3.5 —
 * see `match-extraction.ts` for why that is one point rather than a curve), and
 * stores the result.
 *
 * Idempotency is the property that matters (task 3.13). Sync runs on link and
 * then on a schedule, and the two overlap constantly; re-running must never
 * duplicate a match or double-count a placement. Two mechanisms:
 *
 * - Already-stored match ids are filtered out *before* fetching, so a repeat
 *   sync costs almost no Riot budget rather than re-fetching and relying on the
 *   upsert to discard.
 * - The insert is `ON CONFLICT DO NOTHING` on `(match_id, puuid)`, so even a
 *   race between two concurrent syncs lands one row.
 *
 * This uses the `player` rate-limit lane, which is capped below the live lane
 * so a burst of new signups cannot starve the 30-minute meta refresh (R1.2).
 *
 * _Requirements: 4.1, 4.2, 4.6, 12.2_
 */
import { RiotApiError, type RiotApiClient } from '@tft-codex/riot-client';
import { MatchSchema } from '@tft-codex/riot-client';
import type { CompSignature } from '@tft-codex/shared-types';

import { extractMatch } from '../domain/match-extraction.js';
import type { PlayerRepository, StoredMatch } from '../repositories/player-repository.js';

/** Only ranked TFT feeds personal analytics, matching the meta engine. */
const RANKED_TFT_QUEUE_ID = 1100;

export interface MatchSyncOptions {
  riot: RiotApiClient;
  players: PlayerRepository;
  signaturesByPatch: Map<string, CompSignature[]>;
  logger?: (message: string, detail?: unknown) => void;
}

export interface SyncResult {
  fetched: number;
  stored: number;
  skipped: number;
  /** Already known, so never fetched. The measure of idempotency working. */
  alreadyKnown: number;
}

export class MatchSyncService {
  readonly #riot: RiotApiClient;
  readonly #players: PlayerRepository;
  readonly #signatures: Map<string, CompSignature[]>;
  readonly #log: (message: string, detail?: unknown) => void;

  constructor(options: MatchSyncOptions) {
    this.#riot = options.riot;
    this.#players = options.players;
    this.#signatures = options.signaturesByPatch;
    this.#log = options.logger ?? (() => undefined);
  }

  async sync(puuid: string, options: { count?: number } = {}): Promise<SyncResult> {
    const matchIds = await this.#riot.getMatchIdsByPuuid(puuid, {
      count: options.count ?? 20,
      lane: 'player',
    });

    const known = await this.#players.knownMatchIds(puuid);
    const toFetch = matchIds.filter((id) => !known.has(id));
    const alreadyKnown = matchIds.length - toFetch.length;

    const extracted: StoredMatch[] = [];
    let skipped = 0;

    for (const matchId of toFetch) {
      try {
        const raw = await this.#riot.getMatch(matchId, { lane: 'player' });
        const parsed = MatchSchema.safeParse(raw);
        if (!parsed.success) {
          skipped += 1;
          continue;
        }

        const queueId = parsed.data.info.queue_id ?? parsed.data.info.queueId ?? null;
        if (queueId !== RANKED_TFT_QUEUE_ID) {
          skipped += 1;
          continue;
        }

        const signatures = this.#signatures.get(
          // Signatures are per patch; the extractor re-derives the patch, so
          // read it the same way here to pick the right registry.
          parsed.data.info.game_version
            .match(/Version\s+(\d+)\.(\d+)/)
            ?.slice(1, 3)
            .join('.') ?? '',
        );

        const summary = extractMatch(parsed.data, puuid, signatures ?? []);
        if (!summary) {
          skipped += 1;
          continue;
        }

        extracted.push(summary);
      } catch (error) {
        if (error instanceof RiotApiError && error.isNotFound) {
          skipped += 1;
          continue;
        }
        // Transient: leave it unstored so the next sync picks it up.
        this.#log(`match sync: ${matchId} failed`, error);
      }
    }

    const stored = await this.#players.upsertMatches(extracted);
    await this.#players.markSynced(puuid);

    this.#log(`match sync: ${stored} stored, ${skipped} skipped, ${alreadyKnown} already known`);

    return { fetched: toFetch.length, stored, skipped, alreadyKnown };
  }
}
