/**
 * Categorical tier badge for comps (R1.3) and augments (R3.2).
 *
 * The props type accepts a tier and nothing else. That is the point: a numeric
 * value rendered beside a tier letter reads as a stat, and on an augment that
 * would breach R3.1. Enforcing it in the type means the component cannot be
 * misused rather than merely shouldn't be (design-system.md §5).
 *
 * _Requirements: 1.3, 1.4, 3.1, 3.2, 11.3_
 */
import type { JSX } from 'react';

import type { CompTier } from '@tft-codex/shared-types';

export interface TierBadgeProps {
  tier: CompTier;
  className?: string;
}

const TIER_LABELS: Record<CompTier, string> = {
  S: 'S',
  A: 'A',
  B: 'B',
  C: 'C',
  provisional: 'Provisional',
};

const TIER_DESCRIPTIONS: Record<CompTier, string> = {
  S: 'S tier',
  A: 'A tier',
  B: 'B tier',
  C: 'C tier',
  // R1.4 — must not read as a confident rank, to a sighted or a screen-reader user.
  provisional: 'Provisional — not enough games this patch to assign a tier',
};

export function TierBadge({ tier, className }: TierBadgeProps): JSX.Element {
  const classes = ['tftc-tier-badge', `tftc-tier-badge--${tier.toLowerCase()}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} title={TIER_DESCRIPTIONS[tier]} data-tier={tier}>
      {/* Tier is never conveyed by color alone — the letter carries it too (R11.3). */}
      <span aria-hidden="true">{TIER_LABELS[tier]}</span>
      <span className="tftc-sr-only">{TIER_DESCRIPTIONS[tier]}</span>
    </span>
  );
}
