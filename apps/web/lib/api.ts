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
import type {
  BreakpointReference,
  Comp,
  RecommendationResponse,
  TierList,
} from '@tft-codex/shared-types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'unauthenticated'; detail: string };

interface FetchOptions {
  /**
   * Seconds Next may reuse a cached response. Kept well inside the pipeline's
   * 30-minute refresh so a page never renders a stale list without the R1.6
   * banner that should accompany it.
   */
  revalidate?: number;
  /**
   * Forwarded session cookie for personal routes. The API's session cookie is
   * httpOnly, so a server component has to pass it through explicitly — which
   * also means personal requests are opt-in rather than accidental.
   */
  cookie?: string;
}

async function getJson<T>(path: string, options: FetchOptions = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        accept: 'application/json',
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      // Personal data must never be cached across users. When a cookie is
      // forwarded, the response is per-user by definition.
      ...(options.cookie
        ? { cache: 'no-store' as const }
        : { next: { revalidate: options.revalidate ?? 60 } }),
    });

    if (response.status === 401) {
      return { ok: false, reason: 'unauthenticated', detail: 'Sign in to see this.' };
    }

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

/**
 * The public augment record.
 *
 * Note what this type does not have, and cannot be given: a win rate or an
 * average placement. The API has no field to send one, and adding it here
 * would be a compile error against nothing — the point is that a component
 * author reaching for that number finds it absent at every layer (R3.1).
 */
export interface PublicAugment {
  id: string;
  name: string;
  tier: 'S' | 'A' | 'B' | 'C';
  playRate: number;
  provisional: boolean;
  roundsOffered: number[];
  description: string;
  patch: string;
  category: string | null;
  curatedForCompIds: string[];
  qualitativeNotes: string;
}

export function getAugments(
  filters: { patch?: string; kind?: 'augment' | 'legend'; tier?: string } = {},
): Promise<ApiResult<{ patch: string; kind: string; augments: PublicAugment[] }>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return getJson<{ patch: string; kind: string; augments: PublicAugment[] }>(
    `/v1/augments/tier-list${query ? `?${query}` : ''}`,
  );
}

// ── Personal analytics (R4) ─────────────────────────────────────────────────
//
// Every function below forwards the session cookie and is `no-store`. Personal
// data must never share a cache entry between users, and Next's default
// caching would happily do exactly that.

export interface PlayerProfileView {
  puuid: string;
  region: string;
  riotId: string;
  linkedAt: string;
  lastSyncedAt: string | null;
  coachingNarrativeOptOut: boolean;
}

export interface MatchListItem {
  matchId: string;
  patch: string;
  placement: number;
  detectedCompId: string | null;
  timestamp: string;
}

export interface CurveDeviationView {
  round: string;
  actual: number;
  baseline: number;
  delta: number;
}

export interface MatchReviewView {
  match: MatchListItem & {
    levelCurve: { round: string; value: number }[];
    goldCurve: { round: string; value: number }[];
  };
  baseline: {
    compId: string | null;
    compName: string | null;
    sampleSize: number;
  };
  levelDeviations: CurveDeviationView[];
  goldDeviations: CurveDeviationView[];
  suggestions: { signal: string; round: string | null; message: string }[];
  keyDeviationRound: string | null;
  /** `final-state` means one endpoint, not a per-round trace. */
  curveSource: 'final-state' | 'gep-capture';
}

export interface AnalyticsView {
  totalGames: number;
  overallAvgPlacement: number | null;
  byComp: { compId: string | null; compName: string | null; games: number; avgPlacement: number }[];
}

export function getProfile(cookie: string): Promise<ApiResult<PlayerProfileView>> {
  return getJson<PlayerProfileView>('/v1/players/me', { cookie });
}

export function getMyMatches(
  cookie: string,
  limit = 20,
): Promise<ApiResult<{ matches: MatchListItem[] }>> {
  return getJson<{ matches: MatchListItem[] }>(`/v1/players/me/matches?limit=${limit}`, {
    cookie,
  });
}

export function getMatchReview(
  cookie: string,
  matchId: string,
): Promise<ApiResult<MatchReviewView>> {
  return getJson<MatchReviewView>(`/v1/players/me/matches/${encodeURIComponent(matchId)}`, {
    cookie,
  });
}

export function getAnalytics(cookie: string): Promise<ApiResult<AnalyticsView>> {
  return getJson<AnalyticsView>('/v1/players/me/analytics', { cookie });
}

export function getCoaching(
  cookie: string,
  matchId: string,
): Promise<ApiResult<{ narrative: string; keyDeviationRound: string | null }>> {
  return getJson<{ narrative: string; keyDeviationRound: string | null }>(
    `/v1/matches/${encodeURIComponent(matchId)}/coaching`,
    { cookie },
  );
}

// ── Builder (R6) ────────────────────────────────────────────────────────────

export interface BuilderUnitView {
  championId: string;
  starLevel: 1 | 2 | 3;
  itemIds: string[];
}

export interface TraitView {
  traitId: string;
  name: string;
  count: number;
  activeBreakpoint: number | null;
  nextBreakpoint: number | null;
  unitsToNext: number | null;
  oneAway: boolean;
}

export interface EstimateView {
  index: number;
  frontline: number;
  damage: number;
  confidence: 'low' | 'medium';
  caveats: string[];
  formulaVersion: string;
}

export interface BoardAnalysis {
  patch: string;
  traits: TraitView[];
  estimate: EstimateView;
  matchedComp: { compId: string; name: string; matchScore: number } | null;
}

export interface SavedBoard {
  id: string;
  puuid: string | null;
  patch: string;
  name: string;
  units: BuilderUnitView[];
  level: number;
  shareUrl?: string;
}

export function analyzeBoard(body: {
  units: BuilderUnitView[];
  level: number;
  name?: string;
}): Promise<ApiResult<BoardAnalysis>> {
  return postJson<BoardAnalysis>('/v1/builder/analyze', body);
}

export function saveBoard(body: {
  name: string;
  units: BuilderUnitView[];
  level: number;
}): Promise<ApiResult<SavedBoard>> {
  return postJson<SavedBoard>('/v1/builder/comps', body);
}

export function getBoard(id: string): Promise<ApiResult<BoardAnalysis & { board: SavedBoard }>> {
  return getJson<BoardAnalysis & { board: SavedBoard }>(
    `/v1/builder/comps/${encodeURIComponent(id)}`,
  );
}

export interface OptimizeView {
  allocations: { championId: string; name: string; itemIds: string[]; rationale: string }[];
  unallocated: string[];
  tradeOffs: { itemId: string; contestedBy: string[]; explanation: string }[];
}

export function optimizeItems(body: {
  heldItems: string[];
  boardUnits: string[];
  compId?: string;
}): Promise<ApiResult<OptimizeView>> {
  return postJson<OptimizeView>('/v1/items/optimize', body);
}

/**
 * Shared POST helper.
 *
 * `credentials: 'include'` so the session cookie rides along when the player
 * happens to be signed in — the builder does not require it, but an
 * attributed save is nicer than an orphaned one.
 */
async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: response.status === 401 ? 'unauthenticated' : 'unavailable',
        detail: `The builder service returned ${response.status}.`,
      };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    return {
      ok: false,
      reason: 'unavailable',
      detail: error instanceof Error ? error.message : 'Could not reach the builder service.',
    };
  }
}

export function getBreakpoints(patch?: string): Promise<ApiResult<BreakpointReference>> {
  const query = patch ? `?patch=${encodeURIComponent(patch)}` : '';
  return getJson<BreakpointReference>(`/v1/reference/breakpoints${query}`, {
    // Game constants change only on a patch.
    revalidate: 3600,
  });
}

/**
 * Asks for a recommendation.
 *
 * Always sends `tier2-lookup`. The server would downgrade anything else, but
 * sending Tier-3 from a client that has no business asking for it would show
 * up in the API's downgrade log as a false alarm — and R3.7 is clearer if the
 * client's intent matches what it is allowed to have (design.md §8).
 */
export async function postRecommendation(body: {
  boardUnits: string[];
  augmentOptions?: string[];
  goldAvailable?: number;
  level?: number;
}): Promise<ApiResult<RecommendationResponse>> {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/recommendations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...body, source: 'web', mode: 'tier2-lookup' }),
      cache: 'no-store',
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: 'unavailable',
        detail: `The recommendation engine returned ${response.status}.`,
      };
    }
    return { ok: true, data: (await response.json()) as RecommendationResponse };
  } catch (error) {
    return {
      ok: false,
      reason: 'unavailable',
      detail: error instanceof Error ? error.message : 'Could not reach the engine.',
    };
  }
}
