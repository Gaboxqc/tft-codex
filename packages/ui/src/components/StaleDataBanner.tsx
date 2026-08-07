/**
 * Stale-data banner.
 *
 * R1.6: when the pipeline has missed 2x its normal refresh interval, keep
 * serving the last known-good data but say so. Deliberately not dismissible —
 * it applies for the whole session, and a toast the user closed once would
 * leave them reading stale numbers believing they were live
 * (design-system.md §5).
 *
 * _Requirements: 1.5, 1.6, 11.2_
 */
import type { JSX } from 'react';

export interface StaleDataBannerProps {
  /** ISO timestamp of the last successful refresh (R1.5). */
  lastRefreshedAt: string;
  patch: string;
  className?: string;
  /** Injectable for deterministic tests. */
  now?: Date;
}

function formatAge(lastRefreshedAt: string, now: Date): string {
  const elapsedMs = now.getTime() - new Date(lastRefreshedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'an unknown time';

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function StaleDataBanner({
  lastRefreshedAt,
  patch,
  className,
  now = new Date(),
}: StaleDataBannerProps): JSX.Element {
  const classes = ['tftc-stale-banner', className].filter(Boolean).join(' ');

  return (
    <div className={classes} role="status" data-testid="stale-data-banner">
      <span className="tftc-stale-banner__icon" aria-hidden="true">
        ⚠
      </span>
      <span>
        Stats haven&apos;t refreshed in {formatAge(lastRefreshedAt, now)}. You&apos;re seeing the
        last known-good data for patch {patch} — it may not reflect the current meta.
      </span>
    </div>
  );
}
