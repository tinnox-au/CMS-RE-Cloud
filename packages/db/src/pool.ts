import pg from 'pg';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
export type QueryResult<R extends pg.QueryResultRow = pg.QueryResultRow> = pg.QueryResult<R>;
export type QueryResultRow = pg.QueryResultRow;

export interface CreatePoolOptions {
  readonly connectionString: string;
  /** Shown in pg_stat_activity. */
  readonly applicationName?: string;
  /** Maximum pooled connections. Default 10. */
  readonly max?: number;
  /** Server-side statement timeout in milliseconds. Default 15000. */
  readonly statementTimeoutMs?: number;
}

/**
 * Creates a connection pool for the runtime role tinnox_app (DATABASE_URL). Migrations
 * and the seed connect as tinnox_migrator with their own clients, never through this.
 * int8 values (bigint ids, seq, bytes) are returned as strings by pg; convert deliberately.
 *
 * The timeouts and row security are sent as connection startup parameters, which take
 * precedence over role and database defaults. tinnox_app can change its own role
 * defaults (ALTER ROLE ... SET; PostgreSQL always allows that), so the API does not rely
 * on the defaults set in infra/postgres/init/01-roles.sh (review round 3, SCU-02).
 */
export function createPool(options: CreatePoolOptions): Pool {
  if (typeof options.connectionString !== 'string' || options.connectionString === '') {
    throw new Error('database connection string is not configured');
  }
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName ?? 'tinnox',
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 30_000,
    options: '-c row_security=on',
  });
  // An idle client that errors (server restart, network drop) must not crash the process;
  // pg removes it from the pool and the next query gets a fresh connection.
  pool.on('error', () => undefined);
  return pool;
}

/** Throws unless the connection string's user is exactly `expectedRole`. Guards against running the API as the migrator. */
export function assertConnectionRole(connectionString: string, expectedRole: string): void {
  let user: string;
  try {
    user = decodeURIComponent(new URL(connectionString).username);
  } catch {
    throw new Error('database connection string is not a valid URL');
  }
  if (user !== expectedRole) {
    throw new Error(`database connection must use role ${expectedRole}`);
  }
}
