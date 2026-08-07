/**
 * Privacy policy stub.
 *
 * The full text is task 3.11, once account linking exists and there is real
 * data handling to describe. The route exists now because the footer links to
 * it on every page and a dead link in the legal footer is worse than a stub.
 *
 * _Requirements: 12.4_
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy policy',
};

export default function PrivacyPage() {
  return (
    <>
      <h1 className="page-title">Privacy policy</h1>
      <p className="page-lede">
        The full policy is written in task 3.11, alongside account linking. What follows is the
        commitment the architecture already enforces.
      </p>

      <section className="placeholder-card">
        <h2>What gets stored</h2>
        <p>
          If you link a Riot account, we store your PUUID, region and Riot ID display name — no
          password, and no unrelated personal data. Riot Sign-On handles authentication; we never
          see your credentials.
        </p>
        <p>
          Unlinking deletes your profile and every derived personal analytic within 30 days. You can
          use the tier list, comp explorer, augment reference and builder without linking anything.
        </p>
      </section>
    </>
  );
}
