import type { Pool, PoolClient, QueryResult, QueryResultRow } from './pool.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The only handle request code gets on the database inside a transaction.
 * Always pass values as parameters; never build SQL from input.
 */
export interface Tx {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

function wrap(client: PoolClient): Tx {
  return {
    query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
      client.query<R>(text, values === undefined ? undefined : [...values]),
  };
}

async function run<T>(
  pool: Pool,
  begin: (client: PoolClient) => Promise<void>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    await begin(client);
    const result = await fn(wrap(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // The connection is in an unknown state; destroy it rather than return it to the pool.
      broken = rollbackError instanceof Error ? rollbackError : new Error('rollback failed');
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

/**
 * Runs `fn` in one transaction, on one pooled connection, with the tenant
 * context set for that transaction only (prototype-m0.md D4):
 *
 *   BEGIN; SELECT set_config('app.org_id', $1, true); ...fn...; COMMIT
 *
 * Row-level security then limits every statement in `fn` to `orgId`.
 * `orgId` must come from a verified session or device credential, never from
 * request input. The setting is transaction-local, so it cannot leak to the
 * next user of the pooled connection. Rolls back when `fn` throws.
 */
export async function withOrg<T>(
  pool: Pool,
  orgId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (typeof orgId !== 'string' || !UUID_PATTERN.test(orgId)) {
    throw new Error('withOrg requires a lower-case UUID organisation id');
  }
  return run(
    pool,
    async (client) => {
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    },
    fn,
  );
}

/**
 * Runs `fn` in one transaction with NO tenant context. Tenant tables show no
 * rows here. Use only for sec.* calls that happen before the organisation is known.
 */
export async function withoutOrg<T>(pool: Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return run(pool, async () => undefined, fn);
}

/** Minimal query interface satisfied by Pool, PoolClient and Tx. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

/** Adapts a pool for single-statement sec.* calls (each statement is its own transaction). */
export function poolAsTx(pool: Pool): Tx {
  return {
    query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
      pool.query<R>(text, values === undefined ? undefined : [...values]),
  };
}
