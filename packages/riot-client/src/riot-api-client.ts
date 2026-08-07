/**
 * The single way this codebase talks to Riot.
 *
 * Every call goes through the rate limiter first (R12.2), reports its outcome
 * to an observer for the error-rate/consumption dashboards (R11.5), and retries
 * with backoff on the failures worth retrying. Nothing here caches — caching is
 * the gateway's job (design.md §5), and mixing the two would make rate-limit
 * accounting unreliable.
 *
 * _Requirements: 1.1, 4.1, 11.5, 12.1, 12.2, 14.1_
 */
import { z } from 'zod';

import { RiotApiError } from './errors.js';
import {
  AccountSchema,
  LeagueEntrySchema,
  LeagueListSchema,
  MatchSchema,
  type Account,
  type LeagueEntry,
  type LeagueList,
  type Match,
} from './dto.js';
import {
  platformBaseUrl,
  regionalBaseUrl,
  regionalRouteFor,
  type PlatformRoute,
  type RegionalRoute,
} from './routing.js';
import type { RateLimitLane, RateLimiter } from './rate-limit/types.js';

/** Emitted for every attempt so R11.5's dashboards have something to read. */
export interface RiotRequestEvent {
  endpoint: string;
  lane: RateLimitLane;
  status: number | null;
  durationMs: number;
  attempt: number;
  /** Riot's own rate-limit accounting headers, when present. */
  appRateLimitCount: string | null;
  methodRateLimitCount: string | null;
  error?: string;
}

export interface RiotApiClientOptions {
  apiKey: string;
  /** Default platform route for league/summoner calls. */
  platform: PlatformRoute;
  /** Defaults to the regional route matching `platform`. */
  regional?: RegionalRoute;
  rateLimiter: RateLimiter;
  /** Max attempts per request, including the first. */
  maxAttempts?: number;
  /** Base delay for exponential backoff when Riot sends no Retry-After. */
  baseBackoffMs?: number;
  /** Per-attempt network timeout. */
  requestTimeoutMs?: number;
  onRequest?: (event: RiotRequestEvent) => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MatchIdsSchema = z.array(z.string());

export class RiotApiClient {
  readonly #options: Required<
    Omit<RiotApiClientOptions, 'onRequest' | 'regional' | 'fetchImpl'>
  > & {
    regional: RegionalRoute;
    onRequest: ((event: RiotRequestEvent) => void) | undefined;
    fetchImpl: typeof fetch;
  };

  constructor(options: RiotApiClientOptions) {
    if (!options.apiKey) {
      throw new Error('RiotApiClient requires an API key. Set RIOT_API_KEY (see .env.example).');
    }
    this.#options = {
      apiKey: options.apiKey,
      platform: options.platform,
      regional: options.regional ?? regionalRouteFor(options.platform),
      rateLimiter: options.rateLimiter,
      maxAttempts: options.maxAttempts ?? 4,
      baseBackoffMs: options.baseBackoffMs ?? 500,
      requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
      onRequest: options.onRequest,
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  // ── League (platform-routed) ───────────────────────────────────────────────

  /**
   * Apex-tier league entries — the seed player pool for the crawler (task 1.1).
   * Challenger/GM/Master give the highest-quality signal for meta computation.
   */
  async getApexLeague(
    tier: 'challenger' | 'grandmaster' | 'master',
    options: { lane?: RateLimitLane; platform?: PlatformRoute } = {},
  ): Promise<LeagueList> {
    return this.#getPlatform(
      `/tft/league/v1/${tier}?queue=RANKED_TFT`,
      LeagueListSchema,
      options.lane ?? 'live',
      options.platform,
    );
  }

  /** Ranked entries for one player — supplies `rankTier` for lobby intel (R14.1). */
  async getLeagueEntriesByPuuid(
    puuid: string,
    options: { lane?: RateLimitLane; platform?: PlatformRoute } = {},
  ): Promise<LeagueEntry[]> {
    return this.#getPlatform(
      `/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`,
      LeagueEntrySchema.array(),
      options.lane ?? 'lobby',
      options.platform,
    );
  }

  // ── Match (regionally routed) ──────────────────────────────────────────────

  /** Recent match ids for a player (tasks 1.2, 3.3, 3.14). */
  async getMatchIdsByPuuid(
    puuid: string,
    options: {
      start?: number;
      count?: number;
      startTime?: number;
      endTime?: number;
      lane?: RateLimitLane;
      regional?: RegionalRoute;
    } = {},
  ): Promise<string[]> {
    const params = new URLSearchParams({
      start: String(options.start ?? 0),
      count: String(options.count ?? 20),
    });
    if (options.startTime !== undefined) params.set('startTime', String(options.startTime));
    if (options.endTime !== undefined) params.set('endTime', String(options.endTime));

    return this.#getRegional(
      `/tft/match/v1/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${params.toString()}`,
      MatchIdsSchema,
      options.lane ?? 'live',
      options.regional,
    );
  }

  /** Full match detail (task 1.3). */
  async getMatch(
    matchId: string,
    options: { lane?: RateLimitLane; regional?: RegionalRoute } = {},
  ): Promise<Match> {
    return this.#getRegional(
      `/tft/match/v1/matches/${encodeURIComponent(matchId)}`,
      MatchSchema,
      options.lane ?? 'live',
      options.regional,
    );
  }

  /** Resolves a "Name#TAG" Riot ID to a PUUID. */
  async getAccountByRiotId(
    gameName: string,
    tagLine: string,
    options: { lane?: RateLimitLane; regional?: RegionalRoute } = {},
  ): Promise<Account> {
    return this.#getRegional(
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      AccountSchema,
      options.lane ?? 'player',
      options.regional,
    );
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #getPlatform<T>(
    path: string,
    schema: z.ZodType<T>,
    lane: RateLimitLane,
    platform?: PlatformRoute,
  ): Promise<T> {
    const base = platformBaseUrl(platform ?? this.#options.platform);
    return this.#request(`${base}${path}`, path, schema, lane);
  }

  #getRegional<T>(
    path: string,
    schema: z.ZodType<T>,
    lane: RateLimitLane,
    regional?: RegionalRoute,
  ): Promise<T> {
    const base = regionalBaseUrl(regional ?? this.#options.regional);
    return this.#request(`${base}${path}`, path, schema, lane);
  }

  async #request<T>(
    url: string,
    endpoint: string,
    schema: z.ZodType<T>,
    lane: RateLimitLane,
  ): Promise<T> {
    const { maxAttempts, baseBackoffMs, rateLimiter, onRequest } = this.#options;
    let lastError: RiotApiError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Admission first: a request we never send cannot breach a limit. A 429
      // from Riot means our own accounting was already wrong (R12.2).
      await rateLimiter.acquire(lane);

      const startedAt = Date.now();
      let response: Response;

      try {
        response = await this.#options.fetchImpl(url, {
          headers: {
            'X-Riot-Token': this.#options.apiKey,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(this.#options.requestTimeoutMs),
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        onRequest?.({
          endpoint,
          lane,
          status: null,
          durationMs: Date.now() - startedAt,
          attempt,
          appRateLimitCount: null,
          methodRateLimitCount: null,
          error: message,
        });
        lastError = new RiotApiError(`Network failure calling ${endpoint}: ${message}`, {
          status: 0,
          endpoint,
        });
        if (attempt === maxAttempts) throw lastError;
        await sleep(backoffDelay(baseBackoffMs, attempt));
        continue;
      }

      onRequest?.({
        endpoint,
        lane,
        status: response.status,
        durationMs: Date.now() - startedAt,
        attempt,
        appRateLimitCount: response.headers.get('X-App-Rate-Limit-Count'),
        methodRateLimitCount: response.headers.get('X-Method-Rate-Limit-Count'),
      });

      if (response.ok) {
        return schema.parse(await response.json());
      }

      const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
      lastError = new RiotApiError(`Riot API ${response.status} on ${endpoint}`, {
        status: response.status,
        endpoint,
        retryAfterMs,
      });

      if (!lastError.isRetryable || attempt === maxAttempts) throw lastError;

      // Riot's Retry-After is authoritative — honour it rather than our own
      // backoff curve, which is only a fallback for 5xx responses.
      await sleep(retryAfterMs ?? backoffDelay(baseBackoffMs, attempt));
    }

    /* c8 ignore next */
    throw lastError ?? new Error(`Request to ${endpoint} exhausted retries without an error.`);
  }
}

/** Exponential backoff with full jitter, so retrying replicas don't resynchronise. */
export function backoffDelay(baseMs: number, attempt: number): number {
  const ceiling = baseMs * 2 ** (attempt - 1);
  return Math.floor(Math.random() * ceiling);
}

export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : null;
}
