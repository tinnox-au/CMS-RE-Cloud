/**
 * The member-management SQL the API and TINNOX's provisioning scripts share, so the lock key
 * and the lock order exist once (db/migrations/0013_roles_and_members.sql,
 * docs/portal-v2/stage-c.md section 6.8).
 */
import type { Tx } from './tx.ts';

/**
 * Takes the per-organisation membership lock of the current withOrg transaction, the key the
 * 0013 trigger uses ('tinnox.membership:' || org). Every member-management transaction takes
 * it first. Throws when there is no organisation context (pg_advisory_xact_lock(NULL) would
 * silently take no lock). A lock timeout (55P03) is thrown as the pg error; the API's
 * wrappers map it.
 */
export async function lockOrgMembership(tx: Tx): Promise<void> {
  const { rows } = await tx.query<{ in_org: boolean }>(
    `SELECT app_org_id() IS NOT NULL AS in_org,
            pg_advisory_xact_lock(hashtextextended('tinnox.membership:' || app_org_id()::text, 0))`,
  );
  if (rows[0]?.in_org !== true) {
    throw new Error('lockOrgMembership requires an organisation context (withOrg)');
  }
}

export interface MembershipCheck {
  /** The role as stored; the API narrows it. */
  readonly role: string;
  readonly removedAt: string | null;
  /** The member's sessions were ended at or after the session's creation. */
  readonly cutOff: boolean;
}

/**
 * The member row as the in-write role check reads it, share-locked until commit. Null when it
 * is not in this organisation. cutOff: the member's sessions were ended at or after the
 * session's creation (removal, demotion, sign out everywhere, mfa-reset).
 *
 * `sessionCreatedAt` is the session's `createdAt` (SessionLookup), the same test
 * sec.session_by_id_hash applies. It has whole milliseconds, so the comparison errs toward
 * refusing.
 */
export async function membershipForCheck(
  tx: Tx,
  membershipId: string,
  sessionCreatedAt: string,
): Promise<MembershipCheck | null> {
  const { rows } = await tx.query<{ role: string; removed_at: Date | null; cut_off: boolean }>(
    `SELECT role, removed_at,
            (sessions_valid_after IS NOT NULL AND sessions_valid_after >= $2) AS cut_off
     FROM membership WHERE id = $1 AND org_id = app_org_id() FOR SHARE`,
    [membershipId, sessionCreatedAt],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    role: r.role,
    removedAt: r.removed_at === null ? null : r.removed_at.toISOString(),
    cutOff: r.cut_off,
  };
}
