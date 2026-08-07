import { describe, expect, it, vi } from 'vitest';

import {
  RSO_AUTHORIZE_URL,
  RsoError,
  createAuthFlow,
  exchangeCode,
  puuidFromIdToken,
  statesMatch,
} from './rso.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  issueAccessToken,
  newSessionId,
  sessionCookieOptions,
  verifyAccessToken,
} from './session.js';

const config = {
  clientId: 'tftcodex',
  clientSecret: 'shhh',
  redirectUri: 'http://localhost:4000/v1/auth/riot/callback',
};

describe('createAuthFlow (_Requirements: 7.1_)', () => {
  it('builds an authorize URL with PKCE S256', () => {
    const flow = createAuthFlow(config);
    const url = new URL(flow.authorizeUrl);

    expect(flow.authorizeUrl.startsWith(RSO_AUTHORIZE_URL)).toBe(true);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(flow.codeChallenge);
    expect(url.searchParams.get('client_id')).toBe('tftcodex');
  });

  it('never puts the client secret or the verifier in the URL', () => {
    // The verifier in a URL defeats the entire point of PKCE.
    const flow = createAuthFlow(config);
    expect(flow.authorizeUrl).not.toContain('shhh');
    expect(flow.authorizeUrl).not.toContain(flow.codeVerifier);
  });

  it('generates a fresh state and verifier each time', () => {
    const first = createAuthFlow(config);
    const second = createAuthFlow(config);
    expect(first.state).not.toBe(second.state);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });
});

describe('statesMatch', () => {
  it('matches identical states and rejects different ones', () => {
    expect(statesMatch('abc123', 'abc123')).toBe(true);
    expect(statesMatch('abc123', 'abc124')).toBe(false);
  });

  it('returns false rather than throwing on a length mismatch', () => {
    // timingSafeEqual throws on unequal lengths, which is itself a leak.
    expect(statesMatch('abc', 'abcdef')).toBe(false);
    expect(statesMatch('', 'x')).toBe(false);
  });
});

describe('exchangeCode (_Requirements: 7.1_)', () => {
  const tokenResponse = (body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('sends credentials in the Authorization header, not the body', async () => {
    // Bodies end up in proxy logs far more often than headers do.
    const fetchImpl = vi.fn(async () =>
      tokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 600 }),
    );

    await exchangeCode(config, {
      code: 'code',
      codeVerifier: 'verifier',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toMatch(/^Basic /);
    expect(String(init.body)).not.toContain('shhh');
    expect(String(init.body)).toContain('code_verifier=verifier');
  });

  it('returns the tokens', async () => {
    const fetchImpl = vi.fn(async () =>
      tokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 900, id_token: 'id' }),
    );

    const tokens = await exchangeCode(config, {
      code: 'c',
      codeVerifier: 'v',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresInSeconds: 900,
      idToken: 'id',
    });
  });

  it('throws a typed error on rejection', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 400 }));
    await expect(
      exchangeCode(config, {
        code: 'c',
        codeVerifier: 'v',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(RsoError);
  });
});

describe('puuidFromIdToken', () => {
  const token = (payload: Record<string, unknown>) =>
    `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

  it('reads sub as the PUUID', () => {
    expect(puuidFromIdToken(token({ sub: 'puuid-1' }))).toBe('puuid-1');
  });

  it('returns null for a malformed or subject-less token', () => {
    expect(puuidFromIdToken('nonsense')).toBeNull();
    expect(puuidFromIdToken(token({}))).toBeNull();
    expect(puuidFromIdToken(token({ sub: '' }))).toBeNull();
  });
});

describe('session tokens (_Requirements: 7.1, 7.5_)', () => {
  const secret = 'test-secret-value';

  it('issues and verifies a token carrying the PUUID and session id', () => {
    const token = issueAccessToken({ puuid: 'puuid-1', sessionId: 'sid-1' }, secret);
    const result = verifyAccessToken(token, secret);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.claims.sub).toBe('puuid-1');
      expect(result.claims.sid).toBe('sid-1');
      expect(result.claims.exp - result.claims.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
    }
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueAccessToken({ puuid: 'p', sessionId: 's' }, secret);
    expect(verifyAccessToken(token, 'other-secret')).toEqual({
      valid: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a tampered payload', () => {
    const token = issueAccessToken({ puuid: 'p', sessionId: 's' }, secret);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'someone-else', exp: 9e9 })).toString(
      'base64url',
    );

    expect(verifyAccessToken(`${header}.${forged}.${signature}`, secret).valid).toBe(false);
  });

  it('reports bad-signature rather than expired for an unsigned expired token', () => {
    // Saying "expired" would tell an attacker their forgery had the right shape.
    const stale = issueAccessToken({ puuid: 'p', sessionId: 's' }, 'wrong', () => 0);
    expect(verifyAccessToken(stale, secret)).toEqual({ valid: false, reason: 'bad-signature' });
  });

  it('rejects an expired token that is otherwise valid', () => {
    const token = issueAccessToken({ puuid: 'p', sessionId: 's' }, secret, () => 0);
    const later = () => (ACCESS_TOKEN_TTL_SECONDS + 60) * 1000;
    expect(verifyAccessToken(token, secret, later)).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects a malformed token', () => {
    expect(verifyAccessToken('not.a.jwt.at.all', secret).valid).toBe(false);
    expect(verifyAccessToken('nope', secret)).toEqual({ valid: false, reason: 'malformed' });
  });

  it('generates distinct session ids', () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });
});

describe('sessionCookieOptions (_Requirements: 7.1_)', () => {
  it('is httpOnly and lax in every environment', () => {
    // httpOnly so script cannot read it; lax so the RSO redirect back still
    // carries it while cross-site POSTs do not.
    for (const production of [true, false]) {
      const options = sessionCookieOptions(production);
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
    }
  });

  it('is secure in production and not on localhost, which has no TLS', () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});
