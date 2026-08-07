/**
 * Tier list landing page — a placeholder until Phase 1 task 1.11 builds the
 * real thing against `GET /v1/meta/tier-list`.
 *
 * It exists now so the Phase 0 shell is verifiably wired: shared tokens
 * resolve, the layout renders, and the Riot disclaimer (R12.3) is present on a
 * real page rather than only in a test.
 */
import { TierBadge, TrendIndicator } from '@tft-codex/ui';

export default function HomePage() {
  return (
    <>
      <h1 className="page-title">Live tier list</h1>
      <p className="page-lede">
        Every tier here is computed from real ranked match data, using a scoring formula we publish
        rather than hide. Nothing on this page is hand-picked.
      </p>

      <div className="placeholder-grid">
        <section className="placeholder-card">
          <h2>
            Coming in Phase 1 <TierBadge tier="provisional" />
          </h2>
          <p>
            The crawler, aggregation job and tier-scoring formula land in tasks 1.1–1.11. This page
            renders the shared design tokens and components in the meantime.
          </p>
        </section>

        <section className="placeholder-card">
          <h2>
            Tier badges <TierBadge tier="S" />
          </h2>
          <p>
            Letter only, never a number beside it — a figure next to a tier reads as a stat, which
            is exactly what Riot&apos;s augment display restriction forbids.
          </p>
        </section>

        <section className="placeholder-card">
          <h2>Trend</h2>
          <p>
            <TrendIndicator trend="rising" /> — trend carries a glyph, not just a hue, so the
            information survives for colorblind users.
          </p>
        </section>
      </div>
    </>
  );
}
