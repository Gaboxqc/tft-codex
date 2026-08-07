/**
 * Augment chip — the component-level half of the R3.1 defence.
 *
 * `AugmentChipProps` has no field for a win rate or an average placement, so
 * a caller holding those numbers has nowhere to put them. That mirrors the
 * `Augment` type's structural restriction in shared-types and design.md §4:
 * three independent layers (type, API grant, CI scan), none of which relies on
 * anyone remembering the rule.
 *
 * Play rate is the one number this component renders, and R3.3 explicitly
 * permits it — Riot's restriction names win rate and average placement, not
 * pick frequency.
 *
 * _Requirements: 3.1, 3.2, 3.3_
 */
import type { JSX } from 'react';

import type { Tier } from '@tft-codex/shared-types';

export interface AugmentChipProps {
  name: string;
  tier: Tier;
  /**
   * Pick frequency as a fraction (0–1). Optional because the recommendation
   * flow (R3.4) ranks offered options qualitatively and shows no number at all.
   *
   * NOTE: do not add `winRate`, `avgPlacement`, or any equivalent here.
   * See requirements.md R3.1 — it is a Riot approval blocker, not a preference.
   */
  playRate?: number;
  /** Qualitative reason from the recommendation engine's template bank (R3.4). */
  reason?: string;
  className?: string;
}

const formatPlayRate = (playRate: number): string => `${(playRate * 100).toFixed(1)}% picked`;

export function AugmentChip({
  name,
  tier,
  playRate,
  reason,
  className,
}: AugmentChipProps): JSX.Element {
  const classes = ['tftc-augment-chip', `tftc-augment-chip--${tier.toLowerCase()}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} data-tier={tier}>
      <span className="tftc-sr-only">{`${tier} tier`}</span>
      <strong>{name}</strong>
      {playRate !== undefined && (
        <span className="tftc-augment-chip__play-rate">{formatPlayRate(playRate)}</span>
      )}
      {reason && <span className="tftc-augment-chip__reason">{reason}</span>}
    </span>
  );
}
