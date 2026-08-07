/**
 * Tier-list comp card (design-system.md §5).
 *
 * Stats render in tabular numerals so placement and percentage columns align
 * down the list — a small detail that carries a lot of perceived rigour on a
 * stats-heavy product, and an obvious sloppiness when missing.
 *
 * A provisional comp renders with a dashed border and muted stats instead of
 * the normal solid card, so "we don't have enough games yet" reads visually
 * and not only in the badge (R1.4).
 *
 * _Requirements: 1.3, 1.4, 1.7, 2.1_
 */
import Link from 'next/link';
import type { TierListEntry } from '@tft-codex/shared-types';
import { TierBadge, TrendIndicator } from '@tft-codex/ui';

export interface CompCardProps {
  entry: TierListEntry;
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

export function CompCard({ entry }: CompCardProps) {
  const provisional = entry.tier === 'provisional';

  return (
    <Link
      href={`/comps/${entry.compId}`}
      className={`comp-card${provisional ? ' comp-card--provisional' : ''}`}
    >
      <div className="comp-card__head">
        <TierBadge tier={entry.tier} />
        <TrendIndicator trend={entry.trend} metaShift={entry.metaShift} />
      </div>

      <h2 className="comp-card__name">{entry.name}</h2>

      <ul className="comp-card__traits">
        {entry.coreTraits.map((trait) => (
          <li key={trait}>{trait.replace(/^TFT\d+_/, '')}</li>
        ))}
      </ul>

      <dl className="comp-card__stats tftc-stat">
        <div>
          <dt>Avg place</dt>
          <dd>{entry.stats.avgPlacement.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Top 4</dt>
          <dd>{percent(entry.stats.top4Rate)}</dd>
        </div>
        <div>
          <dt>Win</dt>
          <dd>{percent(entry.stats.winRate)}</dd>
        </div>
        <div>
          <dt>Play</dt>
          <dd>{percent(entry.stats.playRate)}</dd>
        </div>
      </dl>

      <p className="comp-card__meta">
        {entry.playstyle} · {entry.difficulty} ·{' '}
        {provisional
          ? `only ${entry.stats.sampleSize.toLocaleString()} games`
          : `${entry.stats.sampleSize.toLocaleString()} games`}
      </p>
    </Link>
  );
}
