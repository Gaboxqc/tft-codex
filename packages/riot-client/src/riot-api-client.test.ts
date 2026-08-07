import { describe, expect, it, vi } from 'vitest';

import type { RiotApiError } from './errors.js';
import { patchOf, queueIdOf } from './dto.js';
import { MemoryRateLimiter } from './rate-limit/memory-token-bucket.js';
import { DEVELOPMENT_KEY_LIMITS } from './rate-limit/types.js';
import { RiotApiClient, parseRetryAfter } from './riot-api-client.js';
import { isTftQueue, regionalRouteFor } from './routing.js';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const makeClient = (fetchImpl: typeof fetch, overrides = {}) =>
  new RiotApiClient({
    apiKey: 'RGAPI-test',
    platform: 'euw1',
    rateLimiter: new MemoryRateLimiter(DEVELOPMENT_KEY_LIMITS),
    fetchImpl,
    baseBackoffMs: 1,
    ...overrides,
  });

describe('routing', () => {
  it('maps platforms to the right regional route', () => {
    expect(regionalRouteFor('euw1')).toBe('europe');
    expect(regionalRouteFor('na1')).toBe('americas');
    expect(regionalRouteFor('kr')).toBe('asia');
    expect(regionalRouteFor('sg2')).toBe('sea');
  });

  it('recognises every TFT queue, including Hyper Roll (R5.3)', () => {
    expect(isTftQueue(1100)).toBe(true);
    expect(isTftQueue(1130)).toBe(true);
    // Standard League Summoner's Rift — the overlay must NOT activate here.
    expect(isTftQueue(420)).toBe(false);
  });
});

describe('DTO helpers', () => {
  it('reads the queue id under either spelling Riot uses', () => {
    expect(
      queueIdOf({
        game_datetime: 0,
        game_length: 0,
        game_version: '',
        queue_id: 1100,
        participants: [],
      }),
    ).toBe(1100);
    expect(
      queueIdOf({
        game_datetime: 0,
        game_length: 0,
        game_version: '',
        queueId: 1090,
        participants: [],
      }),
    ).toBe(1090);
    expect(
      queueIdOf({ game_datetime: 0, game_length: 0, game_version: '', participants: [] }),
    ).toBeNull();
  });

  it('extracts a patch label and returns null on an unfamiliar format', () => {
    const info = (version: string) => ({
      game_datetime: 0,
      game_length: 0,
      game_version: version,
      participants: [],
    });
    expect(patchOf(info('Version 17.9.123.4567 (Jul 30 2026/PBE1/Releases/TFT)'))).toBe('17.9');
    // Returning null keeps a format change visible as unpatched rows rather
    // than silently mislabeling every stat in the run.
    expect(patchOf(info('some new format'))).toBeNull();
  });
});

describe('RiotApiClient', () => {
  it('refuses to construct without an API key', () => {
    expect(
      () =>
        new RiotApiClient({
          apiKey: '',
          platform: 'euw1',
          rateLimiter: new MemoryRateLimiter(DEVELOPMENT_KEY_LIMITS),
        }),
    ).toThrow(/requires an API key/);
  });

  it('sends the key as a header, never as a query parameter', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    await makeClient(fetchImpl as unknown as typeof fetch).getMatchIdsByPuuid('puuid-1');

    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).not.toContain('RGAPI-test');
    expect((init.headers as Record<string, string>)['X-Riot-Token']).toBe('RGAPI-test');
  });

  it('routes league calls to the platform host and match calls to the regional host', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ tier: 'CHALLENGER', entries: [] }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    await client.getApexLeague('challenger');
    expect(fetchImpl.mock.calls[0]![0]).toContain('https://euw1.api.riotgames.com');

    fetchImpl.mockResolvedValue(jsonResponse([]) as never);
    await client.getMatchIdsByPuuid('puuid-1');
    expect(fetchImpl.mock.calls[1]![0]).toContain('https://europe.api.riotgames.com');
  });

  it('acquires a rate-limit token before every attempt, not after (R12.2)', async () => {
    const limiter = new MemoryRateLimiter(DEVELOPMENT_KEY_LIMITS);
    const acquire = vi.spyOn(limiter, 'acquire');
    const fetchImpl = vi.fn(async () => jsonResponse([]));

    await makeClient(fetchImpl as unknown as typeof fetch, {
      rateLimiter: limiter,
    }).getMatchIdsByPuuid('puuid-1');

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith('live');
  });

  it('uses the lobby lane for lobby-intel lookups (R14.1)', async () => {
    const limiter = new MemoryRateLimiter(DEVELOPMENT_KEY_LIMITS);
    const acquire = vi.spyOn(limiter, 'acquire');
    const fetchImpl = vi.fn(async () => jsonResponse([]));

    await makeClient(fetchImpl as unknown as typeof fetch, {
      rateLimiter: limiter,
    }).getLeagueEntriesByPuuid('puuid-1');

    expect(acquire).toHaveBeenCalledWith('lobby');
  });

  it('does not retry a 404 — the resource genuinely is not there', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.getMatch('EUW1_missing')).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry an expired key, which retrying cannot fix', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.getMatch('EUW1_1')).rejects.toSatisfy(
      (error: RiotApiError) => error.isAuthFailure,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and succeeds, honouring Retry-After', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse(['EUW1_1']));

    const ids = await makeClient(fetchImpl).getMatchIdsByPuuid('puuid-1');

    expect(ids).toEqual(['EUW1_1']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts on persistent 5xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch, { maxAttempts: 3 });

    await expect(client.getMatch('EUW1_1')).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries a network failure and reports it to the observer (R11.5)', async () => {
    const events: unknown[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse([]));

    await makeClient(fetchImpl, {
      onRequest: (event: unknown) => events.push(event),
    }).getMatchIdsByPuuid('puuid-1');

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ status: null, error: 'ECONNRESET', attempt: 1 });
  });

  it("surfaces Riot's own rate-limit headers for the consumption dashboard (R11.5)", async () => {
    const events: { appRateLimitCount: string | null }[] = [];
    const fetchImpl = vi.fn(async () =>
      jsonResponse([], { headers: { 'X-App-Rate-Limit-Count': '15:1,45:120' } }),
    );

    await makeClient(fetchImpl as unknown as typeof fetch, {
      onRequest: (event: { appRateLimitCount: string | null }) => events.push(event),
    }).getMatchIdsByPuuid('puuid-1');

    expect(events[0]!.appRateLimitCount).toBe('15:1,45:120');
  });

  it('tolerates unknown fields in match payloads so a Riot addition is not an outage', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        metadata: { match_id: 'EUW1_1', participants: ['p1'] },
        info: {
          game_datetime: 1,
          game_length: 2,
          game_version: 'Version 17.9.1.1 (x)',
          queue_id: 1100,
          participants: [],
          brand_new_riot_field: { nested: true },
        },
      }),
    );

    const match = await makeClient(fetchImpl as unknown as typeof fetch).getMatch('EUW1_1');
    expect(match.metadata.match_id).toBe('EUW1_1');
    expect(queueIdOf(match.info)).toBe(1100);
  });
});

describe('parseRetryAfter', () => {
  it('converts seconds to milliseconds and rejects garbage', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
  });
});
