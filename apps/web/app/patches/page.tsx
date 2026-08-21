/**
 * Patch history (task 6.4).
 *
 * R8.4 asks for browsable tier-list snapshots over time. The page leads with
 * meta shifts rather than the raw snapshot list, because "what actually
 * changed" is the question someone opens a patch-history page to answer — the
 * archive is the evidence behind it, not the headline.
 *
 * Public, per R7.4.
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4, 7.4_
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { getLatestPatch, getMetaShifts, getPatches, getSnapshots } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Patch history',
  description:
    'What changed each TFT patch, which comps moved tier, and the archived tier-list snapshots behind it.',
};

interface PatchesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function PatchesPage({ searchParams }: PatchesPageProps) {
  const requested = single((await searchParams)['patch']);

  const [patches, latest] = await Promise.all([getPatches(), getLatestPatch()]);
  const selected = requested ?? (latest.ok ? latest.data.id : null);

  const [shifts, snapshots] = selected
    ? await Promise.all([getMetaShifts(selected), getSnapshots(selected)])
    : [null, null];

  if (!patches.ok) {
    return (
      <div className="tftc-stale-banner" role="status">
        <span className="tftc-stale-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <span>Couldn&apos;t load patch history: {patches.detail}</span>
      </div>
    );
  }

  const patch = patches.data.patches.find((entry) => entry.id === selected) ?? null;

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Patch history</h1>
        <p className="page-lede">What moved, when, and the archived tier lists behind it.</p>
      </header>

      <nav className="patch-switcher" aria-label="Choose a patch">
        {patches.data.patches.map((entry) => (
          <Link
            key={entry.id}
            href={`/patches?patch=${encodeURIComponent(entry.id)}`}
            className={`patch-switcher__item${entry.id === selected ? ' patch-switcher__item--active' : ''}`}
            aria-current={entry.id === selected ? 'page' : undefined}
          >
            {entry.id}
            {entry.isCurrentPatch && <span className="patch-switcher__now">live</span>}
          </Link>
        ))}
      </nav>

      {!patch ? (
        <p className="empty-state">No patch data yet — the pipeline needs to run at least once.</p>
      ) : (
        <>
          <section className="comp-detail__section">
            <h2>What this means for the meta</h2>
            {patch.metaImpactSummary ? (
              <p className="comp-detail__prose">{patch.metaImpactSummary}</p>
            ) : (
              /*
                R8.2 — the draft exists but a human has not approved it. Saying
                so is more honest than showing nothing, and stops a reader
                assuming the patch had no impact.
              */
              <p className="empty-state">
                The summary for patch {patch.id} is still being reviewed. We don&apos;t publish meta
                commentary until a person has checked it.
              </p>
            )}
          </section>

          {/* R8.3 — the headline, because it is what the page is for. */}
          <section className="comp-detail__section">
            <h2>Comps that moved a lot</h2>
            {!shifts?.ok || shifts.data.shifts.length === 0 ? (
              <p className="empty-state">
                No comp has moved more than a single tier on patch {patch.id}. A quiet patch, or an
                early one.
              </p>
            ) : (
              <ul className="shift-list">
                {shifts.data.shifts.map((shift) => (
                  <li key={`${shift.compId}-${shift.detectedAt}`}>
                    <Link href={`/comps/${shift.compId}`}>{shift.compId}</Link>
                    <span className="shift-list__move">
                      {/* Direction is a word as well as an arrow (R11.3). */}
                      <span aria-hidden="true">
                        {tierRank(shift.toTier) < tierRank(shift.fromTier) ? '↑' : '↓'}
                      </span>{' '}
                      {shift.fromTier} → {shift.toTier}
                    </span>
                    <time dateTime={shift.detectedAt}>
                      {new Date(shift.detectedAt).toUTCString()}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="comp-detail__section">
            <h2>Balance changes</h2>
            {patch.balanceChanges.length === 0 ? (
              <p className="empty-state">No balance changes recorded for this patch yet.</p>
            ) : (
              <ul className="balance-list">
                {patch.balanceChanges.map((change) => (
                  <li key={`${change.entityType}-${change.entityId}`}>
                    <span className="balance-list__entity">{shortId(change.entityId)}</span>
                    <span>{change.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="comp-detail__section">
            <h2>Archived tier lists</h2>
            {!snapshots?.ok || snapshots.data.snapshots.length === 0 ? (
              <p className="empty-state">No snapshots archived for this patch yet.</p>
            ) : (
              <table className="tftc-table">
                <thead>
                  <tr>
                    <th scope="col">Published</th>
                    <th scope="col">Comps</th>
                    <th scope="col">Formula</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.data.snapshots.map((snapshot) => (
                    <tr key={snapshot.version}>
                      <th scope="row">
                        <time dateTime={snapshot.publishedAt}>
                          {new Date(snapshot.publishedAt).toUTCString()}
                        </time>
                      </th>
                      <td>{snapshot.compCount}</td>
                      {/*
                        The formula version travels with the snapshot so a
                        historical tier can be read in the context of the
                        formula that produced it, not today's.
                      */}
                      <td>v{snapshot.formulaVersion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}

const TIER_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };
const tierRank = (tier: string): number => TIER_ORDER[tier] ?? 99;

const shortId = (id: string): string =>
  id.replace(/^TFT\d*_/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
