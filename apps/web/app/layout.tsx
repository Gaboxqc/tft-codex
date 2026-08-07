/**
 * Root layout.
 *
 * Two things are mounted here on purpose rather than per-page:
 * - The Riot legal disclaimer, which R12.3 requires on every client screen.
 * - The shared design-token stylesheet from packages/ui, so web and the
 *   Overwolf overlay resolve the same tokens (R10.2).
 *
 * _Requirements: 10.2, 12.3_
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@tft-codex/ui/styles.css';
import './globals.css';

import { SiteFooter } from './_components/SiteFooter';
import { SiteHeader } from './_components/SiteHeader';

export const metadata: Metadata = {
  title: {
    default: 'TFT Codex',
    template: '%s · TFT Codex',
  },
  description:
    'A data-backed Teamfight Tactics meta engine: live-computed tier list, comp explorer and augment reference, with a published scoring formula.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="tftc-root">
        <a className="tftc-skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="site-main">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
