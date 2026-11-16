/**
 * What the transaction helpers do with the pooled connection when a transaction ends,
 * including the case the integration tests cannot produce on demand: a ROLLBACK that fails.
 */
import { describe, expect, it } from 'vitest';
import { withOrg, withoutOrg, withResolvedOrg, type Pool } from './index.ts';

const ORG = '00000000-0000-4000-8000-000000000001';

/** A pool with one connection that records its statements and how it was released. */
function fakePool(failing: readonly string[] = []) {
  const statements: string[] = [];
  const released: (Error | undefined)[] = [];
  const listeners = new Set<(error: Error) => void>();
  const client = {
    on: (_event: 'error', listener: (error: Error) => void) => listeners.add(listener),
    removeListener: (_event: 'error', listener: (error: Error) => void) =>
      listeners.delete(listener),
    query: (text: string) => {
      statements.push(text);
      return failing.includes(text)
        ? Promise.reject(new Error(`${text} failed`))
        : Promise.resolve({ rows: [] });
    },
    release: (error?: Error) => {
      released.push(error);
    },
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  /** What the pg client does when the server closes the connection. */
  const lose = (): void => {
    for (const listener of listeners) listener(new Error('Connection terminated unexpectedly'));
  };
  return { pool, statements, released, listeners, lose };
}

describe('pooled connection after a transaction', () => {
  it('goes back to the pool after a commit', async () => {
    const { pool, statements, released } = fakePool();
    expect(await withOrg(pool, ORG, () => Promise.resolve('done'))).toBe('done');
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(released).toEqual([undefined]);
  });

  it('goes back to the pool after a rollback that worked, and the work’s error is thrown', async () => {
    const { pool, statements, released } = fakePool();
    await expect(withoutOrg(pool, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(released).toEqual([undefined]);
  });

  it('is destroyed, not reused, when the rollback fails', async () => {
    for (const run of [
      (pool: Pool) => withOrg(pool, ORG, () => Promise.reject(new Error('boom'))),
      (pool: Pool) => withoutOrg(pool, () => Promise.reject(new Error('boom'))),
      (pool: Pool) =>
        withResolvedOrg(pool, async (_tx, enterOrg) => {
          await enterOrg(ORG);
          throw new Error('boom');
        }),
    ]) {
      const { pool, released } = fakePool(['ROLLBACK']);
      // The caller still sees why the work failed, not the rollback error.
      await expect(run(pool)).rejects.toThrow('boom');
      // pg destroys a client that is released with an error.
      expect(released).toHaveLength(1);
      expect(released[0]).toBeInstanceOf(Error);
      expect(released[0]?.message).toBe('ROLLBACK failed');
    }
  });

  it('listens for a lost connection while it is checked out, and destroys it', async () => {
    const { pool, released, listeners, lose } = fakePool();
    await withoutOrg(pool, () => {
      expect(listeners.size).toBe(1);
      lose();
      return Promise.resolve();
    });
    expect(released[0]?.message).toBe('Connection terminated unexpectedly');
    // The listener is gone again, so a pooled connection does not collect one per use.
    expect(listeners.size).toBe(0);
  });

  it('rolls back when the commit fails, and is destroyed if that fails too', async () => {
    const committing = fakePool(['COMMIT']);
    await expect(withoutOrg(committing.pool, () => Promise.resolve(1))).rejects.toThrow(
      'COMMIT failed',
    );
    expect(committing.statements).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
    expect(committing.released).toEqual([undefined]);

    const both = fakePool(['COMMIT', 'ROLLBACK']);
    await expect(withoutOrg(both.pool, () => Promise.resolve(1))).rejects.toThrow('COMMIT failed');
    expect(both.released[0]).toBeInstanceOf(Error);
  });
});
