/**
 * Where to send someone to link their Riot account.
 *
 * Its own module, separate from `session.ts`, because that one imports
 * `next/headers` and so cannot be pulled into a client bundle at all. A client
 * component needs the sign-in URL without needing — or being able to read —
 * the session itself, which is exactly the split R7.1 wants: the cookie is
 * httpOnly and stays server-side, the sign-in link is public.
 *
 * _Requirements: 7.1_
 */
export function signInHref(redirectTo = '/'): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
  return `${base}/v1/auth/riot/start?redirect_to=${encodeURIComponent(redirectTo)}`;
}
