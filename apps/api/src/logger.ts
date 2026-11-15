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
      err(error: unknown) {
        // Name, message and stack only; never the bind values or detail of a database error.
        if (!(error instanceof Error)) return { message: 'non-error value thrown' };
        const code = (error as { code?: unknown }).code;
        return {
          type: error.name,
          message: error.message.slice(0, 500),
          ...(typeof code === 'string' ? { code } : {}),
          stack: error.stack,
        };
      },
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
