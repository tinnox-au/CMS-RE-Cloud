import { readFileSync } from 'node:fs';
import { removeSavedStates, savedStateFiles } from './support/contexts.ts';
import { API_URL, PORTAL_URL, stopApi } from './support/stack.ts';

interface SavedState {
  cookies: { name: string; value: string; domain: string }[];
}

/**
 * Signs out every operator session this run saved (API session and, through the
 * end-session URL the API returns, the Keycloak session), then deletes the saved browser
 * states so no live cookie stays on disk. Best effort: a failure is reported, the files
 * are deleted regardless.
 */
async function signOutSavedSessions(): Promise<void> {
  for (const path of savedStateFiles()) {
    try {
      const state = JSON.parse(readFileSync(path, 'utf8')) as SavedState;
      const header = (names: (name: string) => boolean): string =>
        state.cookies
          .filter((c) => names(c.name))
          .map((c) => `${c.name}=${c.value}`)
          .join('; ');
      const apiCookie = header((name) => name.startsWith('tinnox_') || name.startsWith('__Host-'));
      if (apiCookie === '') continue;
      const session = (await (
        await fetch(`${API_URL}/api/session`, { headers: { cookie: apiCookie } })
      ).json()) as { authenticated: boolean; csrfToken?: string };
      if (!session.authenticated || session.csrfToken === undefined) continue;
      const logout = await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          cookie: apiCookie,
          origin: PORTAL_URL,
          'x-csrf-token': session.csrfToken,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      const { redirectTo } = (await logout.json()) as { redirectTo: string | null };
      if (redirectTo !== null) {
        const keycloakCookie = header(
          (name) => name.startsWith('KEYCLOAK_') || name === 'AUTH_SESSION_ID',
        );
        await fetch(redirectTo, { redirect: 'manual', headers: { cookie: keycloakCookie } });
      }
    } catch (error) {
      console.warn(
        `could not sign out a saved E2E session: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

export default async function globalTeardown(): Promise<void> {
  try {
    await signOutSavedSessions();
  } finally {
    removeSavedStates();
    await stopApi();
  }
}
