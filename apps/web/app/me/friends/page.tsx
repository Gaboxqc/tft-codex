/**
 * Friends and the comparison leaderboard (task 6.8).
 *
 * The one page in TFT Codex where another player's data appears, which is why
 * the opt-in gate is the page rather than a setting inside it.
 *
 * _Requirements: 4.6, 4.7, 7.1_
 */
import type { Metadata } from 'next';

import { getFriendLeaderboard, getFriends } from '@/lib/api';
import { sessionCookie } from '@/lib/session';
import { FriendsPanel } from '../../_components/FriendsPanel';
import { SignInPrompt } from '../../_components/SignInPrompt';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Friends',
};

export default async function FriendsPage() {
  const cookie = await sessionCookie();
  if (!cookie) {
    return <SignInPrompt redirectTo="/me/friends" what="a comparison with your friends" />;
  }

  const friends = await getFriends(cookie);

  if (!friends.ok) {
    return friends.reason === 'unauthenticated' ? (
      <SignInPrompt redirectTo="/me/friends" what="a comparison with your friends" />
    ) : (
      <div className="tftc-stale-banner" role="status">
        <span className="tftc-stale-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <span>Couldn&apos;t load your friends: {friends.detail}</span>
      </div>
    );
  }

  // Only fetched once the viewer has opted in — the endpoint 403s otherwise,
  // and asking for it anyway would put an expected failure in the logs.
  const leaderboard = friends.data.optedIn ? await getFriendLeaderboard(cookie) : null;

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Friends</h1>
        <p className="page-lede">Optional, off by default, and limited to three numbers each.</p>
      </header>

      <FriendsPanel
        initial={friends.data}
        leaderboard={leaderboard?.ok ? leaderboard.data : null}
      />
    </>
  );
}
