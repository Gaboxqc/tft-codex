/**
 * A shared board (task 4.3).
 *
 * R6.3: the link reconstructs the exact board when opened. It loads into a
 * live editor rather than a read-only view — someone handed a board almost
 * always wants to try a change to it, and a "copy to edit" step in between is
 * friction for no benefit. Saving creates a new board; the original is
 * untouched unless its owner saves over it.
 *
 * _Requirements: 6.3, 6.4, 7.4_
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getBoard } from '@/lib/api';
import { BoardEditor } from '../../_components/BoardEditor';

export const dynamic = 'force-dynamic';

interface SharedBoardProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: SharedBoardProps): Promise<Metadata> {
  const result = await getBoard((await params).id);
  return { title: result.ok ? result.data.board.name : 'Shared board' };
}

export default async function SharedBoardPage({ params }: SharedBoardProps) {
  const { id } = await params;
  const result = await getBoard(id);

  if (!result.ok && result.reason === 'not-found') notFound();

  if (!result.ok) {
    return (
      <div className="tftc-stale-banner" role="status">
        <span className="tftc-stale-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <span>Couldn&apos;t load that board: {result.detail}</span>
      </div>
    );
  }

  const { board, matchedComp } = result.data;

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">{board.name}</h1>
        <p className="page-lede">
          Built for level {board.level} on patch {board.patch}
          {matchedComp ? ` · plays like ${matchedComp.name}` : ''}. Edit freely — saving creates
          your own copy.
        </p>
      </header>

      <BoardEditor initialUnits={board.units} initialName={board.name} initialLevel={board.level} />
    </>
  );
}
