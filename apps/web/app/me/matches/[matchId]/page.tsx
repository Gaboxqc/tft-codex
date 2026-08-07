/**
 * Match review (task 3.9, R4.3, R4.5, R15).
 *
 * The coaching narrative leads, because a sentence naming the turn the game
 * slipped is more useful than a table — that is the differentiation
 * `review-and-roadmap.md` §2 identifies. The numbers follow for anyone who
 * prefers them, and R15.4's opt-out means the narrative can be absent
 * entirely, so the stat view has to stand on its own.
 *
 * The curve section says plainly that it holds one endpoint rather than a
 * per-round trace. Riot's TFT API exposes no match timeline; drawing a line
 * through a single point would imply data we do not have.
 *
 * _Requirements: 4.3, 4.5, 15.1, 15.2, 15.4_
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { getCoaching, getMatchReview } from '@/lib/api';
import { sessionCookie } from '@/lib/session';
import { SignInPrompt } from '../../../_components/SignInPrompt';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Match review' };

interface MatchPageProps {
  params: Promise<{ matchId: string }>;
}

const signalLabel: Record<string, string> = {
  'leveling-timing': 'Leveling',
  'econ-deviation': 'Economy',
  'itemization-completeness': 'Items',
  'augment-fit': 'Augments',
  positioning: 'Positioning',
};

export default async function MatchReviewPage({ params }: MatchPageProps) {
  const { matchId } = await params;
  const cookie = await sessionCookie();

  if (!cookie) {
    return <SignInPrompt redirectTo={`/me/matches/${matchId}`} what="this match review" />;
  }

  const review = await getMatchReview(cookie, matchId);

  if (!review.ok) {
    if (review.reason === 'unauthenticated') {
      return <SignInPrompt redirectTo={`/me/matches/${matchId}`} what="this match review" />;
    }
    return (
      <div className="tftc-stale-banner" role="status">
        <span className="tftc-stale-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <span>
          {review.reason === 'not-found'
            ? "That match isn't in your synced history."
            : `Couldn't load the review: ${review.detail}`}
        </span>
      </div>
    );
  }

  // A 409 here means the account opted out of narrative text (R15.4), which is
  // a preference rather than a failure — the stat view below covers it.
  const coaching = await getCoaching(cookie, matchId);
  const data = review.data;

  return (
    <article className="comp-detail">
      <header className="comp-detail__head">
        <Link href="/me" className="comp-detail__back">
          ← Dashboard
        </Link>
        <h1 className="page-title">
          #{data.match.placement} · {data.baseline.compName ?? 'Unrecognised board'}
        </h1>
        <p className="comp-detail__meta">
          Patch {data.match.patch} · {new Date(data.match.timestamp).toUTCString()}
        </p>
      </header>

      {coaching.ok && (
        <section className="comp-detail__section coaching">
          <h2>What happened</h2>
          <p className="coaching__narrative">{coaching.data.narrative}</p>
        </section>
      )}

      <section className="comp-detail__section">
        <h2>What to change</h2>
        <ul className="suggestion-list">
          {data.suggestions.map((suggestion, index) => (
            <li key={`${suggestion.signal}-${index}`}>
              <span className="suggestion-list__tag">
                {signalLabel[suggestion.signal] ?? suggestion.signal}
                {suggestion.round ? ` · ${suggestion.round}` : ''}
              </span>
              <span>{suggestion.message}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="comp-detail__section">
        <h2>Versus top-4 finishers</h2>

        {data.baseline.sampleSize === 0 ? (
          <p className="empty-state">
            No top-4 baseline for this comp on patch {data.match.patch} yet — it needs a few more
            games in the pool before a comparison means anything.
          </p>
        ) : (
          <>
            <CurveTable title="Level" rows={data.levelDeviations} />
            <CurveTable title="Gold" rows={data.goldDeviations} />
            <p className="comp-detail__note">
              Compared against {data.baseline.sampleSize} top-4 finisher
              {data.baseline.sampleSize === 1 ? '' : 's'} on this comp.
            </p>
          </>
        )}

        {data.curveSource === 'final-state' && (
          <p className="comp-detail__note">
            This compares your state at the round you were eliminated. Riot&apos;s match API
            doesn&apos;t expose a per-round history for TFT, so a full curve needs the desktop
            companion recording it live — that&apos;s coming with the Overwolf app.
          </p>
        )}
      </section>
    </article>
  );
}

function CurveTable({
  title,
  rows,
}: {
  title: string;
  rows: { round: string; actual: number; baseline: number; delta: number }[];
}) {
  if (rows.length === 0) return null;

  return (
    <>
      <h3>{title}</h3>
      <table className="tftc-table">
        <thead>
          <tr>
            <th scope="col">Round</th>
            <th scope="col">You</th>
            <th scope="col">Top 4</th>
            <th scope="col">Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.round}>
              <th scope="row">{row.round}</th>
              <td>{row.actual.toFixed(1)}</td>
              <td>{row.baseline.toFixed(1)}</td>
              {/*
                Sign and colour both, never colour alone (design-system.md §7).
              */}
              <td className={row.delta < 0 ? 'delta delta--behind' : 'delta delta--ahead'}>
                {row.delta > 0 ? '+' : ''}
                {row.delta.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
