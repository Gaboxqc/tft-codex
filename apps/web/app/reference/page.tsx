/**
 * Leveling & econ breakpoint reference (task 2.14).
 *
 * A chart, not a calculator (R17.2). There is no input on this page and no
 * query parameter that accepts a player's gold or level — a player reads the
 * table and does the arithmetic themselves. That is what keeps it Tier-1
 * compliant regardless of how R3.7 is answered, and it is also just how a
 * reference chart should work.
 *
 * _Requirements: 17.1, 17.2_
 */
import type { Metadata } from 'next';

import { getBreakpoints } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Leveling & econ breakpoints',
  description:
    'Static XP and gold breakpoints for the current TFT patch — a reference chart, not a live calculator.',
};

export default async function ReferencePage() {
  const result = await getBreakpoints();

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Leveling &amp; econ breakpoints</h1>
        <p className="page-lede">
          Standard XP and gold costs for the current patch. Work out your own line from here — this
          is a chart, deliberately not a calculator wired to your game.
        </p>
      </header>

      {!result.ok ? (
        <div className="tftc-stale-banner" role="status">
          <span className="tftc-stale-banner__icon" aria-hidden="true">
            ⚠
          </span>
          <span>Couldn&apos;t load the reference: {result.detail}</span>
        </div>
      ) : (
        <>
          <section className="comp-detail__section">
            <h2>Level costs</h2>
            {result.data.rows.length === 0 ? (
              <p className="empty-state">
                No breakpoint data loaded for patch {result.data.patch} yet.
              </p>
            ) : (
              <table className="tftc-table">
                <thead>
                  <tr>
                    <th scope="col">Level</th>
                    <th scope="col">XP to reach</th>
                    <th scope="col">Gold to buy it</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.rows.map((row) => (
                    <tr key={row.level}>
                      <th scope="row">{row.level}</th>
                      <td>{row.xpToReach}</td>
                      <td>{row.goldToBuyXp}</td>
                      <td>{row.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="comp-detail__section">
            <h2>Interest</h2>
            <p className="comp-detail__prose">
              You earn 1 extra gold per full {result.data.interestThresholds[0] ?? 10} gold banked,
              up to a cap.
            </p>
            <ul className="augment-list">
              {result.data.interestThresholds.map((threshold, index) => (
                <li key={threshold}>
                  {threshold}g → +{index + 1}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
