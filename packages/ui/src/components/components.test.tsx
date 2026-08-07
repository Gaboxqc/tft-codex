import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AugmentChip } from './AugmentChip.js';
import { Button } from './Button.js';
import { RIOT_DISCLAIMER_TEXT, RiotDisclaimer } from './RiotDisclaimer.js';
import { StaleDataBanner } from './StaleDataBanner.js';
import { TierBadge } from './TierBadge.js';
import { TrendIndicator } from './TrendIndicator.js';

describe('RiotDisclaimer (_Requirements: 12.3_)', () => {
  it('renders the required wording', () => {
    render(<RiotDisclaimer />);
    expect(screen.getByTestId('riot-disclaimer')).toHaveTextContent(/isn't endorsed by Riot Games/);
    expect(RIOT_DISCLAIMER_TEXT).toContain('Riot Games and all associated properties');
  });

  it('renders no image, so no Riot logo can slip in', () => {
    const { container } = render(<RiotDisclaimer />);
    expect(container.querySelectorAll('img, svg')).toHaveLength(0);
  });

  it('offers a compact variant for the 12px overlay scale', () => {
    render(<RiotDisclaimer variant="compact" />);
    expect(screen.getByTestId('riot-disclaimer')).toHaveClass('tftc-disclaimer--compact');
  });
});

describe('TierBadge (_Requirements: 1.3, 1.4, 3.1, 11.3_)', () => {
  it('renders the letter, so tier is never conveyed by color alone', () => {
    render(<TierBadge tier="S" />);
    expect(screen.getByText('S')).toBeInTheDocument();
  });

  it('renders provisional without implying a confident rank', () => {
    render(<TierBadge tier="provisional" />);
    expect(screen.getByText('Provisional')).toBeInTheDocument();
    expect(screen.getByText(/not enough games this patch/)).toBeInTheDocument();
  });

  it('renders no numeric content that could be mistaken for a stat', () => {
    // R3.1 at the component level: the props type has no numeric slot, and the
    // rendered output must not contain one either.
    const { container } = render(<TierBadge tier="A" />);
    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe('AugmentChip (_Requirements: 3.1, 3.2, 3.3_)', () => {
  it('renders play rate, which R3.3 explicitly permits', () => {
    render(<AugmentChip name="Pandora's Items" tier="A" playRate={0.094} />);
    expect(screen.getByText('9.4% picked')).toBeInTheDocument();
  });

  it('renders a qualitative reason, never a numeric justification', () => {
    render(
      <AugmentChip
        name="Sorcerer Heart"
        tier="S"
        reason="Fits the Sorcerer core you already have on board."
      />,
    );
    expect(screen.getByText(/Fits the Sorcerer core/)).toBeInTheDocument();
  });

  it('renders no number at all when play rate is omitted', () => {
    const { container } = render(
      <AugmentChip name="Sorcerer Heart" tier="S" reason="Fits your front line." />,
    );
    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe('Button (_Requirements: 11.3_)', () => {
  it('uses the primary variant class that carries the dark-on-cyan rule', () => {
    // White on cyan-400 is 1.81:1 and fails WCAG. The rule lives in the
    // stylesheet keyed to this class, so asserting the class is asserting the
    // contrast decision (design-system.md §2).
    render(<Button variant="primary">Open comp</Button>);
    expect(screen.getByRole('button')).toHaveClass('tftc-btn--primary');
  });

  it('defaults to type="button" so it cannot accidentally submit a form', () => {
    render(<Button>Filter</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

describe('TrendIndicator (_Requirements: 8.3, 11.3_)', () => {
  it('carries a glyph and a label, not just a hue', () => {
    render(<TrendIndicator trend="rising" />);
    expect(screen.getByText('↑')).toBeInTheDocument();
    expect(screen.getByText('Rising')).toBeInTheDocument();
  });

  it('flags a meta shift when a comp moved more than one tier', () => {
    render(<TrendIndicator trend="falling" metaShift />);
    expect(screen.getByText(/meta shift/)).toBeInTheDocument();
  });
});

describe('StaleDataBanner (_Requirements: 1.5, 1.6_)', () => {
  const now = new Date('2026-08-07T12:00:00.000Z');

  it('states how stale the data is and which patch it belongs to', () => {
    render(<StaleDataBanner lastRefreshedAt="2026-08-07T09:30:00.000Z" patch="17.9" now={now} />);
    const banner = screen.getByTestId('stale-data-banner');
    expect(banner).toHaveTextContent('2 hours');
    expect(banner).toHaveTextContent('17.9');
  });

  it('is a status region, not a dismissible toast', () => {
    render(<StaleDataBanner lastRefreshedAt="2026-08-07T11:15:00.000Z" patch="17.9" now={now} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('degrades gracefully on an unparseable timestamp instead of rendering NaN', () => {
    render(<StaleDataBanner lastRefreshedAt="not-a-date" patch="17.9" now={now} />);
    expect(screen.getByTestId('stale-data-banner')).toHaveTextContent('an unknown time');
  });
});
