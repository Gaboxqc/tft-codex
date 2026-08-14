/**
 * Board editor (tasks 4.1, 4.2, 4.5).
 *
 * design.md's task text allows "simplified front/back rows if full hex
 * geometry is deferred", and that is the call here. Hex placement matters for
 * *positioning* — which unit the enemy assassin jumps to — and this builder
 * does not simulate a fight (design.md §1), so a hex grid would imply a
 * precision the rest of the tool cannot honour. Front and back rows carry the
 * information the trait panel and estimate actually use.
 *
 * The trait panel updates on every edit (R6.2), which is the whole point of a
 * builder: a player is asking "what happens if I add this unit", and an answer
 * that arrives after a Save button is not an answer.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.5, 11.3_
 */
'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { analyzeBoard, saveBoard, type BoardAnalysis, type BuilderUnitView } from '@/lib/api';

export interface BoardEditorProps {
  /** Pre-filled board, from a share link or an "import into builder" action. */
  initialUnits?: BuilderUnitView[];
  initialName?: string;
  initialLevel?: number;
}

/** Debounce so a burst of edits produces one request, not one per keystroke. */
const ANALYZE_DEBOUNCE_MS = 250;

export function BoardEditor({
  initialUnits = [],
  initialName = 'Untitled board',
  initialLevel = 8,
}: BoardEditorProps) {
  const nameId = useId();
  const levelId = useId();
  const championId = useId();

  const [name, setName] = useState(initialName);
  const [level, setLevel] = useState(initialLevel);
  const [units, setUnits] = useState<BuilderUnitView[]>(initialUnits);
  const [draft, setDraft] = useState('');
  const [analysis, setAnalysis] = useState<BoardAnalysis | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Guards against an earlier, slower response overwriting a later one — the
  // classic race that makes a live panel show stale numbers.
  const requestSeq = useRef(0);

  const refresh = useCallback(async (nextUnits: BuilderUnitView[], nextLevel: number) => {
    const seq = ++requestSeq.current;
    const result = await analyzeBoard({ units: nextUnits, level: nextLevel });
    if (seq !== requestSeq.current) return;
    setAnalysis(result.ok ? result.data : null);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(units, level), ANALYZE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [units, level, refresh]);

  const addUnit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setUnits((current) => [...current, { championId: trimmed, starLevel: 1, itemIds: [] }]);
    setDraft('');
  };

  const removeUnit = (index: number) =>
    setUnits((current) => current.filter((_, position) => position !== index));

  const cycleStar = (index: number) =>
    setUnits((current) =>
      current.map((unit, position) =>
        position === index ? { ...unit, starLevel: ((unit.starLevel % 3) + 1) as 1 | 2 | 3 } : unit,
      ),
    );

  const setItems = (index: number, raw: string) =>
    setUnits((current) =>
      current.map((unit, position) =>
        position === index
          ? {
              ...unit,
              itemIds: raw
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, 3),
            }
          : unit,
      ),
    );

  const onSave = async () => {
    setStatus('Saving…');
    const result = await saveBoard({ name, units, level });

    if (!result.ok) {
      setStatus(`Couldn't save: ${result.detail}`);
      return;
    }
    setShareUrl(result.data.shareUrl ?? `/builder/${result.data.id}`);
    setStatus(null);
  };

  const overCapacity = units.length > level;

  const traitPanel = useMemo(() => analysis?.traits ?? [], [analysis]);

  return (
    <div className="builder">
      <section className="builder__board">
        <div className="builder__meta">
          <div>
            <label htmlFor={nameId}>Board name</label>
            <input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <label htmlFor={levelId}>Level</label>
            <input
              id={levelId}
              type="number"
              min={1}
              max={11}
              value={level}
              onChange={(event) => setLevel(Number(event.target.value) || 1)}
            />
          </div>
        </div>

        {/*
          A board over the level cap is illegal in game. Warn rather than block:
          a theorycrafter may well be building toward level 9 from level 8.
        */}
        {overCapacity && (
          <p className="builder__warning" role="status">
            {units.length} units at level {level} — you can only field {level}. Fine for planning,
            not a board you can play yet.
          </p>
        )}

        <div className="builder__add">
          <label htmlFor={championId}>Add a champion</label>
          <input
            id={championId}
            value={draft}
            placeholder="TFT17_Zoe"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addUnit();
              }
            }}
          />
          <button type="button" className="tftc-btn tftc-btn--primary" onClick={addUnit}>
            Add
          </button>
        </div>

        {units.length === 0 ? (
          <p className="empty-state">
            No units yet. Add a champion id above, or open a comp and use “Import into builder”.
          </p>
        ) : (
          <ul className="builder__units">
            {units.map((unit, index) => (
              <li key={`${unit.championId}-${index}`}>
                <span className="builder__unit-name">{shortId(unit.championId)}</span>

                <button
                  type="button"
                  className="builder__star"
                  onClick={() => cycleStar(index)}
                  aria-label={`${shortId(unit.championId)} star level, currently ${unit.starLevel}`}
                >
                  {'★'.repeat(unit.starLevel)}
                </button>

                <input
                  className="builder__items"
                  value={unit.itemIds.join(', ')}
                  placeholder="items, comma separated"
                  aria-label={`Items on ${shortId(unit.championId)}`}
                  onChange={(event) => setItems(index, event.target.value)}
                />

                <button
                  type="button"
                  className="tftc-btn tftc-btn--ghost"
                  onClick={() => removeUnit(index)}
                  aria-label={`Remove ${shortId(unit.championId)}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="builder__actions">
          <button
            type="button"
            className="tftc-btn tftc-btn--primary"
            onClick={() => void onSave()}
            disabled={units.length === 0}
          >
            Save &amp; get share link
          </button>
          {status && <span className="builder__status">{status}</span>}
        </div>

        {shareUrl && (
          <p className="builder__share">
            Share this board: <a href={shareUrl}>{shareUrl}</a>
          </p>
        )}
      </section>

      <aside className="builder__panel">
        <h2>Traits</h2>
        {traitPanel.length === 0 ? (
          <p className="empty-state">Add units to see traits.</p>
        ) : (
          <ul className="trait-panel">
            {traitPanel.map((trait) => (
              <li
                key={trait.traitId}
                className={[
                  'trait-panel__row',
                  trait.activeBreakpoint !== null ? 'trait-panel__row--active' : '',
                  // R6.2 — highlight traits one unit from the next breakpoint.
                  trait.oneAway ? 'trait-panel__row--one-away' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="trait-panel__name">{trait.name}</span>
                <span className="trait-panel__count tftc-stat">
                  {trait.count}
                  {trait.activeBreakpoint !== null && ` / ${trait.activeBreakpoint}`}
                </span>
                {/*
                  The hint carries the information, not just the highlight
                  colour — design-system.md §7.
                */}
                <span className="trait-panel__hint">
                  {trait.oneAway
                    ? `1 more for ${trait.nextBreakpoint}`
                    : trait.activeBreakpoint !== null
                      ? 'active'
                      : trait.unitsToNext !== null
                        ? `${trait.unitsToNext} more`
                        : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        {analysis && (
          <>
            <h2>Board estimate</h2>
            <dl className="stat-row tftc-stat">
              <div>
                <dt>Overall</dt>
                <dd>{analysis.estimate.index}</dd>
              </div>
              <div>
                <dt>Front line</dt>
                <dd>{analysis.estimate.frontline}</dd>
              </div>
              <div>
                <dt>Damage</dt>
                <dd>{analysis.estimate.damage}</dd>
              </div>
            </dl>

            {/*
              R6.1 and design.md §1: an estimate, clearly labelled. The caveats
              come from the API rather than being restated here, so the number
              and its limits can never drift apart.
            */}
            <p className="builder__estimate-note">
              A rough {analysis.estimate.confidence}-confidence shape check, not a fight simulation.
            </p>
            <ul className="builder__caveats">
              {analysis.estimate.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>

            {analysis.matchedComp && (
              <>
                <h2>Matches a tracked comp</h2>
                <p>
                  This looks like{' '}
                  <a href={`/comps/${analysis.matchedComp.compId}`}>{analysis.matchedComp.name}</a>.
                  Open it for live stats and a stage-by-stage plan.
                </p>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

const shortId = (id: string): string =>
  id.replace(/^TFT\d*_/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
