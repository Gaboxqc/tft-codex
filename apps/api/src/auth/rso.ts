/**
 * Riot Sign-On (RSO) OAuth 2.0 with PKCE (task 3.1).
 *
 * R7.1 permits account linking *exclusively* through RSO and forbids asking
 * users for Riot credentials directly. So this module never sees a password —
 * it exchanges an authorization code for tokens and reads the PUUID out of the
 * result, and that is the whole of its access.
 *
 * Design notes that matter for review:
 *
 * - **PKCE even though we have a client secret.** RSO is a confidential client
 *   here, so PKCE is not strictly required. It costs nothing and closes
 *   authorization-code interception if the redirect is ever mishandled.
 * - **The verifier stays server-side.** It lives in `auth_flows` keyed by the
 *   state parameter, never in a cookie. A verifier in the browser is a
 *   verifier an XSS can read.
 * - **State is compared in constant time** and is single-use — the row is
 *   deleted on consumption, so a replayed callback finds nothing.
 *
 * _Requirements: 7.1, 7.2_
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** Riot's RSO endpoints. Region-independent. */
export const RSO_AUTHORIZE_URL = 'https://auth.riotgames.com/authorize';
export const RSO_TOKEN_URL = 'https://auth.riotgames.com/token';

export interface RsoConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AuthFlow {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  authorizeUrl: string;
}

const base64Url = (buffer: Buffer): string =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Starts a flow: generates state + PKCE pair and the URL to redirect to.
 *
 * 32 random bytes for each. Long enough that guessing is not a threat model,
 * short enough to fit comfortably in a URL.
 */
export function createAuthFlow(config: RsoConfig, scopes = ['openid']): AuthFlow {
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    state,
    codeVerifier,
    codeChallenge,
    authorizeUrl: `${RSO_AUTHORIZE_URL}?${params.toString()}`,
  };
}

/**
 * Constant-time state comparison.
 *
 * `===` on a secret leaks its prefix through timing. The cost of doing this
 * properly is a few microseconds; the cost of not doing it is a CSRF vector
 * that is tedious but not impossible to exploit.
 */
export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  // timingSafeEqual throws on a length mismatch, which is itself a leak — so
  // check length first and always return false rather than surfacing it.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const TokenResponseSchema = z.looseObject({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  id_token: z.string().optional(),
  token_type: z.string().optional(),
});

export interface RsoTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  idToken: string | null;
}

export class RsoError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RsoError';
    this.status = status;
  }
}

/** Exchanges an authorization code for tokens. */
export async function exchangeCode(
  config: RsoConfig,
  options: { code: string; codeVerifier: string; fetchImpl?: typeof fetch },
): Promise<RsoTokens> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(RSO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // Client credentials go in the Authorization header rather than the body:
      // bodies end up in proxy logs far more often than headers do.
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: config.redirectUri,
      code_verifier: options.codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    throw new RsoError(`RSO token exchange failed with ${response.status}`, response.status);
  }

  const parsed = TokenResponseSchema.parse(await response.json());
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresInSeconds: parsed.expires_in ?? 600,
    idToken: parsed.id_token ?? null,
  };
}

/**
 * Reads the PUUID from an RSO id token.
 *
 * The token's signature is NOT verified here, and that is safe only because of
 * where this is called: the token came straight from Riot's token endpoint over
 * TLS in a request we initiated, not from the user. If this function is ever
 * reused on a token supplied by a client, it must verify against Riot's JWKS
 * first — hence the narrow name and this comment rather than a general
 * `decodeJwt` helper someone might reach for elsewhere.
 */
export function puuidFromIdToken(idToken: string): string | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      sub?: unknown;
    };
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}
