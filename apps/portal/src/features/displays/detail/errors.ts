import { isApiRequestError } from '../../../api/client.ts';

/** The API error code of what was thrown, or null for anything else. */
export function apiErrorCode(error: unknown): string | null {
  return isApiRequestError(error) ? error.code : null;
}

/** The message of what was thrown, as `ErrorNotice` shows it. */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  return 'An unexpected error occurred.';
}
