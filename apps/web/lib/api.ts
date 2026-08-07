/**
 * Server-side API client for the web app.
 *
 * Everything here runs on the Next.js server, never in the browser. That is
 * what lets the tier list be server-rendered for a fast first paint
 * (design.md §13) and keeps the API base URL out of client bundles.
 *
 * Failures return a typed result rather than throwing. R11.2 requires the app
 * stay browsable when the pipeline or Riot is down, and a page that renders
 * "we could not reach the meta engine" is a far better outcome than an error
 * boundary.
 */
import type { Comp, TierList } from '@tft-codex/shared-types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; reason: 'unavailable' | 'not-found'; detail: string };

interface FetchOptions {
  /**
   * Seconds Next may reuse a cached response. Kept well inside the pipeline's
   * 30-minute refresh so a page never renders a stale list without the R1.6
   * banner that should accompany it.
   */
  revalidate?: number;
}

async function getJson<T>(path: string, options: FetchOptions = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { accept: 'application/json' },
      next: { revalidate: options.revalidate ?? 60 },
    });

    if (response.status === 404) {
      return { ok: false, reason: 'not-found', detail: `Nothing at ${path}.` };
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: 'unavailable',
        detail: `The meta engine returned ${response.status}.`,
      };
    }

    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    return {
      ok: false,
      reason: 'unavailable',
      detail: error instanceof Error ? error.message : 'Could not reach the meta engine.',
    };
  }
}

export interface TierListFilters {
  patch?: string;
  tier?: string;
  playstyle?: string;
  difficulty?: string;
}

export function getTierList(filters: TierListFilters = {}): Promise<ApiResult<TierList>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return getJson<TierList>(`/v1/meta/tier-list${query ? `?${query}` : ''}`);
}

export function getComp(id: string, patch?: string): Promise<ApiResult<Comp>> {
  const query = patch ? `?patch=${encodeURIComponent(patch)}` : '';
  return getJson<Comp>(`/v1/comps/${encodeURIComponent(id)}${query}`);
}

export function getComps(
  filters: { patch?: string; q?: string; carry?: string; trait?: string } = {},
): Promise<ApiResult<{ patch: string; comps: Comp[] }>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return getJson<{ patch: string; comps: Comp[] }>(`/v1/comps${query ? `?${query}` : ''}`);
}
