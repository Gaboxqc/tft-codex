/**
 * Privacy policy (task 3.11).
 *
 * R12.4 asks for what is collected, why, and how to request deletion,
 * consistent with GDPR/CCPA data-subject rights.
 *
 * Every claim below is one the code actually enforces, and the enforcement is
 * named so it can be checked rather than trusted:
 *
 * - "PUUID, region and Riot ID only" — that is what linking an account stores.
 *   There is no password column at all. There is an optional
 *   `notification_email`, which is null unless the player typed one into the
 *   notifications page for that purpose (task 6.6) — described below, because
 *   a privacy page that lags the schema is worse than either alone.
 * - "deleted within 30 days" — every personal table cascades from that row, so
 *   deleting it removes the derived data too. `push_subscriptions` and
 *   `friendships` cascade the same way.
 * - The friends section describes the only path by which one player sees
 *   another's data (task 6.8), and states the exact three fields shared.
 * - "we never see your password" — RSO is the only auth path; no endpoint in
 *   this codebase accepts a credential.
 *
 * A policy that promises more than the schema can deliver is worse than none,
 * so if any of this changes, the migration and this page change together.
 *
 * _Requirements: 4.6, 7.2, 7.3, 7.4, 12.4_
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What TFT Codex stores about you, why, and how to have it deleted.',
};

export default function PrivacyPage() {
  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Privacy policy</h1>
        <p className="page-lede">
          The short version: you can use almost all of TFT Codex without an account, and if you do
          link one, we store three things about you — plus an email address only if you volunteer
          one for notifications — and delete them all on request.
        </p>
      </header>

      <section className="comp-detail__section">
        <h2>You don&apos;t need an account</h2>
        <p className="comp-detail__prose">
          The tier list, comp explorer, augment reference, breakpoint chart and the &ldquo;what
          should I pick&rdquo; widget all work signed out. Linking a Riot account adds your own
          match history and coaching on top; it unlocks nothing else.
        </p>
      </section>

      <section className="comp-detail__section">
        <h2>What we store if you link an account</h2>
        <ul className="policy-list">
          <li>
            <strong>Your PUUID</strong> — Riot&apos;s permanent player identifier. It is how we know
            which matches are yours.
          </li>
          <li>
            <strong>Your region</strong> — needed to query the right Riot endpoints.
          </li>
          <li>
            <strong>Your Riot ID display name</strong> — so the app can show who you are signed in
            as.
          </li>
          <li>
            <strong>Your own ranked TFT matches</strong> — placement, the comp we detected, the
            augments you were offered, and your level and gold at the round you were eliminated.
          </li>
        </ul>
        <p className="comp-detail__prose">
          We store no password, because sign-in goes through <strong>Riot Sign-On</strong> and we
          never receive a credential in the first place. There is no field anywhere in TFT Codex
          that asks for your Riot password — if you are ever shown one, it is not us.
        </p>
        <p className="comp-detail__prose">
          The only thing we hold beyond that list is an{' '}
          <strong>email address, if you choose to give us one</strong> for notifications. Linking
          your Riot account does not give us an address and we never ask Riot for one — it exists
          only if you type it into the notifications page yourself. We send nothing to it until you
          confirm it by clicking a link we mail there, we use it for nothing but the notifications
          you switched on, we never share or sell it, and removing it is one button on that same
          page. Unlinking your account deletes it along with everything else.
        </p>
      </section>

      <section className="comp-detail__section">
        <h2>Friends, if you turn them on</h2>
        <p className="comp-detail__prose">
          Friends is the only feature in TFT Codex where another person sees anything about you, and
          it is <strong>off unless you switch it on</strong>. While it is off you cannot be found by
          Riot ID, cannot be sent requests, and appear on nobody&apos;s comparison.
        </p>
        <p className="comp-detail__prose">
          With it on, a player who knows your Riot ID can send you a request. If you accept, the two
          of you can see each other&apos;s{' '}
          <strong>games played, average placement and top-4 rate</strong>. That is the entire list.
          Not your match history, not which comps you played, not which augments you took, and not
          your PUUID — that identifier never leaves our servers.
        </p>
        <p className="comp-detail__prose">
          Turning friends off deletes every connection and pending request immediately. Turning it
          back on later starts from nothing, so anyone who was connected to you has to ask again.
        </p>
      </section>

      <section className="comp-detail__section">
        <h2>Other players</h2>
        <p className="comp-detail__prose">
          Your matches contain seven other people. We use their final boards in memory to work out
          which comps were being played and to build the top-4 baselines your review compares
          against — and we do not store anything against their identity. The averages you see are
          aggregates with no player attached to them.
        </p>
        <p className="comp-detail__prose">
          The desktop companion&apos;s pre-game lobby panel reads public match history for the
          players in your lobby, exactly once before the round starts. It is never refreshed during
          a match, and it never shows what anyone is doing on their board while you play.
        </p>
      </section>

      <section className="comp-detail__section">
        <h2>Deleting your data</h2>
        <p className="comp-detail__prose">
          Unlinking is one action, from your dashboard. The moment you do it we stop serving your
          data and every session is signed out. Your profile and everything derived from it —
          matches, coaching narratives, preferences — is permanently deleted within 30 days.
        </p>
        <p className="comp-detail__prose">
          The gap exists so an accidental unlink can be reversed and so the deletion is auditable.
          Nothing is served from a profile marked for deletion in the meantime.
        </p>
      </section>

      <section className="comp-detail__section">
        <h2>Where the data comes from</h2>
        <p className="comp-detail__prose">
          Everything statistical here is computed from the official Riot Games TFT API. We do not
          scrape other sites. The formula behind our tier list is{' '}
          <Link href="/methodology">published in full</Link>.
        </p>
      </section>

      <section className="comp-detail__section">
        <h2>Contact</h2>
        <p className="comp-detail__prose">
          For a copy of your data or any question about this policy, get in touch and we will
          respond within the timeframes GDPR and CCPA require.
        </p>
      </section>
    </>
  );
}
