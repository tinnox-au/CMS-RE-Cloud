import { withOrg, type Pool, type Tx } from '@tinnox/db';
import type { HttpError } from './errors.ts';

export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  throw new Error('expected a timestamp from the database');
}

export function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

/** Converts an int8 column (returned as a string by pg) to a safe number. */
export function bigintToNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('database returned an out-of-range integer');
  return n;
}

export type Decision<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: HttpError };

export const accept = <T>(value: T): Decision<T> => ({ ok: true, value });
export const refuse = (error: HttpError): Decision<never> => ({ ok: false, error });

/**
 * Runs `fn` inside `withOrg` and COMMITS whatever it wrote, then throws the
 * refusal if there is one. Use it when a refused request must still leave a
 * committed trace (an audit event, a failed-attempt counter). Throwing inside
 * `fn` still rolls everything back.
 */
export async function withOrgDecision<T>(
  pool: Pool,
  orgId: string,
  fn: (tx: Tx) => Promise<Decision<T>>,
): Promise<T> {
  const decision = await withOrg(pool, orgId, fn);
  if (!decision.ok) throw decision.error;
  return decision.value;
}
