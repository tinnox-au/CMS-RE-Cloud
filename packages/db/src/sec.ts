/**
 * Typed wrappers for the SECURITY DEFINER functions in schema `sec`
 * (db/migrations/0002_security_functions.sql). They take hashes, never raw
 * secrets: hash a token with `sha256` before calling.
 */
import { createHash } from 'node:crypto';
import type { Tx } from './tx.ts';

/** SHA-256 digest as a Buffer, the form stored in *_hash columns. */
export function sha256(value: string | Uint8Array): Buffer {
  return createHash('sha256').update(value).digest();
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  throw new Error('expected a timestamp from the database');
}

function only<R>(rows: R[]): R | null {
  return rows[0] ?? null;
}

export interface MembershipLookup {
  readonly membershipId: string;
  readonly orgId: string;
  readonly role: string;
  readonly orgName: string;
}

export async function membershipByOidcSub(
  tx: Tx,
  oidcSub: string,
): Promise<MembershipLookup | null> {
  const { rows } = await tx.query<{
    membership_id: string;
    org_id: string;
    role: string;
    org_name: string;
  }>('SELECT membership_id, org_id, role, org_name FROM sec.membership_by_oidc_sub($1)', [oidcSub]);
  const r = only(rows);
  return r === null
    ? null
    : { membershipId: r.membership_id, orgId: r.org_id, role: r.role, orgName: r.org_name };
}

export interface LoginState {
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly returnTo: string | null;
}

export async function loginStatePut(
  tx: Tx,
  input: {
    stateHash: Buffer;
    codeVerifier: string;
    nonce: string;
    returnTo: string | null;
    ttlSeconds: number;
  },
): Promise<void> {
  await tx.query('SELECT sec.login_state_put($1, $2, $3, $4, $5)', [
    input.stateHash,
    input.codeVerifier,
    input.nonce,
    input.returnTo,
    input.ttlSeconds,
  ]);
}

/** One-time: a second call with the same hash returns null. */
export async function loginStateTake(tx: Tx, stateHash: Buffer): Promise<LoginState | null> {
  const { rows } = await tx.query<{
    code_verifier: string;
    nonce: string;
    return_to: string | null;
  }>('SELECT code_verifier, nonce, return_to FROM sec.login_state_take($1)', [stateHash]);
  const r = only(rows);
  return r === null
    ? null
    : { codeVerifier: r.code_verifier, nonce: r.nonce, returnTo: r.return_to };
}

export interface SessionCreated {
  readonly membershipId: string;
  readonly orgId: string;
  readonly role: string;
  readonly expiresAt: string;
}

/** Returns null when the subject has no membership (sign-in must then be refused). */
export async function sessionCreate(
  tx: Tx,
  input: {
    idHash: Buffer;
    oidcSub: string;
    csrfToken: string;
    ttlSeconds: number;
    idToken: string | null;
  },
): Promise<SessionCreated | null> {
  const { rows } = await tx.query<{
    membership_id: string;
    org_id: string;
    role: string;
    expires_at: Date;
  }>('SELECT membership_id, org_id, role, expires_at FROM sec.session_create($1, $2, $3, $4, $5)', [
    input.idHash,
    input.oidcSub,
    input.csrfToken,
    input.ttlSeconds,
    input.idToken,
  ]);
  const r = only(rows);
  return r === null
    ? null
    : {
        membershipId: r.membership_id,
        orgId: r.org_id,
        role: r.role,
        expiresAt: iso(r.expires_at),
      };
}

export interface SessionLookup {
  readonly membershipId: string;
  readonly orgId: string;
  readonly oidcSub: string;
  readonly role: string;
  readonly orgName: string;
  readonly csrfToken: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** Returns the live session and records activity, or null when missing, expired, idle or revoked. */
export async function sessionByIdHash(
  tx: Tx,
  idHash: Buffer,
  idleTimeoutSeconds: number,
): Promise<SessionLookup | null> {
  const { rows } = await tx.query<{
    membership_id: string;
    org_id: string;
    oidc_sub: string;
    role: string;
    org_name: string;
    csrf_token: string;
    created_at: Date;
    expires_at: Date;
  }>(
    'SELECT membership_id, org_id, oidc_sub, role, org_name, csrf_token, created_at, expires_at FROM sec.session_by_id_hash($1, $2)',
    [idHash, idleTimeoutSeconds],
  );
  const r = only(rows);
  return r === null
    ? null
    : {
        membershipId: r.membership_id,
        orgId: r.org_id,
        oidcSub: r.oidc_sub,
        role: r.role,
        orgName: r.org_name,
        csrfToken: r.csrf_token,
        createdAt: iso(r.created_at),
        expiresAt: iso(r.expires_at),
      };
}

/** Ends the session. Returns null when there was no live session. */
export async function sessionRevoke(
  tx: Tx,
  idHash: Buffer,
): Promise<{ membershipId: string; orgId: string; idToken: string | null } | null> {
  const { rows } = await tx.query<{
    membership_id: string;
    org_id: string;
    id_token: string | null;
  }>('SELECT membership_id, org_id, id_token FROM sec.session_revoke($1)', [idHash]);
  const r = only(rows);
  return r === null
    ? null
    : { membershipId: r.membership_id, orgId: r.org_id, idToken: r.id_token };
}

export async function sessionPurgeExpired(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ n: number }>('SELECT sec.session_purge_expired() AS n');
  return rows[0]?.n ?? 0;
}

export type PairingCreateResult =
  | { readonly outcome: 'created'; readonly pairingId: string; readonly expiresAt: string }
  | { readonly outcome: 'rate_limited' }
  | { readonly outcome: 'code_collision' };

export async function pairingCreate(
  tx: Tx,
  input: {
    code: string;
    pollingTokenHash: Buffer;
    /** Opaque rate-limit key, for example an HMAC of the client address. */
    clientKey: string;
    ttlSeconds: number;
    maxSessionsPerClient: number;
    windowSeconds: number;
  },
): Promise<PairingCreateResult> {
  const { rows } = await tx.query<{
    outcome: string;
    pairing_id: string | null;
    expires_at: Date | null;
  }>('SELECT outcome, pairing_id, expires_at FROM sec.pairing_create($1, $2, $3, $4, $5, $6)', [
    input.code,
    input.pollingTokenHash,
    input.clientKey,
    input.ttlSeconds,
    input.maxSessionsPerClient,
    input.windowSeconds,
  ]);
  const r = only(rows);
  if (r === null) throw new Error('sec.pairing_create returned no row');
  if (r.outcome === 'created' && r.pairing_id !== null) {
    return { outcome: 'created', pairingId: r.pairing_id, expiresAt: iso(r.expires_at) };
  }
  if (r.outcome === 'rate_limited' || r.outcome === 'code_collision') return { outcome: r.outcome };
  throw new Error(`unexpected pairing_create outcome ${r.outcome}`);
}

/**
 * `wrong_token_locked` is the wrong token that locked the session (once per session):
 * audit it in the same transaction as the poll. Later polls answer `locked`.
 */
export const PAIRING_POLL_OUTCOMES = [
  'pending',
  'claimed',
  'completed',
  'expired',
  'locked',
  'not_found',
  'wrong_token',
  'wrong_token_locked',
] as const;
export type PairingPollOutcome = (typeof PAIRING_POLL_OUTCOMES)[number];

export async function pairingPoll(
  tx: Tx,
  input: { pairingId: string; pollingTokenHash: Buffer; maxWrongAttempts: number },
): Promise<{ outcome: PairingPollOutcome; expiresAt: string | null }> {
  const { rows } = await tx.query<{ outcome: string; expires_at: Date | null }>(
    'SELECT outcome, expires_at FROM sec.pairing_poll($1, $2, $3)',
    [input.pairingId, input.pollingTokenHash, input.maxWrongAttempts],
  );
  const r = only(rows);
  if (r === null || !(PAIRING_POLL_OUTCOMES as readonly string[]).includes(r.outcome)) {
    throw new Error('unexpected pairing_poll result');
  }
  return {
    outcome: r.outcome as PairingPollOutcome,
    expiresAt: r.expires_at === null ? null : iso(r.expires_at),
  };
}

export type PairingClaimResult =
  | {
      readonly outcome: 'claimed';
      readonly pairingId: string;
      readonly replacedRegistrationId: string | null;
      /** Older claims of the display, never collected, that this claim cancelled. */
      readonly cancelledPairingIds: readonly string[];
    }
  | { readonly outcome: 'invalid_code' | 'display_not_found' | 'rate_limited' };

/** Must be called with a Tx from `withOrg`; the organisation is taken from the transaction context. */
export async function pairingClaim(
  tx: Tx,
  input: {
    code: string;
    displayId: string;
    membershipId: string;
    maxFailures: number;
    windowSeconds: number;
  },
): Promise<PairingClaimResult> {
  const { rows } = await tx.query<{
    outcome: string;
    pairing_id: string | null;
    replaced_registration_id: string | null;
    cancelled_pairing_ids: string[] | null;
  }>(
    'SELECT outcome, pairing_id, replaced_registration_id, cancelled_pairing_ids FROM sec.pairing_claim($1, $2, $3, $4, $5)',
    [input.code, input.displayId, input.membershipId, input.maxFailures, input.windowSeconds],
  );
  const r = only(rows);
  if (r === null) throw new Error('sec.pairing_claim returned no row');
  if (r.outcome === 'claimed' && r.pairing_id !== null) {
    return {
      outcome: 'claimed',
      pairingId: r.pairing_id,
      replacedRegistrationId: r.replaced_registration_id,
      cancelledPairingIds: r.cancelled_pairing_ids ?? [],
    };
  }
  if (
    r.outcome === 'invalid_code' ||
    r.outcome === 'display_not_found' ||
    r.outcome === 'rate_limited'
  ) {
    return { outcome: r.outcome };
  }
  throw new Error(`unexpected pairing_claim outcome ${r.outcome}`);
}

/**
 * Cancels the display's claims that its player has not collected yet, so none of them
 * can complete. Must be called with a Tx from `withOrg`, before the transaction touches
 * the display or its registrations. Returns the ids of the cancelled pairing sessions.
 */
export async function pairingCancelClaims(tx: Tx, displayId: string): Promise<string[]> {
  const { rows } = await tx.query<{ ids: string[] }>(
    'SELECT sec.pairing_cancel_claims($1) AS ids',
    [displayId],
  );
  return rows[0]?.ids ?? [];
}

export type PairingCompleteResult =
  | {
      readonly outcome: 'completed';
      readonly registrationId: string;
      readonly orgId: string;
      readonly displayId: string;
    }
  | { readonly outcome: 'not_claimable' };

/**
 * Succeeds once per pairing session. Pass the hash of a freshly generated device token.
 * Never replaces an active registration: if the display has one, a newer claim owns it,
 * and this pairing is cancelled and answers `not_claimable`.
 */
export async function pairingComplete(
  tx: Tx,
  input: { pairingId: string; pollingTokenHash: Buffer; deviceTokenHash: Buffer },
): Promise<PairingCompleteResult> {
  const { rows } = await tx.query<{
    outcome: string;
    registration_id: string | null;
    org_id: string | null;
    display_id: string | null;
  }>('SELECT outcome, registration_id, org_id, display_id FROM sec.pairing_complete($1, $2, $3)', [
    input.pairingId,
    input.pollingTokenHash,
    input.deviceTokenHash,
  ]);
  const r = only(rows);
  if (r === null) throw new Error('sec.pairing_complete returned no row');
  if (
    r.outcome === 'completed' &&
    r.registration_id !== null &&
    r.org_id !== null &&
    r.display_id !== null
  ) {
    return {
      outcome: 'completed',
      registrationId: r.registration_id,
      orgId: r.org_id,
      displayId: r.display_id,
    };
  }
  if (r.outcome === 'not_claimable') return { outcome: 'not_claimable' };
  throw new Error(`unexpected pairing_complete outcome ${r.outcome}`);
}

export async function pairingPurge(tx: Tx, olderThanSeconds: number): Promise<number> {
  const { rows } = await tx.query<{ n: number }>('SELECT sec.pairing_purge($1) AS n', [
    olderThanSeconds,
  ]);
  return rows[0]?.n ?? 0;
}

/** Removes heartbeat history older than `olderThanSeconds` (at least 3600) in every organisation. */
export async function heartbeatLogPurge(tx: Tx, olderThanSeconds: number): Promise<number> {
  const { rows } = await tx.query<{ n: number }>('SELECT sec.heartbeat_log_purge($1) AS n', [
    olderThanSeconds,
  ]);
  return rows[0]?.n ?? 0;
}

export interface DeviceLookup {
  readonly registrationId: string;
  readonly orgId: string;
  readonly displayId: string;
}

/** Null for an unknown or revoked token. */
export async function deviceByTokenHash(tx: Tx, tokenHash: Buffer): Promise<DeviceLookup | null> {
  const { rows } = await tx.query<{ registration_id: string; org_id: string; display_id: string }>(
    'SELECT registration_id, org_id, display_id FROM sec.device_by_token_hash($1)',
    [tokenHash],
  );
  const r = only(rows);
  return r === null
    ? null
    : { registrationId: r.registration_id, orgId: r.org_id, displayId: r.display_id };
}

export interface AuditInput {
  readonly actorType: 'operator' | 'player' | 'system' | 'anonymous';
  readonly actorId: string | null;
  readonly action: string;
  readonly objectType: string | null;
  readonly objectId: string | null;
  readonly result: 'success' | 'failure' | 'denied';
  /** Small structured context. Never file content, secrets or signed URLs. */
  readonly detail: Record<string, unknown> | null;
}

/** Appends an audit event for the organisation of the current `withOrg` transaction. */
export async function auditScoped(tx: Tx, event: AuditInput): Promise<void> {
  await tx.query(
    `INSERT INTO audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result, detail)
     VALUES (app_org_id(), $1, $2, $3, $4, $5, $6, $7)`,
    [
      event.actorType,
      event.actorId,
      event.action,
      event.objectType,
      event.objectId,
      event.result,
      event.detail === null ? null : JSON.stringify(event.detail),
    ],
  );
}

/** Appends an audit event that has no organisation (before sign-in, rejected device token). */
export async function auditUnscoped(tx: Tx, event: AuditInput): Promise<void> {
  await tx.query('SELECT sec.audit_unscoped($1, $2, $3, $4, $5, $6, $7)', [
    event.actorType,
    event.actorId,
    event.action,
    event.objectType,
    event.objectId,
    event.result,
    event.detail === null ? null : JSON.stringify(event.detail),
  ]);
}
