/**
 * Turning a Riot match payload into a `MatchSummary` (tasks 3.4, 3.5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTANT — a gap between the spec and Riot's actual API.
 *
 * Task 3.5 says "build the leveling-curve and gold-curve extraction from match
 * timeline data". **Riot's TFT API has no match timeline.** `match-v1` returns
 * final state only: a participant's ending `level`, their `gold_left`, and the
 * `last_round` they were eliminated on. There is no per-round history, and no
 * TFT equivalent of League's `match-v5` timeline endpoint.
 *
 * So a true per-round curve cannot be built from the public API at all. It can
 * only be captured live, from Overwolf's Game Events Provider, and written down
 * afterwards — which is Phase 5 work, not Phase 3.
 *
 * What this module does instead:
 *
 * - Extracts an *endpoint* rather than a curve: one data point at the round the
 *   player was eliminated. That is genuinely useful — comparing your ending
 *   level at your elimination round against the top-4 baseline at the same
 *   round is a real signal — and it is honest about being one point.
 * - `curveSource` marks where the data came from, so the UI can say "final
 *   state only" rather than drawing a two-point line and implying it tracked
 *   the whole game.
 * - When Phase 5 lands, GEP-captured curves get written with
 *   `curveSource: 'gep-capture'` and everything downstream — comparison,
 *   coaching, the review screen — works unchanged, because it all consumes
 *   `CurvePoint[]` and does not care where the points came from.
 *
 * The alternative was to synthesise plausible-looking intermediate points from
 * the final state. That would produce a chart that looks like data and is
 * fiction, which is worse than a chart with two points on it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * _Requirements: 4.1, 4.2, 4.3_
 */
import type { Match, MatchParticipant } from '@tft-codex/riot-client';
import { patchOf } from '@tft-codex/riot-client';
import type { CompSignature, CurvePoint, MatchSummary } from '@tft-codex/shared-types';

import { boardFromParticipant, detectComp } from './comp-detection.js';

/** Where a stored curve's points came from. */
export type CurveSource = 'final-state' | 'gep-capture';

export interface ExtractedMatch extends MatchSummary {
  /**
   * `final-state` means the curves hold a single endpoint derived from
   * `match-v1`, because Riot exposes no TFT timeline. See the module comment.
   */
  curveSource: CurveSource;
  /** Completed items on the final board, for the itemisation signal (R4.5). */
  completedItemCount: number;
}

/**
 * Converts Riot's `last_round` counter into a stage-round label.
 *
 * Riot counts rounds cumulatively from 1. Stage 1 has 3 rounds and every later
 * stage has 7, so the arithmetic has to account for that offset — treating it
 * as 7 per stage from the start puts every label a stage out.
 */
export function lastRoundLabel(lastRound: number): string | null {
  if (!Number.isFinite(lastRound) || lastRound < 1) return null;

  if (lastRound <= 3) return `1-${lastRound}`;

  const afterStageOne = lastRound - 3;
  const stage = Math.floor((afterStageOne - 1) / 7) + 2;
  const index = ((afterStageOne - 1) % 7) + 1;
  return `${stage}-${index}`;
}

/**
 * Counts completed items on the board.
 *
 * Components carry no in-name marker distinguishing them from completed items,
 * so this counts every item slot and leaves the caller to compare against the
 * comp's expectation. Over-counting a component pair as two items would
 * understate the shortfall, which is the direction that produces *less*
 * aggressive advice — the safer error.
 */
export function countCompletedItems(participant: MatchParticipant): number {
  return participant.units.reduce((total, unit) => total + (unit.itemNames?.length ?? 0), 0);
}

/**
 * Builds a `MatchSummary` for one participant.
 *
 * Returns null when the payload lacks a usable patch label — an unpatched row
 * would be compared against the wrong patch's baseline, which is worse than
 * having no row.
 */
export function extractMatch(
  match: Match,
  puuid: string,
  signatures: readonly CompSignature[],
): ExtractedMatch | null {
  const participant = match.info.participants.find((entry) => entry.puuid === puuid);
  if (!participant) return null;

  const patch = patchOf(match.info);
  if (!patch) return null;

  const round = lastRoundLabel(participant.last_round);
  const levelCurve: CurvePoint[] = round ? [{ round, value: participant.level }] : [];
  const goldCurve: CurvePoint[] = round ? [{ round, value: participant.gold_left }] : [];

  const board = boardFromParticipant({
    traits: participant.traits.map((trait) => ({
      name: trait.name,
      num_units: trait.num_units,
      tier_current: trait.tier_current,
    })),
    units: participant.units.map((unit) => ({
      character_id: unit.character_id,
      tier: unit.tier,
    })),
  });

  return {
    matchId: match.metadata.match_id,
    puuid,
    patch,
    placement: participant.placement,
    detectedCompId: detectComp(board, signatures)?.compId ?? null,
    // Ids only. R4.7 forbids joining placement to these in any exposed view
    // until Riot's written answer lands (task 3.12).
    augmentsPicked: participant.augments ?? [],
    levelCurve,
    goldCurve,
    timestamp: new Date(match.info.game_datetime).toISOString(),
    curveSource: 'final-state',
    completedItemCount: countCompletedItems(participant),
  };
}

/**
 * Builds top-4 baseline curves for a comp from the other participants in
 * matches the user played (R4.3).
 *
 * R4.6 matters here: these participants' data is used in memory to compute a
 * baseline and is never persisted against their identity. Nothing returned
 * carries a PUUID.
 */
export function baselineFromParticipants(
  matches: readonly Match[],
  compId: string,
  signatures: readonly CompSignature[],
): { levelCurve: CurvePoint[]; goldCurve: CurvePoint[]; sampleSize: number } {
  const levels: CurvePoint[] = [];
  const golds: CurvePoint[] = [];
  let sampleSize = 0;

  for (const match of matches) {
    for (const participant of match.info.participants) {
      if (participant.placement > 4) continue;

      const board = boardFromParticipant({
        traits: participant.traits.map((trait) => ({
          name: trait.name,
          num_units: trait.num_units,
          tier_current: trait.tier_current,
        })),
        units: participant.units.map((unit) => ({
          character_id: unit.character_id,
          tier: unit.tier,
        })),
      });

      if (detectComp(board, signatures)?.compId !== compId) continue;

      const round = lastRoundLabel(participant.last_round);
      if (!round) continue;

      levels.push({ round, value: participant.level });
      golds.push({ round, value: participant.gold_left });
      sampleSize += 1;
    }
  }

  return { levelCurve: levels, goldCurve: golds, sampleSize };
}
