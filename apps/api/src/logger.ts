/**
 * Logging rules (D16): no credentials, cookies, CSRF tokens, pairing codes,
 * signed URLs or file contents in logs. Requests are logged by path only - the
 * query string (which carries `sig`, `code` and `state`) is never written.
 */
import { REDACTED_HEADERS, REDACTED_QUERY_PARAMS } from '@tinnox/contracts';
import { pino, type Logger } from 'pino';

const SECRET_FIELDS = [
  'token',
  'deviceToken',
  'pollingToken',
  'csrfToken',
  'idToken',
  'id_token',
  'access_token',
  'refresh_token',
  'code',
  'code_verifier',
  'password',
  'secret',
  'url',
  ...REDACTED_QUERY_PARAMS,
] as const;

export const REDACT_PATHS: string[] = [
  ...REDACTED_HEADERS.flatMap((header) => [
    `req.headers["${header}"]`,
    `res.headers["${header}"]`,
    `headers["${header}"]`,
  ]),
  ...SECRET_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];

/** Path of a request URL, without the query string. */
export function pathOnly(url: string | undefined): string {
  if (url === undefined) return '';
  const index = url.indexOf('?');
  return (index === -1 ? url : url.slice(0, index)).slice(0, 300);
}

function errorFields(error: Error): Record<string, unknown> {
  const code = (error as { code?: unknown }).code;
  return {
    type: error.name,
    message: error.message.slice(0, 500),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

/**
 * How an error is logged: name, message, code and stack, and the same for its cause (one
 * level), so a wrapper such as CommitOutcomeUnknownError still says what went wrong
 * underneath. Never the bind values or detail of a database error.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: 'non-error value thrown' };
  const cause = (error as { cause?: unknown }).cause;
  return {
    ...errorFields(error),
    ...(cause instanceof Error ? { cause: errorFields(cause) } : {}),
    stack: error.stack,
  };
}

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req(request: { method?: string; url?: string; id?: unknown }) {
        return { id: request.id, method: request.method, path: pathOnly(request.url) };
      },
      res(reply: { statusCode?: number }) {
        return { statusCode: reply.statusCode };
      },
      err: serializeError,
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}
