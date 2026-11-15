import { describe, expect, it } from 'vitest';
import { decideAttempt, MAX_ATTEMPTS } from './attempts.ts';

describe('decideAttempt', () => {
  it('inspects a new job as attempt 1', () => {
    expect(decideAttempt(null)).toEqual({ action: 'inspect', attempt: 1 });
  });

  it('retries once after a worker that died for any reason', () => {
    expect(MAX_ATTEMPTS).toBe(2);
    expect(decideAttempt('1')).toEqual({ action: 'inspect', attempt: 2 });
    // Marker left by the previous worker version (empty file): one attempt was made.
    expect(decideAttempt('')).toEqual({ action: 'inspect', attempt: 2 });
  });

  it('rejects a file that has already killed the worker twice, or an unreadable marker', () => {
    expect(decideAttempt('2')).toEqual({ action: 'reject' });
    expect(decideAttempt('7')).toEqual({ action: 'reject' });
    expect(decideAttempt('not a number')).toEqual({ action: 'reject' });
    expect(decideAttempt('9'.repeat(20))).toEqual({ action: 'reject' });
  });
});
