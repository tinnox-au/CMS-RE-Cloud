import { CommitOutcomeUnknownError } from '@tinnox/db';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createLogger, serializeError } from './logger.ts';

describe('serializeError', () => {
  it('keeps what went wrong underneath a wrapped error (review round 3, SCX-03)', () => {
    const logged = serializeError(
      new CommitOutcomeUnknownError(new Error('Connection terminated unexpectedly')),
    );
    expect(logged).toMatchObject({
      type: 'CommitOutcomeUnknownError',
      cause: { type: 'Error', message: 'Connection terminated unexpectedly' },
    });
  });

  it('logs a database error by name, message and code, never its detail or bind values', () => {
    const error = new pg.DatabaseError(
      'duplicate key value violates unique constraint',
      0,
      'error',
    );
    error.code = '23505';
    error.detail = 'Key (name)=(secret value) already exists.';
    const logged = serializeError(new CommitOutcomeUnknownError(error));
    expect(logged['cause']).toEqual({
      type: 'error',
      message: 'duplicate key value violates unique constraint',
      errorCode: '23505',
    });
    expect(JSON.stringify(logged)).not.toContain('secret value');
  });

  it('writes the error code to the log; a field named `code` would be redacted', () => {
    const lines: string[] = [];
    const logger = createLogger('info', false, { write: (line) => lines.push(line) });
    const deadlock = new pg.DatabaseError('deadlock detected', 0, 'error');
    deadlock.code = '40P01';
    const lost = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    logger.error({ err: deadlock }, 'refused');
    logger.error({ err: new CommitOutcomeUnknownError(lost) }, 'unknown');
    // The OAuth code of a callback, by contrast, must stay out of the log.
    logger.info({ query: { code: 'oauth-authorisation-code' } }, 'callback');

    const [refused, unknown, callback] = lines.map(
      (line) => JSON.parse(line) as { err?: Record<string, unknown>; query?: unknown },
    );
    expect(refused?.err).toMatchObject({ errorCode: '40P01' });
    expect(unknown?.err?.['cause']).toMatchObject({ errorCode: 'ECONNRESET' });
    expect(callback?.query).toEqual({ code: '[redacted]' });
    expect(lines.join('')).not.toContain('oauth-authorisation-code');
  });

  it('says only that something that is not an error was thrown', () => {
    expect(serializeError('a string')).toEqual({ message: 'non-error value thrown' });
  });
});
