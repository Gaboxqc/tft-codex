/**
 * Global footer.
 *
 * Carries the Riot disclaimer required on every client (R12.3) and the privacy
 * policy link required by R12.4. Both are global rather than page-level so a
 * new page cannot ship without them.
 *
 * _Requirements: 12.3, 12.4_
 */
import Link from 'next/link';
import { RiotDisclaimer } from '@tft-codex/ui';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav className="site-footer__links" aria-label="Legal">
        <Link href="/privacy">Privacy policy</Link>
        <Link href="/methodology">How tiers are computed</Link>
      </nav>
      <RiotDisclaimer />
    </footer>
  );
}
