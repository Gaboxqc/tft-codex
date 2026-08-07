/**
 * Tier-list filter controls (R1.7).
 *
 * Filters live in the URL rather than component state: a filtered tier list is
 * something players share ("here's every S-tier reroll comp"), and it should
 * survive a reload and a back button. It also keeps the page server-rendered —
 * no client-side fetch, no loading spinner between filter changes.
 *
 * _Requirements: 1.7, 11.3_
 */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { DIFFICULTIES, PLAYSTYLES, TIERS } from '@tft-codex/shared-types';

const FILTERS = [
  { name: 'tier', label: 'Tier', options: [...TIERS, 'provisional'] },
  { name: 'playstyle', label: 'Playstyle', options: [...PLAYSTYLES] },
  { name: 'difficulty', label: 'Difficulty', options: [...DIFFICULTIES] },
] as const;

export function TierListFilters() {
  const router = useRouter();
  const params = useSearchParams();

  const update = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    router.push(next.toString() ? `/?${next.toString()}` : '/');
  };

  const active = FILTERS.some((filter) => params.get(filter.name));

  return (
    <form className="tier-filters" aria-label="Filter the tier list">
      {FILTERS.map((filter) => (
        <div key={filter.name} className="tier-filters__field">
          <label htmlFor={`filter-${filter.name}`}>{filter.label}</label>
          <select
            id={`filter-${filter.name}`}
            name={filter.name}
            value={params.get(filter.name) ?? ''}
            onChange={(event) => update(filter.name, event.target.value)}
          >
            <option value="">All</option>
            {filter.options.map((option) => (
              <option key={option} value={option}>
                {option === 'provisional' ? 'Provisional' : option}
              </option>
            ))}
          </select>
        </div>
      ))}

      {active && (
        <button type="button" className="tftc-btn tftc-btn--ghost" onClick={() => router.push('/')}>
          Clear filters
        </button>
      )}
    </form>
  );
}
