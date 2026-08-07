/**
 * Trend arrow for a comp's tier movement.
 *
 * Carries a glyph as well as a hue: trend must never be conveyed by color
 * alone (design-system.md §7, R11.3).
 *
 * _Requirements: 8.3, 11.3_
 */
import type { JSX } from 'react';

import type { Trend } from '@tft-codex/shared-types';

export interface TrendIndicatorProps {
  trend: Trend;
  /** R8.3 — set when a comp moved more than one full tier between snapshots. */
  metaShift?: boolean;
  className?: string;
}

const GLYPHS: Record<Trend, string> = {
  rising: '↑',
  falling: '↓',
  stable: '→',
};

const LABELS: Record<Trend, string> = {
  rising: 'Rising',
  falling: 'Falling',
  stable: 'Stable',
};

export function TrendIndicator({
  trend,
  metaShift = false,
  className,
}: TrendIndicatorProps): JSX.Element {
  const classes = ['tftc-trend', `tftc-trend--${trend}`, className].filter(Boolean).join(' ');

  return (
    <span className={classes} data-trend={trend}>
      <span aria-hidden="true">{GLYPHS[trend]}</span>
      <span>{metaShift ? `${LABELS[trend]} — meta shift` : LABELS[trend]}</span>
    </span>
  );
}
