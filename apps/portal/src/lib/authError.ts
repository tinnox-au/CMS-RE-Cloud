import { AUTH_ERROR_CODES, type AuthErrorCode } from '@tinnox/contracts';

/** The query parameter the API's sign-in callback adds to the portal root after a failure. */
const AUTH_ERROR_PARAM = 'authError';

const MESSAGES: { readonly [C in AuthErrorCode]: string } = {
  no_membership:
    'This sign-in account has no access to TINNOX CMS. If you were removed, or have not been set up yet, ask the Owner or an Admin of your organisation.',
  reauth_failed:
    'Sign in again with your password and one-time code. If this keeps happening, contact TINNOX support.',
  mfa_required: 'Your sign-in did not include a one-time code. Sign in again.',
  state: 'The sign-in took too long or was started in another tab. Sign in again.',
  provider: 'The sign-in service did not accept the sign-in. Sign in again.',
  provider_unavailable: 'The sign-in service is not responding. Try again in a few minutes.',
};

function isAuthErrorCode(value: string): value is AuthErrorCode {
  return (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Reads why the last sign-in failed from `?authError=` and removes the parameter from the
 * address bar, keeping the path, the other query parameters and the fragment. An unknown
 * value is removed too and reads as null.
 */
export function takeAuthError(): AuthErrorCode | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get(AUTH_ERROR_PARAM);
  if (value === null) return null;
  url.searchParams.delete(AUTH_ERROR_PARAM);
  window.history.replaceState(window.history.state, '', url);
  return isAuthErrorCode(value) ? value : null;
}

/** What the sign-in screen says for a failed sign-in. */
export function authErrorMessage(code: AuthErrorCode): string {
  return MESSAGES[code];
}
