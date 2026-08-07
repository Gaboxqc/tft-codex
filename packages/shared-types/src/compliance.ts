/**
 * Compliance primitives shared by the API, the clients, and the CI test suites.
 *
 * Riot's TFT developer policy bars third-party apps from surfacing augment win
 * rates, augment average placements, and Legend win rates on ANY client
 * (requirements.md R3.1). This module is the single definition of what "a
 * forbidden field" means so the gateway middleware (design.md §5), the
 * component prop types (design-system.md §5), and the release-blocking test
 * suite (tasks.md 2.6) can never drift apart.
 *
 * _Requirements: 3.1, 3.6_
 */

/**
 * Field names that must never appear in a response body served under
 * `/v1/augments/*` or `/v1/recommendations`. Matched case-insensitively and
 * ignoring separators, so `win_rate`, `winRate`, and `WinRate` all trip.
 */
export const FORBIDDEN_STAT_FIELDS = [
  'winRate',
  'avgPlacement',
  'averagePlacement',
  'placementAvg',
  'avgPlace',
  'expectedPlacement',
  'placementDelta',
] as const;

export type ForbiddenStatField = (typeof FORBIDDEN_STAT_FIELDS)[number];

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const NORMALIZED_FORBIDDEN = new Set(FORBIDDEN_STAT_FIELDS.map(normalizeKey));

/** A single forbidden field found during a scan, with its JSON path. */
export interface ForbiddenFieldHit {
  /** Dot/bracket path to the offending key, e.g. `augmentAdvice[0].winRate`. */
  path: string;
  key: string;
}

/**
 * Deep-scans an arbitrary value for forbidden stat keys.
 *
 * Returns every hit rather than throwing so callers can report all violations
 * at once. Used by the augment-compliance test suite and by the API gateway's
 * dev-mode assertion middleware.
 */
export function findForbiddenStatFields(value: unknown, path = '$'): ForbiddenFieldHit[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenStatFields(entry, `${path}[${index}]`));
  }

  if (value === null || typeof value !== 'object') {
    return [];
  }

  const hits: ForbiddenFieldHit[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (NORMALIZED_FORBIDDEN.has(normalizeKey(key))) {
      hits.push({ path: childPath, key });
    }
    hits.push(...findForbiddenStatFields(entry, childPath));
  }
  return hits;
}

/**
 * Throws if `value` contains any forbidden stat field. Intended for use as a
 * release-blocking assertion in CI (tasks.md 2.6, X.6).
 */
export function assertNoForbiddenStatFields(value: unknown, context = 'response'): void {
  const hits = findForbiddenStatFields(value);
  if (hits.length > 0) {
    const detail = hits.map((hit) => `${hit.path} (${hit.key})`).join(', ');
    throw new Error(
      `R3.1 violation: ${context} exposes forbidden augment stat field(s): ${detail}. ` +
        'Augment win rate and average placement must never leave the server. ' +
        'See requirements.md R3.1 and design.md §7.',
    );
  }
}

/**
 * The two recommendation-timing modes from requirements.md R3.7.
 *
 * `tier2-lookup` is a filter over static, patch-level precomputed data by the
 * options the player was actually offered. `tier3-adaptive` reads live board
 * state and is gated behind written Riot confirmation — the server, never the
 * client, decides which one is actually served (design.md §5, §8).
 */
export const RECOMMENDATION_MODES = ['tier2-lookup', 'tier3-adaptive'] as const;

export type RecommendationMode = (typeof RECOMMENDATION_MODES)[number];

/** The only mode that may ship without Riot's written confirmation on file. */
export const DEFAULT_RECOMMENDATION_MODE: RecommendationMode = 'tier2-lookup';
