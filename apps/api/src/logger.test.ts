import { CommitOutcomeUnknownError } from '@tinnox/db';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { serializeError } from './logger.ts';

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
      code: '23505',
    });
    expect(JSON.stringify(logged)).not.toContain('secret value');
  });

  it('says only that something that is not an error was thrown', () => {
    expect(serializeError('a string')).toEqual({ message: 'non-error value thrown' });
  });
});
