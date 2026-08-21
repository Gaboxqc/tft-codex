/**
 * Personal dashboard (task 3.9, R4.4).
 *
 * Average placement by comp over the account's synced history. Note what is
 * absent: no breakdown by augment. R4.7 gates that on Riot's written answer
 * (task 3.12), and the API does not send it — so there is nothing here to
 * render even if someone added the markup.
 *
 * _Requirements: 4.1, 4.4, 4.7, 7.4_
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { getAnalytics, getMyMatches, getProfile } from '@/lib/api';
import { sessionCookie } from '@/lib/session';
import { SignInPrompt } from '../_components/SignInPrompt';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your dashboard',
};

/** Placement 1 is best, 8 worst — colour accordingly, and never by hue alone. */
const placementTone = (average: number): string =>
  average <= 4 ? 'good' : average <= 4.5 ? 'even' : 'poor';

export default async function DashboardPage() {
  const cookie = await sessionCookie();
  if (!cookie) {
    return <SignInPrompt redirectTo="/me" what="your placement history" />;
  }

  const [profile, analytics, matches] = await Promise.all([
    getProfile(cookie),
    getAnalytics(cookie),
    getMyMatches(cookie, 10),
  ]);

  if (!profile.ok) {
    return profile.reason === 'unauthenticated' ? (
      <SignInPrompt redirectTo="/me" what="your placement history" />
    ) : (
      <div className="tftc-stale-banner" role="status">
        <span className="tftc-stale-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <span>Couldn&apos;t load your profile: {profile.detail}</span>
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">{profile.data.riotId}</h1>
        <p className="page-lede">
          {profile.data.lastSyncedAt
            ? `Last synced ${new Date(profile.data.lastSyncedAt).toUTCString()}.`
            : 'Your matches are syncing — check back shortly.'}
        </p>
        <p className="comp-detail__actions">
          <Link className="tftc-btn tftc-btn--secondary" href="/me/notifications">
            Notifications and follows
          </Link>
          <Link className="tftc-btn tftc-btn--secondary" href="/me/friends">
            Friends
          </Link>
        </p>
      </header>

      {analytics.ok && analytics.data.totalGames > 0 && (
        <section className="comp-detail__section">
          <h2>Overall</h2>
          <dl className="stat-row tftc-stat">
            <div>
              <dt>Games</dt>
              <dd>{analytics.data.totalGames.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Avg placement</dt>
              <dd>{analytics.data.overallAvgPlacement?.toFixed(2) ?? '—'}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="comp-detail__section">
        <h2>By comp</h2>
        {!analytics.ok || analytics.data.byComp.length === 0 ? (
          <p className="empty-state">
            No synced games yet. Once your match history imports, your placement by comp shows up
            here.
          </p>
        ) : (
          <table className="tftc-table">
            <thead>
              <tr>
                <th scope="col">Comp</th>
                <th scope="col">Games</th>
                <th scope="col">Avg placement</th>
              </tr>
            </thead>
            <tbody>
              {analytics.data.byComp.map((entry) => (
                <tr key={entry.compId ?? 'unmatched'}>
                  <th scope="row">
                    {entry.compId ? (
                      <Link href={`/comps/${entry.compId}`}>{entry.compName ?? entry.compId}</Link>
                    ) : (
                      <span className="dashboard__unmatched">Unrecognised boards</span>
                    )}
                  </th>
                  <td>{entry.games}</td>
                  <td
                    className={`dashboard__placement dashboard__placement--${placementTone(entry.avgPlacement)}`}
                  >
                    {entry.avgPlacement.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="comp-detail__section">
        <h2>Recent matches</h2>
        {!matches.ok || matches.data.matches.length === 0 ? (
          <p className="empty-state">Nothing synced yet.</p>
        ) : (
          <ul className="match-list">
            {matches.data.matches.map((match) => (
              <li key={match.matchId}>
                <Link href={`/me/matches/${encodeURIComponent(match.matchId)}`}>
                  <span
                    className={`match-list__placement match-list__placement--${placementTone(match.placement)}`}
                  >
                    #{match.placement}
                  </span>
                  <span className="match-list__comp">
                    {match.detectedCompId ?? 'Unrecognised board'}
                  </span>
                  <span className="match-list__when">
                    {new Date(match.timestamp).toUTCString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="comp-detail__note">
        Want this gone? <Link href="/privacy">Unlinking</Link> stops us serving your data
        immediately and deletes it within 30 days.
      </p>
    </>
  );
}
