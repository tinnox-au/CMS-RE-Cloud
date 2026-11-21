import {
  ApiErrorSchema,
  HEADERS,
  ROUTES,
  SessionResponseSchema,
  type ApiErrorCode,
  type ApiErrorDetail,
  type SessionResponse,
} from '@tinnox/contracts';
import type { z } from 'zod';

/** Codes produced by the API, plus codes for failures the portal detects itself. */
export type ClientErrorCode =
  ApiErrorCode | 'network_error' | 'invalid_response' | 'aborted' | 'no_session';

export interface ApiRequestErrorInit {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly message: string;
  readonly details?: readonly ApiErrorDetail[];
  readonly requestId?: string | null;
  /** True when code and message come from the API's error envelope. */
  readonly fromApi: boolean;
  /** How long the server asked to wait before trying again (`Retry-After`), if it said. */
  readonly retryAfterMs?: number | null;
}

/** The one error type thrown by the API client and the upload helper. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: readonly ApiErrorDetail[];
  readonly requestId: string | null;
  readonly fromApi: boolean;
  /** From a `Retry-After` header (a 429 or 503 answer); null when there was none. */
  readonly retryAfterMs: number | null;

  constructor(init: ApiRequestErrorInit) {
    super(init.message);
    this.name = 'ApiRequestError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.requestId = init.requestId ?? null;
    this.fromApi = init.fromApi;
    this.retryAfterMs = init.retryAfterMs ?? null;
  }
}

/** The longest `Retry-After` taken at its word; a larger value is read as this. */
export const MAX_RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Reads a `Retry-After` header: delay-seconds or an HTTP date (RFC 9110, 10.2.3). Null when
 * the header is missing or unreadable; a date in the past reads as 0.
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (header === null) return null;
  const text = header.trim();
  if (/^\d{1,10}$/.test(text)) return Math.min(Number(text) * 1000, MAX_RETRY_AFTER_MS);
  if (!/[a-z]/i.test(text)) return null;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), MAX_RETRY_AFTER_MS);
}

export function isApiRequestError(value: unknown): value is ApiRequestError {
  return value instanceof ApiRequestError;
}

export function isAbort(value: unknown): boolean {
  return isApiRequestError(value) && value.code === 'aborted';
}

/**
 * The API refused the request because the member's role lacks its key ("Your role doesn't
 * allow this."). `csrf_failed` and `origin_not_allowed` are 403 too, but never this.
 */
export function isRoleRefusal(value: unknown): value is ApiRequestError {
  return (
    isApiRequestError(value) && value.status === 403 && value.code === 'forbidden' && value.fromApi
  );
}

/**
 * True when the request may or may not have been carried out by the server:
 * no response, an unreadable response, a server fault or throttling.
 */
export function isOutcomeUnknown(error: unknown): boolean {
  if (!isApiRequestError(error)) return true;
  if (error.code === 'network_error' || error.code === 'invalid_response') return true;
  if (error.code === 'aborted') return true;
  return error.status >= 500 || error.status === 429;
}

const MAX_ERROR_BODY_CHARS = 64 * 1024;

/** Turns a non-2xx response into an ApiRequestError, using the API's envelope when it is valid. */
export function errorFromResponse(
  status: number,
  bodyText: string,
  requestIdHeader: string | null,
  retryAfterHeader: string | null = null,
): ApiRequestError {
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  let parsed: unknown = null;
  if (bodyText.length > 0 && bodyText.length <= MAX_ERROR_BODY_CHARS) {
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null;
    }
  }
  const envelope = ApiErrorSchema.safeParse(parsed);
  if (envelope.success) {
    const { code, message, details, requestId } = envelope.data.error;
    return new ApiRequestError({
      status,
      code,
      message,
      details: details ?? [],
      requestId: requestId ?? requestIdHeader,
      fromApi: true,
      retryAfterMs,
    });
  }
  return new ApiRequestError({
    status,
    code: status === 401 ? 'unauthenticated' : 'invalid_response',
    message:
      status === 401
        ? 'You are not signed in.'
        : `The server answered with HTTP ${status} and no readable error description.`,
    requestId: requestIdHeader,
    fromApi: false,
    retryAfterMs,
  });
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientDeps {
  readonly fetch: FetchLike;
  /** Called when the API says the session is missing or has ended. */
  readonly onUnauthenticated: () => void;
  /** Called when the API refuses a request by role (403 `forbidden`); the session reloads. */
  readonly onForbidden?: () => void;
  /**
   * Called when a request made for one member met another member's session (someone signed in
   * as another person in this browser); the session reloads and the portal starts again.
   */
  readonly onSessionChanged?: () => void;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  readonly method?: HttpMethod;
  readonly path: string;
  /** Sent as JSON. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface ApiClient {
  /** Calls the API and validates the JSON answer with `schema`. */
  request<T>(options: RequestOptions, schema: z.ZodType<T>): Promise<T>;
  /** Calls the API and ignores any response body. */
  requestNoContent(options: RequestOptions): Promise<void>;
  /** `GET /api/session`; remembers the CSRF token in memory. */
  loadSession(signal?: AbortSignal): Promise<SessionResponse>;
  getCsrfToken(): string | null;
  /** Forgets the CSRF token (after sign-out). */
  clearSession(): void;
  /** For callers that talk to the API without `request` (uploads) and receive a 401. */
  notifyUnauthenticated(): void;
  /** For callers that talk to the API without `request` (uploads) and receive a 403 `forbidden`. */
  notifyForbidden(): void;
}

const STATE_CHANGING: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** The CSRF token of the current session and the member and organisation it belongs to. */
interface Credential {
  readonly csrfToken: string;
  /** `<organization id>/<membership id>`. */
  readonly member: string;
}

function credentialOf(session: SessionResponse): Credential | null {
  if (!session.authenticated) return null;
  return {
    csrfToken: session.csrfToken,
    member: `${session.organization.id.toLowerCase()}/${session.user.membershipId.toLowerCase()}`,
  };
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  // The CSRF token lives only in this closure: never in web storage, a cookie or the URL.
  let credential: Credential | null = null;

  function notifyUnauthenticated(): void {
    credential = null;
    deps.onUnauthenticated();
  }

  function notifyForbidden(): void {
    deps.onForbidden?.();
  }

  /** A 401 returns the person to sign-in; a refusal by role reloads the session. */
  function noticeRefusal(error: ApiRequestError, path: string): void {
    if (error.status === 401) {
      if (path !== ROUTES.session) notifyUnauthenticated();
    } else if (isRoleRefusal(error)) {
      notifyForbidden();
    }
  }

  /** Sends one request; a state-changing one carries the CSRF token of `sentWith`. */
  async function send(
    options: RequestOptions,
    sentWith: Credential | null,
  ): Promise<{ status: number; text: string }> {
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    // The one public write: the alert confirmation page has no session, so no CSRF token.
    if (STATE_CHANGING.has(method) && options.path !== ROUTES.alertRecipientConfirm) {
      if (sentWith === null) {
        throw new ApiRequestError({
          status: 0,
          code: 'no_session',
          message: 'There is no active session. Sign in again.',
          fromApi: false,
        });
      }
      headers[HEADERS.csrf] = sentWith.csrfToken;
    }
    const init: RequestInit = {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      // The JSON API never redirects; refusing redirects keeps credentials on this origin.
      redirect: 'error',
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    if (options.signal !== undefined) init.signal = options.signal;

    let response: Response;
    let text: string;
    try {
      response = await deps.fetch(options.path, init);
      text = await response.text();
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted === true) {
        throw new ApiRequestError({
          status: 0,
          code: 'aborted',
          message: 'The request was cancelled.',
          fromApi: false,
        });
      }
      throw new ApiRequestError({
        status: 0,
        code: 'network_error',
        message: 'The server could not be reached. Check the connection and try again.',
        fromApi: false,
      });
    }
    if (response.ok) return { status: response.status, text };
    throw errorFromResponse(
      response.status,
      text,
      response.headers.get(HEADERS.requestId),
      response.headers.get('retry-after'),
    );
  }

  async function sendWithRecovery(
    options: RequestOptions,
  ): Promise<{ status: number; text: string }> {
    // The member the request is made for: the one whose token it carries.
    const sentWith = credential;
    try {
      return await send(options, sentWith);
    } catch (error) {
      if (!isApiRequestError(error)) throw error;
      // A rejected CSRF token means the request was not carried out. The token may simply be
      // out of date (session renewed in another tab), so fetch it again and retry exactly once.
      if (error.code === 'csrf_failed' && error.fromApi && options.path !== ROUTES.session) {
        const session = await loadSession(options.signal);
        if (!session.authenticated) {
          notifyUnauthenticated();
          throw error;
        }
        const now = credentialOf(session);
        if (sentWith === null || now?.member !== sentWith.member) {
          // Someone signed in as another person, or in another organisation, in this browser.
          // The request was meant for the member it was made for, so it is never sent again
          // as the new one; no write goes out until the portal has started again.
          credential = null;
          deps.onSessionChanged?.();
          throw error;
        }
        try {
          return await send(options, now);
        } catch (retryError) {
          if (isApiRequestError(retryError)) noticeRefusal(retryError, options.path);
          throw retryError;
        }
      }
      noticeRefusal(error, options.path);
      throw error;
    }
  }

  function parseBody<T>(text: string, schema: z.ZodType<T>, status: number): T {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiRequestError({
        status,
        code: 'invalid_response',
        message: 'The server sent a response that is not valid JSON.',
        fromApi: false,
      });
    }
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new ApiRequestError({
        status,
        code: 'invalid_response',
        message:
          'The server sent a response this version of the portal does not understand. Nothing was assumed from it.',
        details: result.error.issues.slice(0, 5).map((issue) => ({
          path: issue.path.map(String).join('.').slice(0, 200),
          message: issue.message.slice(0, 500),
        })),
        fromApi: false,
      });
    }
    return result.data;
  }

  async function request<T>(options: RequestOptions, schema: z.ZodType<T>): Promise<T> {
    const { status, text } = await sendWithRecovery(options);
    return parseBody(text, schema, status);
  }

  async function requestNoContent(options: RequestOptions): Promise<void> {
    await sendWithRecovery(options);
  }

  async function loadSession(signal?: AbortSignal): Promise<SessionResponse> {
    let session: SessionResponse;
    try {
      const options: RequestOptions =
        signal === undefined ? { path: ROUTES.session } : { path: ROUTES.session, signal };
      const { status, text } = await send(options, null);
      session = parseBody(text, SessionResponseSchema, status);
    } catch (error) {
      // Some deployments answer 401 instead of `{ authenticated: false }`; both mean signed out.
      if (isApiRequestError(error) && error.status === 401) {
        credential = null;
        return { authenticated: false };
      }
      throw error;
    }
    credential = credentialOf(session);
    return session;
  }

  return {
    request,
    requestNoContent,
    loadSession,
    getCsrfToken: () => credential?.csrfToken ?? null,
    clearSession: () => {
      credential = null;
    },
    notifyUnauthenticated,
    notifyForbidden,
  };
}
