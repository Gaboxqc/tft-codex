/**
 * Riot splits its APIs across two routing systems and using the wrong one is a
 * 404, not an error message. Platform routes serve league/summoner data;
 * regional routes serve match and account data.
 */

export const PLATFORM_ROUTES = [
  'br1',
  'eun1',
  'euw1',
  'jp1',
  'kr',
  'la1',
  'la2',
  'me1',
  'na1',
  'oc1',
  'ru',
  'sg2',
  'tr1',
  'tw2',
  'vn2',
] as const;
export type PlatformRoute = (typeof PLATFORM_ROUTES)[number];

export const REGIONAL_ROUTES = ['americas', 'asia', 'europe', 'sea'] as const;
export type RegionalRoute = (typeof REGIONAL_ROUTES)[number];

const PLATFORM_TO_REGIONAL: Record<PlatformRoute, RegionalRoute> = {
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  na1: 'americas',
  jp1: 'asia',
  kr: 'asia',
  eun1: 'europe',
  euw1: 'europe',
  me1: 'europe',
  ru: 'europe',
  tr1: 'europe',
  oc1: 'sea',
  sg2: 'sea',
  tw2: 'sea',
  vn2: 'sea',
};

/** The regional route that serves match/account data for a given platform. */
export function regionalRouteFor(platform: PlatformRoute): RegionalRoute {
  return PLATFORM_TO_REGIONAL[platform];
}

export function isPlatformRoute(value: string): value is PlatformRoute {
  return (PLATFORM_ROUTES as readonly string[]).includes(value);
}

export function isRegionalRoute(value: string): value is RegionalRoute {
  return (REGIONAL_ROUTES as readonly string[]).includes(value);
}

export const platformBaseUrl = (platform: PlatformRoute): string =>
  `https://${platform}.api.riotgames.com`;

export const regionalBaseUrl = (regional: RegionalRoute): string =>
  `https://${regional}.api.riotgames.com`;

/**
 * TFT queue IDs. R5.3 needs these to tell a TFT session apart from a standard
 * League match — the two share a Game ID because TFT runs inside the League
 * client (design.md §6).
 */
export const TFT_QUEUE_IDS = {
  /** Normal TFT. */
  normal: 1090,
  /** Ranked TFT — the only queue the meta engine ingests (R1.1). */
  ranked: 1100,
  /** Hyper Roll. Out of scope at launch (design.md §1). */
  hyperRoll: 1130,
  /** Double Up. Out of scope at launch. */
  doubleUp: 1160,
} as const;

export const RANKED_TFT_QUEUE_ID = TFT_QUEUE_IDS.ranked;

/** True for any queue the Overwolf app should activate TFT features for (R5.3). */
export function isTftQueue(queueId: number): boolean {
  return Object.values(TFT_QUEUE_IDS).includes(queueId as never);
}
