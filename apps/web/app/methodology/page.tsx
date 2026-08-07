/**
 * The published scoring formula.
 *
 * R1.3 requires tiers come from "a documented composite score, not an
 * editorially assigned label". Publishing the formula is also the trust
 * differentiator identified in review-and-roadmap.md §2 — no competitor does
 * it — so this page is product, not just compliance.
 *
 * _Requirements: 1.3, 1.4_
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'How tiers are computed',
};

export default function MethodologyPage() {
  return (
    <>
      <h1 className="page-title">How tiers are computed</h1>
      <p className="page-lede">
        Every comp&apos;s tier comes from one formula applied to real ranked match data. No comp is
        promoted or demoted by hand.
      </p>

      <section className="placeholder-card">
        <h2>The composite score</h2>
        <p>
          score = (0.45 × top-4 rate) + (0.35 × average placement) + (0.20 × play rate), each
          normalised within the current patch.
        </p>
        <p>
          Tiers are then assigned by percentile against that patch&apos;s own distribution: S at or
          above the 90th percentile, A at 70, B at 45, C below. Thresholds are recomputed every
          patch, so a tier always means &ldquo;relative to what is being played right now&rdquo;
          rather than against a fixed historical bar.
        </p>
        <p>
          A comp below the minimum sample size for the current patch is marked provisional instead
          of being given a tier it hasn&apos;t earned.
        </p>
      </section>
    </>
  );
}
