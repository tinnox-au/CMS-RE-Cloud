/**
 * One error type and one envelope for every non-2xx response. Responses never
 * carry stack traces, SQL text or internal messages.
 */
import { apiError, HEADERS, type ApiErrorCode, type ApiErrorDetail } from '@tinnox/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details: ApiErrorDetail[] | undefined;
  readonly headers: Readonly<Record<string, string>> | undefined;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    options: { details?: ApiErrorDetail[]; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export const notFound = (what = 'The requested item'): HttpError =>
  new HttpError(404, 'not_found', `${what} was not found.`);

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Validates untrusted input with a contract schema; throws 400 `validation_failed` with field details. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  what: string,
): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const details: ApiErrorDetail[] = result.error.issues.slice(0, 50).map((issue) => ({
    path: clip(issue.path.map(String).join('.') || what, 200),
    message: clip(issue.message, 500),
  }));
  throw new HttpError(400, 'validation_failed', `The ${what} is not valid.`, { details });
}

/** PostgreSQL error code of an unknown error, or null. */
export function pgErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

const STATUS_CODES: Readonly<Record<number, ApiErrorCode>> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  406: 'bad_request',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
  503: 'service_unavailable',
};

const SAFE_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  bad_request: 'The request could not be understood.',
  unauthenticated: 'Sign in to continue.',
  forbidden: 'This action is not allowed.',
  not_found: 'The requested item was not found.',
  conflict: 'The request conflicts with the current state.',
  payload_too_large: 'The request body is too large.',
  unsupported_media_type: 'The request content type is not supported.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  service_unavailable: 'The service is temporarily unavailable.',
};

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  details?: ApiErrorDetail[],
): void {
  void reply
    .code(statusCode)
    .header('cache-control', 'no-store')
    .type('application/json; charset=utf-8')
    .send(
      apiError(code, clip(message, 500), {
        ...(details === undefined ? {} : { details: details.slice(0, 100) }),
        requestId: request.id,
      }),
    );
}

/**
 * Errors the router raises before any hook runs (over-long parameter, malformed URL
 * encoding). No route matched, so helmet and the request-id hook have not run either:
 * set the same hardening headers here and answer like an unknown address, without
 * echoing the path or naming framework internals.
 */
export function sendFrameworkError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  void reply
    .header(HEADERS.requestId, request.id)
    .header(
      'content-security-policy',
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
    .header('x-content-type-options', 'nosniff')
    .header('x-frame-options', 'DENY')
    .header('referrer-policy', 'no-referrer')
    .header('cross-origin-resource-policy', 'same-origin');
  if (error.code === 'FST_ERR_MAX_PARAM_LENGTH' || error.code === 'FST_ERR_BAD_URL') {
    send(request, reply, 404, 'not_found', 'There is nothing at this address.');
    return;
  }
  request.log.error({ err: { name: error.name, code: error.code } }, 'router error');
  send(request, reply, 500, 'internal_error', 'Something went wrong. Try again.');
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header(HEADERS.requestId, request.id);
  });

  app.setNotFoundHandler((request, reply) => {
    send(request, reply, 404, 'not_found', 'There is nothing at this address.');
  });

  app.setErrorHandler((error: FastifyError | HttpError | Error, request, reply) => {
    if (reply.sent || reply.raw.headersSent) {
      // A streamed response failed part-way; the connection is torn down by Fastify.
      request.log.warn({ err: { name: error.name, message: error.message } }, 'response aborted');
      return;
    }
    if (error instanceof HttpError) {
      if (error.headers !== undefined) {
        for (const [name, value] of Object.entries(error.headers)) reply.header(name, value);
      }
      send(request, reply, error.statusCode, error.code, error.message, error.details);
      return;
    }

    // Database errors that mean "that row is not yours" (docs/dev-handoff.md section 5):
    // answered as not found, never as a message that confirms another tenant's row.
    const pg = pgErrorCode(error);
    if (pg === '42501') {
      request.log.warn({ pgCode: pg }, 'database refused the statement');
      send(request, reply, 404, 'not_found', 'The requested item was not found.');
      return;
    }
    if (pg !== null) {
      request.log.error({ pgCode: pg, err: { name: error.name } }, 'unhandled database error');
      send(request, reply, 500, 'internal_error', 'Something went wrong. Try again.');
      return;
    }

    const status = (error as FastifyError).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const code = STATUS_CODES[status] ?? 'bad_request';
      // Framework messages (malformed JSON, unsupported content type) are generic and safe,
      // but the fixed text keeps the envelope free of parser internals.
      send(request, reply, status, code, SAFE_MESSAGES[code] ?? 'The request was rejected.');
      return;
    }

    request.log.error({ err: error }, 'unhandled error');
    send(request, reply, 500, 'internal_error', 'Something went wrong. Try again.');
  });
}
