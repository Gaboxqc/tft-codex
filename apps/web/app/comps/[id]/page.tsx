/**
 * Comp detail (task 1.12).
 *
 * R2.1 asks for stats, units with roles and items, formation, and the stage
 * plan. R2.2 asks for the plain-language "why it works" to be *distinct from*
 * the stat block — the two answer different questions, and merging them
 * produces a page that neither explains nor informs.
 *
 * Note what the augment section does NOT show: no augment win rate, no augment
 * average placement, no ranked-by-performance list. Category labels and a
 * curated set only (R2.4, R3.1).
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1_
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TierBadge, TrendIndicator } from '@tft-codex/ui';

import { getComp } from '@/lib/api';
import { AugmentAdvisor } from '../../_components/AugmentAdvisor';

interface CompPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: CompPageProps): Promise<Metadata> {
  const { id } = await params;
  const result = await getComp(id);
  return { title: result.ok ? result.data.name : 'Comp' };
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

/**
 * Riot ids carry a set prefix and an entity prefix that mean nothing to a
 * player — `TFT17_Augment_SorcererHeart` should read "Sorcerer Heart". Display
 * names come from Data Dragon once static game data is ingested; until then
 * this keeps the UI readable rather than showing raw ids.
 */
const shortId = (id: string): string =>
  id
    .replace(/^TFT\d*_/, '')
    .replace(/^(TFT_)?(Item|Augment)_/, '')
    // Split camel case back into words: "SorcererHeart" -> "Sorcerer Heart".
    .replace(/([a-z])([A-Z])/g, '$1 $2');

export default async function CompPage({ params }: CompPageProps) {
  const { id } = await params;
  const result = await getComp(id);

  if (!result.ok && result.reason === 'not-found') notFound();

  if (!result.ok) {
    return (
      <div className="tftc-stale-banner" role="status">
        <span className="tftc-stale-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <span>Couldn&apos;t reach the meta engine: {result.detail}</span>
      </div>
    );
  }

  const comp = result.data;
  const provisional = comp.tier === 'provisional';

  return (
    <article className="comp-detail">
      <header className="comp-detail__head">
        <Link href="/" className="comp-detail__back">
          ← Tier list
        </Link>
        <div className="comp-detail__title">
          <TierBadge tier={comp.tier} />
          <h1 className="page-title">{comp.name}</h1>
          <TrendIndicator trend={comp.trend} />
        </div>
        <p className="comp-detail__meta">
          {comp.playstyle} · {comp.difficulty} · patch {comp.patch}
          {comp.altName ? ` · also called "${comp.altName}"` : ''}
        </p>
      </header>

      {/* R2.1 — the computed stat block, kept visually separate from the prose. */}
      <section className="comp-detail__section">
        <h2>Performance</h2>
        {provisional ? (
          <p className="empty-state">
            Not enough games on this patch yet to report reliable numbers. Check back after the meta
            settles.
          </p>
        ) : (
          <dl className="stat-row tftc-stat">
            <div>
              <dt>Avg placement</dt>
              <dd>{comp.computedStats.avgPlacement.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Top 4 rate</dt>
              <dd>{percent(comp.computedStats.top4Rate)}</dd>
            </div>
            <div>
              <dt>Win rate</dt>
              <dd>{percent(comp.computedStats.winRate)}</dd>
            </div>
            <div>
              <dt>Play rate</dt>
              <dd>{percent(comp.computedStats.playRate)}</dd>
            </div>
            <div>
              <dt>Sample</dt>
              <dd>{comp.computedStats.sampleSize.toLocaleString()} games</dd>
            </div>
          </dl>
        )}
      </section>

      {/* R2.2 — deliberately its own section, not a caption under the numbers. */}
      {comp.explanation && (
        <section className="comp-detail__section">
          <h2>Why it works</h2>
          <p className="comp-detail__prose">{comp.explanation}</p>
        </section>
      )}

      <section className="comp-detail__section">
        <h2>Units and items</h2>
        <table className="tftc-table unit-table">
          <thead>
            <tr>
              <th scope="col">Unit</th>
              <th scope="col">Role</th>
              <th scope="col">Target</th>
              <th scope="col">Items (priority order)</th>
            </tr>
          </thead>
          <tbody>
            {comp.units.map((unit) => (
              <tr key={unit.championId}>
                <th scope="row">{shortId(unit.championId)}</th>
                <td>{unit.role}</td>
                <td>{'★'.repeat(unit.starTarget)}</td>
                <td>{unit.items.map(shortId).join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="comp-detail__section">
        <h2>Formation</h2>
        <div className="formation">
          <div>
            <h3>Front line</h3>
            <ul>
              {comp.formation.front.map((unit) => (
                <li key={unit}>{shortId(unit)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Back line</h3>
            <ul>
              {comp.formation.back.map((unit) => (
                <li key={unit}>{shortId(unit)}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* R2.3 — derived from the aggregated curves of top-4 finishers. */}
      <section className="comp-detail__section">
        <h2>Game plan</h2>
        <ol className="stage-guide">
          <li>
            <h3>Stage 2 — early</h3>
            <p>{comp.stageGuides.stage2 || 'Not written yet.'}</p>
          </li>
          <li>
            <h3>Stage 3 — mid</h3>
            <p>{comp.stageGuides.stage3 || 'Not written yet.'}</p>
          </li>
          <li>
            <h3>Stage 4 — rolldown</h3>
            <p>{comp.stageGuides.stage4 || 'Not written yet.'}</p>
          </li>
        </ol>
      </section>

      {/*
        R2.4 + R3.1. Categories in priority order and a curated set — never a
        performance-ranked augment list, and never a win rate or placement
        beside an augment name. The API cannot send those numbers; this page
        would have nowhere to put them if it did.
      */}
      <section className="comp-detail__section">
        <h2>Augment priority</h2>
        <ol className="augment-priority">
          {comp.augmentPriority.map((category) => (
            <li key={category}>{category}</li>
          ))}
        </ol>
        {comp.curatedAugments.length > 0 && (
          <>
            <h3>Augments that suit this comp</h3>
            <ul className="augment-list">
              {comp.curatedAugments.map((augment) => (
                <li key={augment}>{shortId(augment)}</li>
              ))}
            </ul>
          </>
        )}
        <p className="comp-detail__note">
          Listed by category and fit, not ranked by performance — Riot&apos;s developer policy
          doesn&apos;t permit third-party apps to publish augment win rates or placements.
        </p>
      </section>

      {/* Task 2.10 — exercises /v1/recommendations before the overlay exists. */}
      <AugmentAdvisor boardUnits={comp.units.map((unit) => unit.championId)} compName={comp.name} />

      {/* R2.5 — what to run when core units are contested. */}
      {comp.flexSlots.length > 0 && (
        <section className="comp-detail__section">
          <h2>When you&apos;re contested</h2>
          <ul className="flex-slots">
            {comp.flexSlots.map((slot) => (
              <li key={slot.replacesChampionId}>
                <strong>{shortId(slot.replacesChampionId)}</strong> →{' '}
                {slot.alternatives.map(shortId).join(' · ')}
                {slot.note && <span className="comp-detail__note"> {slot.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
