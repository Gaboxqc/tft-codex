/**
 * Reads the session cookie in a server component.
 *
 * The API's session cookie is httpOnly, so client script cannot see it and a
 * server component has to forward it explicitly. That is a little more code
 * than a global fetch wrapper would be, and it is the right trade: a personal
 * request has to be written as one, so no page accidentally leaks per-user
 * data into a shared cache (design.md §10).
 *
 * _Requirements: 7.1, 7.4_
 */
import { cookies } from 'next/headers';

const SESSION_COOKIE = 'tftc_session';

/** The forwardable cookie header, or null when signed out. */
export async function sessionCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  return value ? `${SESSION_COOKIE}=${value}` : null;
}

export async function isSignedIn(): Promise<boolean> {
  return (await sessionCookie()) !== null;
}
