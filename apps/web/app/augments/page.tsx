/**
 * Augment explorer (task 2.7).
 *
 * R3.1 applies to "any client (web, desktop, or API response)" and explicitly
 * includes tooltips and exports. So this page renders tier badges, play rate,
 * and qualitative notes — and there is no view, hover state, sort option, or
 * download on it that produces an augment win rate or average placement,
 * because the data never arrives.
 *
 * The explanatory note near the top is deliberate product design, not an
 * apology. Competitors show numbers here; a player who notices their absence
 * should learn why in one sentence rather than assume the app is incomplete.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.6_
 */
import type { Metadata } from 'next';
import { AugmentChip } from '@tft-codex/ui';

import { getAugments, type PublicAugment } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Augments',
  description:
    'Categorical augment tiers and pick rates for the current TFT patch, sorted by tier.',
};

const TIER_ORDER = ['S', 'A', 'B', 'C'] as const;

interface AugmentsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function AugmentsPage({ searchParams }: AugmentsPageProps) {
  const params = await searchParams;
  const kind = single(params['kind']) === 'legend' ? 'legend' : 'augment';
  const result = await getAugments({ kind });

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">{kind === 'legend' ? 'Legends' : 'Augments'}</h1>
        <p className="page-lede">
          Graded from real ranked match data, shown as a tier and a pick rate.
        </p>
      </header>

      {/*
        R3.1 in plain English. Being upfront reads better than an unexplained
        gap where every competitor shows a number.
      */}
      <p className="policy-note">
        Riot&apos;s developer policy doesn&apos;t permit third-party apps to publish augment win
        rates or average placements, so you won&apos;t find them here or anywhere else in TFT Codex.
        The letter grade is computed from that data; the numbers behind it stay on our server. Pick
        rate is shown because it measures what players choose, not how it performed.
      </p>

      {!result.ok ? (
        <div className="tftc-stale-banner" role="status">
          <span className="tftc-stale-banner__icon" aria-hidden="true">
            ⚠
          </span>
          <span>
            {result.reason === 'not-found'
              ? 'No augment data has been published yet.'
              : `Couldn't reach the meta engine: ${result.detail}`}
          </span>
        </div>
      ) : result.data.augments.length === 0 ? (
        <p className="empty-state">
          No {kind === 'legend' ? 'Legends' : 'augments'} tracked on patch {result.data.patch} yet.
        </p>
      ) : (
        <>
          <p className="tier-list__meta tftc-stat">
            Patch <strong>{result.data.patch}</strong> ·{' '}
            {result.data.augments.length.toLocaleString()} tracked
          </p>

          {TIER_ORDER.map((tier) => {
            const inTier = result.data.augments.filter((augment) => augment.tier === tier);
            if (inTier.length === 0) return null;

            return (
              <section key={tier} className="augment-tier-group">
                <h2 className="augment-tier-group__heading">
                  <span className={`tftc-tier-badge tftc-tier-badge--${tier.toLowerCase()}`}>
                    {tier}
                  </span>
                  {tier} tier
                  <span className="augment-tier-group__count">{inTier.length}</span>
                </h2>
                <ul className="augment-grid">
                  {inTier.map((augment) => (
                    <li key={augment.id}>
                      <AugmentDetailCard augment={augment} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </>
  );
}

function AugmentDetailCard({ augment }: { augment: PublicAugment }) {
  return (
    <article className="augment-card">
      {/*
        AugmentChip's props type has no field for a win rate or placement, so
        even a determined caller has nowhere to put one (design-system.md §5).
      */}
      <AugmentChip name={augment.name} tier={augment.tier} playRate={augment.playRate} />

      <p className="augment-card__description">{augment.description}</p>

      {augment.qualitativeNotes && (
        <p className="augment-card__notes">{augment.qualitativeNotes}</p>
      )}

      <p className="augment-card__meta">
        {augment.category ? `${augment.category} · ` : ''}
        offered at stage{augment.roundsOffered.length > 1 ? 's' : ''}{' '}
        {augment.roundsOffered.join(', ') || '—'}
        {/*
          R1.4's spirit applied to augments: a thin sample gets a letter,
          because the player has to choose something this round, but the UI
          says how much to trust it.
        */}
        {augment.provisional && <span className="augment-card__provisional"> · low sample</span>}
      </p>
    </article>
  );
}
