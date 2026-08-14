/**
 * Comp builder (task 4.1).
 *
 * Works signed out (R7.4). Accepts `?import=<compId>` so the comp detail page
 * can hand a board straight into the editor (R6.5).
 *
 * _Requirements: 6.1, 6.2, 6.5, 7.4_
 */
import type { Metadata } from 'next';

import { getComp } from '@/lib/api';
import { BoardEditor } from '../_components/BoardEditor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Comp builder',
  description:
    'Build and share a TFT board, with live trait counts and a rough board-strength estimate.',
};

interface BuilderPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function BuilderPage({ searchParams }: BuilderPageProps) {
  const importId = single((await searchParams)['import']);

  // R6.5 — importing a tracked comp pre-fills the editor with its units and
  // their guide items, so a player starts from the real thing rather than
  // retyping it.
  const imported = importId ? await getComp(importId) : null;

  const initialUnits = imported?.ok
    ? imported.data.units.map((unit) => ({
        championId: unit.championId,
        starLevel: unit.starTarget,
        itemIds: unit.items.slice(0, 3),
      }))
    : [];

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Comp builder</h1>
        <p className="page-lede">
          Trait counts update as you edit. Save to get a link that reconstructs the exact board — no
          account needed.
        </p>
      </header>

      {importId && !imported?.ok && (
        <div className="tftc-stale-banner" role="status">
          <span className="tftc-stale-banner__icon" aria-hidden="true">
            ⚠
          </span>
          <span>Couldn&apos;t import that comp — starting from an empty board instead.</span>
        </div>
      )}

      <BoardEditor
        initialUnits={initialUnits}
        {...(imported?.ok ? { initialName: `${imported.data.name} (copy)` } : {})}
      />
    </>
  );
}
