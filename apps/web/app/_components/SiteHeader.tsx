/**
 * Global header.
 *
 * No Riot logo or Riot brand mark anywhere (R12.3). The wordmark is plain text
 * for now; design-system.md §9 specifies the eventual cyan geometric mark, to
 * be tested at both 256px and ~32px before it is finalised.
 *
 * _Requirements: 11.3, 12.3_
 */
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/', label: 'Tier list' },
  { href: '/comps', label: 'Comps' },
  { href: '/augments', label: 'Augments' },
  { href: '/builder', label: 'Builder' },
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="site-header__wordmark">
        TFT<span>Codex</span>
      </Link>
      <nav aria-label="Primary">
        <ul className="site-header__nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
