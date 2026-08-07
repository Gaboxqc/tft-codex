/**
 * "What should I pick?" widget (task 2.10).
 *
 * Exists to exercise `/v1/recommendations` from a real client before the
 * Overwolf app is built, and it is genuinely useful on its own — a player can
 * type the three options they were offered and get them ranked.
 *
 * Compliance shape worth noting: the player enters the options *manually*.
 * Nothing here reads or infers game state, which keeps this squarely Tier-1/2
 * regardless of how R3.7 is answered. The `modeServed` value from the response
 * is rendered rather than assumed, so if the deployment ever does serve Tier-3,
 * the UI says so instead of quietly changing behaviour (design.md §8).
 *
 * _Requirements: 3.4, 3.5, 3.7_
 */
'use client';

import { useId, useState } from 'react';
import type { RecommendationResponse } from '@tft-codex/shared-types';

import { postRecommendation } from '@/lib/api';

export interface AugmentAdvisorProps {
  /** Champion ids from the comp, used as the board context. */
  boardUnits: string[];
  compName: string;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: RecommendationResponse }
  | { status: 'error'; detail: string };

export function AugmentAdvisor({ boardUnits, compName }: AugmentAdvisorProps) {
  const fieldId = useId();
  const [raw, setRaw] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const options = raw
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 3);

    if (options.length === 0) {
      setState({ status: 'error', detail: 'Enter at least one augment id.' });
      return;
    }

    setState({ status: 'loading' });
    const result = await postRecommendation({ boardUnits, augmentOptions: options });
    setState(
      result.ok
        ? { status: 'ready', data: result.data }
        : { status: 'error', detail: result.detail },
    );
  };

  return (
    <section className="comp-detail__section advisor">
      <h2>What should I pick?</h2>
      <p className="comp-detail__note">
        Enter the augment ids you were offered and they&apos;ll be ranked for {compName}. This is a
        lookup against the current patch&apos;s data — nothing here reads your game.
      </p>

      <form className="advisor__form" onSubmit={submit}>
        <label htmlFor={fieldId}>Augment ids offered (up to three, comma separated)</label>
        <textarea
          id={fieldId}
          rows={2}
          value={raw}
          placeholder="TFT17_Augment_SorcererHeart, TFT17_Augment_PandorasItems"
          onChange={(event) => setRaw(event.target.value)}
        />
        <button
          type="submit"
          className="tftc-btn tftc-btn--primary"
          disabled={state.status === 'loading'}
        >
          {state.status === 'loading' ? 'Ranking…' : 'Rank them'}
        </button>
      </form>

      {state.status === 'error' && (
        <p className="advisor__error" role="alert">
          {state.detail}
        </p>
      )}

      {state.status === 'ready' && (
        <>
          {!state.data.augmentAdvice || state.data.augmentAdvice.length === 0 ? (
            <p className="empty-state">
              None of those ids are tracked on this patch. Check the spelling against the{' '}
              <a href="/augments">augment list</a>.
            </p>
          ) : (
            <ol className="advisor__results">
              {state.data.augmentAdvice.map((advice) => (
                <li key={advice.augmentId}>
                  <strong>{advice.augmentId.replace(/^TFT\d*_Augment_/, '')}</strong>
                  {/* Always qualitative. The API cannot send a number here. */}
                  <span>{advice.reason}</span>
                </li>
              ))}
            </ol>
          )}

          {/*
            R3.5/R3.7 — label what the server actually did rather than what we
            asked for. `contextAware: false` means the ranking did not consider
            the player's situation, and saying so is more useful than implying
            a personalisation that did not happen.
          */}
          <p className="advisor__mode">
            {state.data.modeServed === 'tier2-lookup'
              ? 'Ranked against this patch’s data, not your live board.'
              : 'Ranked with live board context.'}
          </p>
        </>
      )}
    </section>
  );
}
