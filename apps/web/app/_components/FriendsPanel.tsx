/**
 * Friends and the comparison leaderboard (task 6.8).
 *
 * The opt-in is the whole screen, not a checkbox on it. Someone who has not
 * joined sees an explanation of what joining means and a single button — no
 * search field, no list, nothing that implies the feature is already running.
 *
 * Turning it off says plainly that it deletes the connections, because it
 * does. Rejoining starts from nothing, which is the only behaviour that keeps
 * the other person's consent meaningful.
 *
 * _Requirements: 4.6, 4.7, 7.1, 11.3_
 */
'use client';

import { useState, useTransition } from 'react';

import {
  acceptFriendRequest,
  removeFriend,
  sendFriendRequest,
  setFriendsOptIn,
  type FriendRequestView,
  type FriendsView,
  type LeaderboardRowView,
} from '@/lib/api';

export interface FriendsPanelProps {
  initial: FriendsView;
  leaderboard: { rows: LeaderboardRowView[]; standing: string } | null;
}

export function FriendsPanel({ initial, leaderboard }: FriendsPanelProps) {
  const [optedIn, setOptedIn] = useState(initial.optedIn);
  const [pending, setPending] = useState<FriendRequestView[]>(initial.pending);
  const [riotId, setRiotId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const toggleOptIn = (next: boolean): void => {
    startTransition(async () => {
      const result = await setFriendsOptIn(next);
      if (!result.ok) return setMessage(result.detail);

      setOptedIn(next);
      setMessage(
        next
          ? 'Friends is on. Others can now find you by your Riot ID.'
          : 'Friends is off, and your connections have been deleted.',
      );
      if (!next) setPending([]);
    });
  };

  const invite = (): void => {
    startTransition(async () => {
      const result = await sendFriendRequest(riotId.trim());
      if (!result.ok) {
        setMessage(
          result.reason === 'not-found'
            ? 'No player with that Riot ID has friends turned on.'
            : result.detail,
        );
        return;
      }

      setRiotId('');
      setMessage(
        result.data.outcome === 'accepted'
          ? `You and ${result.data.riotId} are now friends — they had already sent you a request.`
          : result.data.outcome === 'exists'
            ? `You already have a connection with ${result.data.riotId}.`
            : `Request sent to ${result.data.riotId}.`,
      );
    });
  };

  const respond = (request: FriendRequestView, accept: boolean): void => {
    startTransition(async () => {
      const result = accept
        ? await acceptFriendRequest(request.riotId)
        : await removeFriend(request.riotId);

      if (!result.ok) return setMessage(result.detail);

      setPending((current) => current.filter((entry) => entry.riotId !== request.riotId));
      setMessage(accept ? `You and ${request.riotId} are now friends.` : 'Request removed.');
    });
  };

  if (!optedIn) {
    return (
      <section className="comp-detail__section">
        <h2>Friends</h2>
        <p className="comp-detail__prose">
          Friends is off. Turning it on lets other players find you by your Riot ID and send you a
          request — and once you both accept, you can see each other&apos;s average placement, games
          played and top-4 rate.
        </p>
        <p className="comp-detail__prose">
          That is the whole of what is shared: three numbers. Never your match history, never which
          comps you played, never anything about augments. You can turn it back off at any time,
          which deletes every connection.
        </p>
        <p className="comp-detail__actions">
          <button
            type="button"
            className="tftc-btn tftc-btn--primary"
            disabled={busy}
            onClick={() => toggleOptIn(true)}
          >
            Turn on friends
          </button>
          <span role="status" aria-live="polite">
            {message ?? ''}
          </span>
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="comp-detail__section">
        <h2>Add a friend</h2>
        <div className="delivery-row__form">
          <label className="tftc-sr-only" htmlFor="friend-riot-id">
            Riot ID, including the tag
          </label>
          <input
            id="friend-riot-id"
            className="tftc-input"
            value={riotId}
            placeholder="Name#TAG"
            onChange={(event) => setRiotId(event.target.value)}
          />
          <button
            type="button"
            className="tftc-btn tftc-btn--primary"
            disabled={busy || !riotId.includes('#')}
            onClick={invite}
          >
            Send request
          </button>
        </div>
        <p role="status" aria-live="polite" className="bookmark-btn__status">
          {message ?? ''}
        </p>
      </section>

      {pending.length > 0 && (
        <section className="comp-detail__section">
          <h2>Requests</h2>
          <ul className="bookmark-list">
            {pending.map((request) => (
              <li key={request.riotId}>
                <span>{request.riotId}</span>
                <span className="bookmark-list__kind">
                  {request.direction === 'incoming' ? 'wants to connect' : 'awaiting their reply'}
                </span>
                <span className="delivery-row__form">
                  {request.direction === 'incoming' && (
                    <button
                      type="button"
                      className="tftc-btn tftc-btn--primary tftc-btn--compact"
                      disabled={busy}
                      onClick={() => respond(request, true)}
                    >
                      Accept
                    </button>
                  )}
                  <button
                    type="button"
                    className="tftc-btn tftc-btn--secondary tftc-btn--compact"
                    disabled={busy}
                    onClick={() => respond(request, false)}
                  >
                    {request.direction === 'incoming' ? 'Decline' : 'Cancel'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="comp-detail__section">
        <h2>How you compare</h2>
        {!leaderboard || leaderboard.rows.length <= 1 ? (
          <p className="empty-state">
            Add a friend and you&apos;ll both show up here. Averages only — no match history.
          </p>
        ) : (
          <>
            <p className="comp-detail__prose">{leaderboard.standing}</p>
            <table className="tftc-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col">Games</th>
                  <th scope="col">Avg placement</th>
                  <th scope="col">Top 4</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.rows.map((row) => (
                  <tr key={row.riotId} className={row.isYou ? 'leaderboard__you' : undefined}>
                    <td>{row.rank ?? '—'}</td>
                    <th scope="row">
                      {row.riotId}
                      {/* Marked in text, not by colour alone (R11.3). */}
                      {row.isYou && <span className="bookmark-list__kind"> you</span>}
                    </th>
                    <td>{row.games.toLocaleString()}</td>
                    <td>{row.avgPlacement?.toFixed(2) ?? '—'}</td>
                    <td>
                      {row.top4Rate === null ? '—' : `${(row.top4Rate * 100).toFixed(0)}%`}
                      {row.provisional && (
                        <span className="bookmark-list__kind"> too few games to rank</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="comp-detail__section">
        <h2>Turning it off</h2>
        <p className="comp-detail__prose">
          Turning friends off deletes every connection and every pending request, and removes you
          from your friends&apos; boards. Turning it back on later starts from nothing.
        </p>
        <p>
          <button
            type="button"
            className="tftc-btn tftc-btn--secondary"
            disabled={busy}
            onClick={() => toggleOptIn(false)}
          >
            Turn off friends
          </button>
        </p>
      </section>
    </>
  );
}
