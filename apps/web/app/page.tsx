/**
 * The tier list — the product's front door (task 1.11).
 *
 * Server-rendered so the first paint is the actual data rather than a spinner
 * (design.md §13's reason for choosing Next). Filters live in the URL, so a
 * filtered view is shareable and survives a reload.
 *
 * _Requirements: 1.5, 1.6, 1.7, 11.2_
 */
import { Suspense } from 'react';
import { StaleDataBanner } from '@tft-codex/ui';

import { getTierList } from '@/lib/api';
import { CompCard } from './_components/CompCard';
import { TierListFilters } from './_components/TierListFilters';

export const dynamic = 'force-dynamic';

interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const result = await getTierList({
    ...(single(params['tier']) ? { tier: single(params['tier'])! } : {}),
    ...(single(params['playstyle']) ? { playstyle: single(params['playstyle'])! } : {}),
    ...(single(params['difficulty']) ? { difficulty: single(params['difficulty'])! } : {}),
    ...(single(params['patch']) ? { patch: single(params['patch'])! } : {}),
  });

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Live tier list</h1>
        <p className="page-lede">
          Computed from real ranked match data using a <a href="/methodology">formula we publish</a>{' '}
          — not a hand-picked list.
        </p>
      </header>

      <Suspense fallback={null}>
        <TierListFilters />
      </Suspense>

      {!result.ok ? (
        // R11.2 — degraded, not broken. Say what happened rather than throwing.
        <div className="tftc-stale-banner" role="status">
          <span className="tftc-stale-banner__icon" aria-hidden="true">
            ⚠
          </span>
          <span>
            {result.reason === 'not-found'
              ? 'No tier list has been published yet. The data pipeline needs to run at least once.'
              : `Couldn't reach the meta engine: ${result.detail}`}
          </span>
        </div>
      ) : (
        <>
          {result.data.stale && (
            <StaleDataBanner
              lastRefreshedAt={result.data.lastRefreshedAt}
              patch={result.data.patch}
            />
          )}

          <p className="tier-list__meta tftc-stat">
            Patch <strong>{result.data.patch}</strong> · updated{' '}
            <time dateTime={result.data.lastRefreshedAt}>
              {new Date(result.data.lastRefreshedAt).toUTCString()}
            </time>{' '}
            · formula v{result.data.scoringFormulaVersion}
          </p>

          {result.data.entries.length === 0 ? (
            <p className="empty-state">No comps match those filters on this patch.</p>
          ) : (
            <div className="comp-grid">
              {result.data.entries.map((entry) => (
                <CompCard key={entry.compId} entry={entry} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
