/**
 * TINNOX's membership provisioning (docs/portal-v2/stage-c.md section 8.2): one exported function
 * per `provision-member` command, and the argument parser the CLI (scripts/provision-member.ts)
 * uses. TINNOX staff run it from a controlled host, never from the API's host or container.
 *
 * Every command:
 * - runs only as tinnox_migrator (assertMigrator checks current_user and session_user): the 0013
 *   exemptions test session_user, and the superuser, whose writes they would not cover, is refused;
 * - reads the identity provider before BEGIN and checks the database facts again inside one
 *   transaction, which also holds its audit rows (actor 'system', no time passed);
 * - reads across organisations only between SET LOCAL ROLE tinnox_definer and RESET ROLE, and
 *   writes membership and member_invite as the migrator with app.org_id taken from a row, never
 *   from an argument (both tables force row-level security on their owner). Exception: pending's
 *   expiry and its audit rows, which run as the definer;
 * - except pending, takes the organisation's membership lock (lockOrgMembership) before it
 *   touches membership or member_invite, as the API's member changes do.
 * Output goes to the staff terminal only; only pending prints names and e-mail addresses.
 */
import { randomUUID } from 'node:crypto';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import {
  ABSOLUTE,
  MemberNameSchema,
  RoleSchema,
  inviteReference,
  labelSchema,
  type Role,
} from '@tinnox/contracts';
import {
  STAGE_C_CONSTRAINTS,
  auditScoped,
  lockOrgMembership,
  sessionRevokeMembership,
  violatedConstraint,
  withOrg,
  withResolvedOrg,
  withoutOrg,
  type Pool,
  type Tx,
} from '@tinnox/db';
import { ROLE_LABELS, grantableRoles } from '@tinnox/domain';
import type { IdpAccount, IdpDirectory } from './idp.ts';

/** A wrong invocation. Nothing was read or written; the CLI prints the usage and exits 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** A refusal. Nothing was written (the transaction rolled back); the CLI exits 1. */
export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedError';
  }
}

export const USAGE = `Usage: npm run provision -- <command> [options]
  org-create --org-name <name> --timezone <IANA zone> [--site-name <name>]
             --owner <username>=<name> [--owner <username>=<name>] --request-ref <ref> --executed-by <staff>
  pending --executed-by <staff>
  fulfil <inviteId> --username <username> --confirmed-with <ref> --executed-by <staff>
  set-name (--membership <id> | --username <username>) --name <name> --request-ref <ref> --executed-by <staff>
  mfa-reset --username <username> --request-ref <ref> --executed-by <staff> [--confirmed-with <ref>]
  restore-owner --request-ref <ref> --executed-by <staff> --approved-by <other staff>
                (--promote <membershipId> | --successor <username>=<name> --replaces <membershipId>)
Staff ids: a-z, 0-9, ".", "_", "-" (2 to 40). References: no "@" or space (1 to 64).`;

// ---------------------------------------------------------------- arguments

export interface Person {
  readonly username: string;
  readonly name: string;
}
export interface OrgCreateArgs {
  readonly orgName: string;
  readonly timezone: string;
  readonly siteName: string;
  readonly owners: readonly Person[];
  readonly requestRef: string;
  readonly executedBy: string;
}
export interface PendingArgs {
  readonly executedBy: string;
}
export interface FulfilArgs {
  readonly inviteId: string;
  readonly username: string;
  readonly confirmedWith: string;
  readonly executedBy: string;
}
export interface SetNameArgs {
  readonly target: { readonly membershipId: string } | { readonly username: string };
  readonly name: string;
  readonly requestRef: string;
  readonly executedBy: string;
}
export interface MfaResetArgs {
  readonly username: string;
  readonly requestRef: string;
  readonly executedBy: string;
  readonly confirmedWith: string | null;
}
interface Approval {
  readonly requestRef: string;
  readonly executedBy: string;
  readonly approvedBy: string;
}
export type RestoreOwnerArgs = Approval &
  (
    | { readonly mode: 'promote'; readonly membershipId: string }
    | { readonly mode: 'successor'; readonly successor: Person; readonly replaces: string }
  );

export type Invocation =
  | { readonly command: 'org-create'; readonly args: OrgCreateArgs }
  | { readonly command: 'pending'; readonly args: PendingArgs }
  | { readonly command: 'fulfil'; readonly args: FulfilArgs }
  | { readonly command: 'set-name'; readonly args: SetNameArgs }
  | { readonly command: 'mfa-reset'; readonly args: MfaResetArgs }
  | { readonly command: 'restore-owner'; readonly args: RestoreOwnerArgs };

const COMMANDS = [
  'org-create',
  'pending',
  'fulfil',
  'set-name',
  'mfa-reset',
  'restore-owner',
] as const;
type Command = (typeof COMMANDS)[number];

const text = { type: 'string' } as const;
const OPTIONS: { readonly [C in Command]: ParseArgsOptionsConfig } = {
  'org-create': {
    'org-name': text,
    timezone: text,
    'site-name': text,
    owner: { type: 'string', multiple: true },
    'request-ref': text,
    'executed-by': text,
  },
  pending: { 'executed-by': text },
  fulfil: { username: text, 'confirmed-with': text, 'executed-by': text },
  'set-name': {
    membership: text,
    username: text,
    name: text,
    'request-ref': text,
    'executed-by': text,
  },
  'mfa-reset': { username: text, 'request-ref': text, 'executed-by': text, 'confirmed-with': text },
  'restore-owner': {
    'request-ref': text,
    'executed-by': text,
    'approved-by': text,
    promote: text,
    successor: text,
    replaces: text,
  },
};
type Values = Readonly<Record<string, string | boolean | (string | boolean)[] | undefined>>;

/** Typed, not proven: one person could type two ids (T14). */
const STAFF_ID = /^[a-z][a-z0-9._-]{1,39}$/;
/** No "@" and no space, so no e-mail address or name reaches audit_event.detail. */
const REFERENCE = /^[A-Za-z0-9._:/-]{1,64}$/;
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** An identity-provider username. Never written to the database or the audit log. */
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,254}$/;
const OrgNameSchema = labelSchema(ABSOLUTE.maxNameLength, 'organisation name');
const SiteNameSchema = labelSchema(ABSOLUTE.maxNameLength, 'site name');

function matching(pattern: RegExp, what: string) {
  return (value: string, option: string): string => {
    if (!pattern.test(value)) throw new UsageError(`${option} must be ${what}`);
    return value;
  };
}
export const staffId = matching(STAFF_ID, 'a staff id: a-z first, then a-z, 0-9, ".", "_", "-"');
export const reference = matching(REFERENCE, 'a reference without "@" or spaces, up to 64');
export const lowerUuid = matching(LOWER_UUID, 'a lower-case UUID');
const username = matching(USERNAME, 'an identity-provider username');

/** A member's display name, as the API checks it (MemberNameSchema): trimmed, 1 to 120. */
export function memberName(value: string, option: string): string {
  const parsed = MemberNameSchema.safeParse(value);
  if (!parsed.success) throw new UsageError(`${option}: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

function label(schema: typeof OrgNameSchema, value: string, option: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new UsageError(`${option}: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

function timeZone(value: string): string {
  let known = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value) && value.length <= 64;
  try {
    if (known) new Intl.DateTimeFormat('en-AU', { timeZone: value });
  } catch {
    known = false;
  }
  if (!known) throw new UsageError('--timezone must be an IANA time zone such as Australia/Sydney');
  return value;
}

/** `<username>=<name>`, split at the first "=". */
function person(value: string, option: string): Person {
  const at = value.indexOf('=');
  if (at < 0) throw new UsageError(`${option} must look like <username>=<name>`);
  return {
    username: username(value.slice(0, at), option),
    name: memberName(value.slice(at + 1), option),
  };
}

function optional(values: Values, option: string): string | undefined {
  const value = values[option];
  return typeof value === 'string' ? value : undefined;
}

function required(values: Values, option: string): string {
  const value = optional(values, option);
  if (value === undefined) throw new UsageError(`--${option} is required`);
  return value;
}

/** Parses `provision-member` arguments (after the script name). Throws UsageError. */
export function parseInvocation(argv: readonly string[]): Invocation {
  const command = argv[0];
  if (command === undefined || !(COMMANDS as readonly string[]).includes(command)) {
    throw new UsageError(
      command === undefined ? 'name a command' : `unknown command ${JSON.stringify(command)}`,
    );
  }
  let values: Values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: OPTIONS[command as Command],
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const expected = command === 'fulfil' ? 2 : 1;
  if (positionals.length !== expected) {
    throw new UsageError(
      command === 'fulfil' ? 'fulfil takes one invite id' : `${command} takes no positional value`,
    );
  }
  const executedBy = staffId(required(values, 'executed-by'), '--executed-by');

  switch (command as Command) {
    case 'org-create': {
      const raw = values['owner'];
      const owners = (Array.isArray(raw) ? raw : []).map((v) => person(String(v), '--owner'));
      if (owners.length < 1 || owners.length > 2) {
        throw new UsageError('name one or two --owner <username>=<name>');
      }
      const distinct = (key: keyof Person) =>
        new Set(owners.map((o) => o[key].toLowerCase())).size === owners.length;
      if (!distinct('username')) throw new UsageError('the two owners need different usernames');
      if (!distinct('name')) throw new UsageError('the two owners need different names');
      return {
        command: 'org-create',
        args: {
          orgName: label(OrgNameSchema, required(values, 'org-name'), '--org-name'),
          timezone: timeZone(required(values, 'timezone')),
          siteName: label(
            SiteNameSchema,
            optional(values, 'site-name') ?? 'Main site',
            '--site-name',
          ),
          owners,
          requestRef: reference(required(values, 'request-ref'), '--request-ref'),
          executedBy,
        },
      };
    }
    case 'pending':
      return { command: 'pending', args: { executedBy } };
    case 'fulfil':
      return {
        command: 'fulfil',
        args: {
          inviteId: lowerUuid(positionals[1] ?? '', 'the invite id'),
          username: username(required(values, 'username'), '--username'),
          confirmedWith: reference(required(values, 'confirmed-with'), '--confirmed-with'),
          executedBy,
        },
      };
    case 'set-name': {
      const membership = optional(values, 'membership');
      const user = optional(values, 'username');
      if ((membership === undefined) === (user === undefined)) {
        throw new UsageError('name the member with exactly one of --membership or --username');
      }
      return {
        command: 'set-name',
        args: {
          target:
            membership !== undefined
              ? { membershipId: lowerUuid(membership, '--membership') }
              : { username: username(user ?? '', '--username') },
          name: memberName(required(values, 'name'), '--name'),
          requestRef: reference(required(values, 'request-ref'), '--request-ref'),
          executedBy,
        },
      };
    }
    case 'mfa-reset': {
      const confirmedWith = optional(values, 'confirmed-with');
      return {
        command: 'mfa-reset',
        args: {
          username: username(required(values, 'username'), '--username'),
          requestRef: reference(required(values, 'request-ref'), '--request-ref'),
          executedBy,
          confirmedWith:
            confirmedWith === undefined ? null : reference(confirmedWith, '--confirmed-with'),
        },
      };
    }
    case 'restore-owner': {
      const approvedBy = staffId(required(values, 'approved-by'), '--approved-by');
      if (approvedBy === executedBy) {
        throw new UsageError('--approved-by must name a second person, not --executed-by');
      }
      const approval = {
        requestRef: reference(required(values, 'request-ref'), '--request-ref'),
        executedBy,
        approvedBy,
      };
      const promote = optional(values, 'promote');
      const successor = optional(values, 'successor');
      const replaces = optional(values, 'replaces');
      if (promote !== undefined && successor === undefined && replaces === undefined) {
        return {
          command: 'restore-owner',
          args: { ...approval, mode: 'promote', membershipId: lowerUuid(promote, '--promote') },
        };
      }
      if (promote === undefined && successor !== undefined && replaces !== undefined) {
        return {
          command: 'restore-owner',
          args: {
            ...approval,
            mode: 'successor',
            successor: person(successor, '--successor'),
            replaces: lowerUuid(replaces, '--replaces'),
          },
        };
      }
      throw new UsageError('name either --promote, or both --successor and --replaces');
    }
  }
}

// ----------------------------------------------------------------- commands

export interface Result {
  /** What the CLI prints, line by line. */
  readonly lines: readonly string[];
}

/** Refuses unless the login and the current role are both tinnox_migrator (as migrate.ts). */
async function assertMigrator(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ current_user: string; session_user: string }>(
    'SELECT current_user, session_user',
  );
  const who = rows[0];
  if (who?.current_user !== 'tinnox_migrator' || who.session_user !== 'tinnox_migrator') {
    throw new RefusedError(
      'provisioning runs only as role tinnox_migrator (DATABASE_MIGRATOR_URL)',
    );
  }
}

/**
 * Runs `work` as tinnox_definer (BYPASSRLS, so it reads every organisation), then returns to the
 * migrator. A failure aborts the transaction, which undoes the SET LOCAL as well.
 */
async function asDefiner<T>(tx: Tx, work: () => Promise<T>): Promise<T> {
  await tx.query('SET LOCAL ROLE tinnox_definer');
  const result = await work();
  await tx.query('RESET ROLE');
  return result;
}

async function enabledAccount(idp: IdpDirectory, name: string): Promise<IdpAccount> {
  const account = await idp.findByUsername(name);
  if (account === null) throw new RefusedError('no identity-provider account has this username');
  if (!account.enabled) throw new RefusedError('the identity-provider account is disabled');
  return account;
}

async function subjectOf(idp: IdpDirectory, name: string): Promise<string> {
  const account = await idp.findByUsername(name);
  if (account === null) throw new RefusedError('no identity-provider account has this username');
  return account.subject;
}

function first<R>(rows: readonly R[]): R {
  const row = rows[0];
  if (row === undefined) throw new Error('the statement returned no row');
  return row;
}

function parseRole(value: string): Role | null {
  const parsed = RoleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 23505 from 0001's UNIQUE (oidc_sub): one organisation per person, removed rows included. */
const SUBJECT_TAKEN = 'membership_oidc_sub_key';

/**
 * A display-name clash (membership_org_display_name_key) becomes a refusal staff can act on, and
 * so does a subject another run added in another organisation after this run's definer read
 * (the membership lock covers one organisation only).
 */
async function named<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const constraint = violatedConstraint(error);
    if (constraint === STAGE_C_CONSTRAINTS.memberNameTaken) {
      throw new RefusedError(
        'Name in use in this organisation; agree a different name with the requester.',
      );
    }
    if (constraint === SUBJECT_TAKEN) {
      throw new RefusedError(
        'this account already has a membership, removed or not (one organisation per person)',
      );
    }
    throw error;
  }
}

function audit(
  tx: Tx,
  action: string,
  objectType: 'membership' | 'invite',
  objectId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  return auditScoped(tx, {
    actorType: 'system',
    actorId: null,
    action,
    objectType,
    objectId,
    result: 'success',
    detail,
  });
}

// eslint-disable-next-line no-control-regex -- removing control characters is the purpose of this pattern
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
/** Customer text on a staff terminal: no control or text-direction characters. */
const printable = (value: string): string => value.replace(UNPRINTABLE, '?');

export interface OrgCreateResult extends Result {
  readonly orgId: string;
  readonly siteId: string;
  /** In the order of --owner. */
  readonly ownerIds: readonly string[];
}

/** A new customer: the organisation, its site and one or two Owners. */
export async function orgCreate(
  pool: Pool,
  idp: IdpDirectory,
  args: OrgCreateArgs,
): Promise<OrgCreateResult> {
  await assertMigrator(pool);
  const subjects: string[] = [];
  for (const owner of args.owners)
    subjects.push((await enabledAccount(idp, owner.username)).subject);
  const orgId = randomUUID();
  return withOrg(pool, orgId, async (tx) => {
    await lockOrgMembership(tx);
    const taken = await asDefiner(tx, () =>
      tx.query('SELECT 1 FROM public.membership WHERE oidc_sub = ANY($1::text[])', [subjects]),
    );
    if (taken.rows.length > 0) {
      throw new RefusedError(
        'an owner account already has a membership, removed or not (one organisation per person)',
      );
    }
    await tx.query('INSERT INTO organization (id, name) VALUES (app_org_id(), $1)', [args.orgName]);
    // display.site_id is NOT NULL and no route creates sites.
    const site = first(
      (
        await tx.query<{ id: string }>(
          'INSERT INTO site (org_id, name, timezone) VALUES (app_org_id(), $1, $2) RETURNING id',
          [args.siteName, args.timezone],
        )
      ).rows,
    );
    const ownerIds: string[] = [];
    for (const [index, owner] of args.owners.entries()) {
      const { id } = first(
        (
          await named(
            tx.query<{ id: string }>(
              `INSERT INTO membership (org_id, oidc_sub, role, display_name)
               VALUES (app_org_id(), $1, 'owner', $2) RETURNING id`,
              [subjects[index], owner.name],
            ),
          )
        ).rows,
      );
      ownerIds.push(id);
      await audit(tx, 'membership.create', 'membership', id, {
        role: 'owner',
        inviteId: null,
        reactivated: false,
        requestRef: args.requestRef,
        executedBy: args.executedBy,
        reason: 'org_create',
      });
    }
    return {
      orgId,
      siteId: site.id,
      ownerIds,
      lines: [
        `Organisation ${orgId} created with site ${site.id}.`,
        ...ownerIds.map((id, index) => `Owner ${index + 1}: membership ${id}`),
      ],
    };
  });
}

export interface PendingInvite {
  readonly id: string;
  readonly reference: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly role: string;
  readonly name: string;
  readonly email: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}
export interface PendingResult extends Result {
  readonly expired: number;
  readonly invites: readonly PendingInvite[];
}

/**
 * The daily run: expires every invite past its date (the guard deletes its name and e-mail
 * address), then lists the pending invites of every organisation.
 */
export async function pending(
  pool: Pool,
  _idp: IdpDirectory,
  args: PendingArgs,
): Promise<PendingResult> {
  await assertMigrator(pool);
  return withoutOrg(pool, async (tx) => {
    // As the definer throughout: there is no organisation context, and the expiry and its audit
    // rows span every organisation (its 0013 UPDATE (status) on member_invite, its INSERT on
    // audit_event). No membership lock: only member_invite rows change, and an invite a
    // concurrent fulfil or cancel holds FOR UPDATE is skipped by the READ COMMITTED re-check.
    await tx.query('SET LOCAL ROLE tinnox_definer');
    const expired = await tx.query(
      `WITH closed AS (
         UPDATE public.member_invite i SET status = 'expired'
         WHERE i.status = 'pending' AND i.expires_at <= now()
         RETURNING i.id, i.org_id, i.role
       )
       INSERT INTO public.audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result, detail)
       SELECT closed.org_id, 'system', NULL, 'invite.cancel', 'invite', closed.id::text, 'success',
              jsonb_build_object('role', closed.role, 'reason', 'expired', 'executedBy', $1::text)
       FROM closed`,
      [args.executedBy],
    );
    const { rows } = await tx.query<{
      id: string;
      org_id: string;
      org_name: string;
      role: string;
      name: string;
      email: string;
      created_at: Date;
      expires_at: Date;
    }>(
      `SELECT i.id, i.org_id, o.name AS org_name, i.role, i.name, i.email, i.created_at, i.expires_at
       FROM public.member_invite i JOIN public.organization o ON o.id = i.org_id
       WHERE i.status = 'pending'
       ORDER BY i.created_at, i.id`,
    );
    await tx.query('RESET ROLE');
    const invites = rows.map((r) => ({
      id: r.id,
      reference: inviteReference(r.id),
      orgId: r.org_id,
      orgName: r.org_name,
      role: r.role,
      name: r.name,
      email: r.email,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
    }));
    const count = expired.rowCount ?? 0;
    return {
      expired: count,
      invites,
      lines: [
        `Expired ${count} invite(s); their names and e-mail addresses are deleted.`,
        `Pending invites: ${invites.length}`,
        ...invites.map(
          (i) =>
            `  ${i.reference}  ${i.role}  ${printable(i.name)} <${printable(i.email)}>  ` +
            `${printable(i.orgName)}  requested ${i.createdAt}  expires ${i.expiresAt}  invite ${i.id}`,
        ),
      ],
    };
  });
}

export interface FulfilResult extends Result {
  readonly membershipId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly reactivated: boolean;
}

/**
 * Completes an invite with the identity-provider account staff created for it. Refuses, leaving
 * the invite pending and writing nothing, when the invite is closed or expired, the account's
 * e-mail address differs from the invite's, the inviter was removed or can no longer give the
 * role, the account belongs to another organisation, or it is already an active member here.
 */
export async function fulfil(
  pool: Pool,
  idp: IdpDirectory,
  args: FulfilArgs,
): Promise<FulfilResult> {
  await assertMigrator(pool);
  const account = await enabledAccount(idp, args.username);
  const accountEmail = account.email?.trim().toLowerCase() ?? '';
  if (accountEmail === '') {
    throw new RefusedError('the identity-provider account has no e-mail address');
  }
  return withResolvedOrg(pool, async (tx, enterOrg) => {
    const found = await asDefiner(tx, async () => ({
      invite: (
        await tx.query<{ org_id: string }>(
          'SELECT org_id FROM public.member_invite WHERE id = $1',
          [args.inviteId],
        )
      ).rows[0],
      orgs: (
        await tx.query<{ org_id: string }>(
          'SELECT org_id FROM public.membership WHERE oidc_sub = $1',
          [account.subject],
        )
      ).rows.map((r) => r.org_id),
    }));
    if (found.invite === undefined) throw new RefusedError('no invite has this id');
    const orgId = found.invite.org_id;
    // UNIQUE (oidc_sub): removed rows are never deleted, so one organisation per person.
    if (found.orgs.some((org) => org !== orgId)) {
      throw new RefusedError(
        'this account has a membership in another organisation, removed or not; the invite stays pending (tell only TINNOX staff)',
      );
    }
    await enterOrg(orgId);
    await lockOrgMembership(tx);

    const invite = (
      await tx.query<{
        role: string;
        name: string | null;
        email: string | null;
        status: string;
        invited_by: string;
        expired: boolean;
      }>(
        `SELECT role, name, email, status, invited_by, expires_at <= now() AS expired
         FROM member_invite WHERE id = $1 AND org_id = app_org_id() FOR UPDATE`,
        [args.inviteId],
      )
    ).rows[0];
    if (invite === undefined || invite.status !== 'pending' || invite.name === null) {
      throw new RefusedError(`the invite is not pending (${invite?.status ?? 'gone'})`);
    }
    if (invite.expired) throw new RefusedError('the invite has expired; ask for a new one');
    if ((invite.email ?? '').trim().toLowerCase() !== accountEmail) {
      throw new RefusedError(
        "the account's e-mail address differs from the invite's; confirm the person with the requester",
      );
    }
    const role = parseRole(invite.role);
    const inviter = (
      await tx.query<{ role: string; removed: boolean }>(
        `SELECT role, removed_at IS NOT NULL AS removed
         FROM membership WHERE id = $1 AND org_id = app_org_id()`,
        [invite.invited_by],
      )
    ).rows[0];
    const inviterRole = inviter === undefined ? null : parseRole(inviter.role);
    if (
      role === null ||
      inviter === undefined ||
      inviter.removed ||
      inviterRole === null ||
      !grantableRoles(inviterRole, 'invite').includes(role)
    ) {
      throw new RefusedError(
        'the person who requested the invite was removed or can no longer give this role; the organisation requests it again',
      );
    }

    const here = (
      await tx.query<{ id: string; removed: boolean }>(
        `SELECT id, removed_at IS NOT NULL AS removed FROM membership
         WHERE oidc_sub = $1 AND org_id = app_org_id() FOR NO KEY UPDATE`,
        [account.subject],
      )
    ).rows[0];
    if (here !== undefined && !here.removed) {
      throw new RefusedError('this account is already an active member of the organisation');
    }
    let membershipId: string;
    if (here !== undefined) {
      // The person comes back: the invite's role and name, signed in "never", and the cut-off
      // (sessions_valid_after) kept, so their old sessions stay ended.
      await named(
        tx.query(
          `UPDATE membership
           SET role = $2, display_name = $3, removed_at = NULL, removed_by = NULL,
               first_signed_in_at = NULL
           WHERE id = $1 AND org_id = app_org_id()`,
          [here.id, role, invite.name],
        ),
      );
      membershipId = here.id;
    } else {
      membershipId = first(
        (
          await named(
            tx.query<{ id: string }>(
              `INSERT INTO membership (org_id, oidc_sub, role, display_name)
               VALUES (app_org_id(), $1, $2, $3) RETURNING id`,
              [account.subject, role, invite.name],
            ),
          )
        ).rows,
      ).id;
    }
    // The guard deletes the invite's name and e-mail address and stamps closed_at.
    await tx.query(
      `UPDATE member_invite SET status = 'fulfilled', fulfilled_membership_id = $2
       WHERE id = $1 AND org_id = app_org_id()`,
      [args.inviteId, membershipId],
    );
    const reactivated = here !== undefined;
    await audit(tx, 'membership.create', 'membership', membershipId, {
      role,
      inviteId: args.inviteId,
      reactivated,
      requestRef: inviteReference(args.inviteId),
      confirmedWith: args.confirmedWith,
      executedBy: args.executedBy,
    });
    const org = first(
      (await tx.query<{ name: string }>('SELECT name FROM organization WHERE id = app_org_id()'))
        .rows,
    );
    return {
      membershipId,
      orgId,
      role,
      reactivated,
      lines: [
        `Invite ${inviteReference(args.inviteId)} fulfilled${reactivated ? ' (removed member reactivated)' : ''}.`,
        `Membership ${membershipId} in ${printable(org.name)} (${orgId}) as ${ROLE_LABELS[role]}.`,
      ],
    };
  });
}

export interface MembershipResult extends Result {
  readonly membershipId: string;
}

/** Names an active member (once for every member from before 0013, D4 a). */
export async function setName(
  pool: Pool,
  idp: IdpDirectory,
  args: SetNameArgs,
): Promise<MembershipResult> {
  await assertMigrator(pool);
  const lookup =
    'username' in args.target
      ? {
          sql: 'SELECT id, org_id FROM public.membership WHERE oidc_sub = $1',
          value: await subjectOf(idp, args.target.username),
        }
      : {
          sql: 'SELECT id, org_id FROM public.membership WHERE id = $1',
          value: args.target.membershipId,
        };
  return withResolvedOrg(pool, async (tx, enterOrg) => {
    const member = await asDefiner(
      tx,
      async () =>
        (await tx.query<{ id: string; org_id: string }>(lookup.sql, [lookup.value])).rows[0],
    );
    if (member === undefined) throw new RefusedError('no membership matches');
    await enterOrg(member.org_id);
    await lockOrgMembership(tx);
    const updated = await named(
      tx.query(
        `UPDATE membership SET display_name = $2
         WHERE id = $1 AND org_id = app_org_id() AND removed_at IS NULL`,
        [member.id, args.name],
      ),
    );
    if (updated.rowCount !== 1) throw new RefusedError('the member was removed');
    await audit(tx, 'membership.update', 'membership', member.id, {
      fields: ['displayName'],
      requestRef: args.requestRef,
      executedBy: args.executedBy,
    });
    return { membershipId: member.id, lines: [`Name set for membership ${member.id}.`] };
  });
}

export interface MfaResetResult extends MembershipResult {
  readonly sessionsEnded: number;
}

/**
 * After staff reset the account at the identity provider: ends the member's sessions and sets
 * the cut-off, so the next sign-in asks for the password and one-time code.
 */
export async function mfaReset(
  pool: Pool,
  idp: IdpDirectory,
  args: MfaResetArgs,
): Promise<MfaResetResult> {
  await assertMigrator(pool);
  const subject = await subjectOf(idp, args.username);
  return withResolvedOrg(pool, async (tx, enterOrg) => {
    const member = await asDefiner(
      tx,
      async () =>
        (
          await tx.query<{ id: string; org_id: string }>(
            'SELECT id, org_id FROM public.membership WHERE oidc_sub = $1 AND removed_at IS NULL',
            [subject],
          )
        ).rows[0],
    );
    if (member === undefined) throw new RefusedError('this account has no active membership');
    await enterOrg(member.org_id);
    await lockOrgMembership(tx);
    const target = await tx.query(
      `SELECT 1 FROM membership WHERE id = $1 AND org_id = app_org_id() AND removed_at IS NULL
       FOR NO KEY UPDATE`,
      [member.id],
    );
    if (target.rows.length === 0) throw new RefusedError('the member was removed');
    const others = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM membership
       WHERE org_id = app_org_id() AND id <> $1 AND removed_at IS NULL AND role IN ('owner', 'admin')`,
      [member.id],
    );
    if ((others.rows[0]?.n ?? 0) > 0 && args.confirmedWith === null) {
      throw new RefusedError(
        'another active Owner or Admin exists: confirm the reset with them first, then pass --confirmed-with <ref>',
      );
    }
    // The definer owns sec.session_revoke_membership; the migrator gets no EXECUTE grant.
    const sessionsEnded = await asDefiner(tx, () => sessionRevokeMembership(tx, member.id));
    await audit(tx, 'membership.mfa_reset', 'membership', member.id, {
      requestRef: args.requestRef,
      executedBy: args.executedBy,
      ...(args.confirmedWith === null ? {} : { confirmedWith: args.confirmedWith }),
      sessionsEnded,
    });
    return {
      membershipId: member.id,
      sessionsEnded,
      lines: [
        `Membership ${member.id}: ${sessionsEnded} session(s) ended; the next sign-in asks for the password and one-time code.`,
        'Sign the user out at the identity provider too.',
      ],
    };
  });
}

export interface RestoreOwnerResult extends Result {
  readonly ownerId: string;
  /** The replaced Owner (successor path only). */
  readonly removedId: string | null;
  readonly sessionsEnded: number;
  readonly invitesCancelled: number;
}

/**
 * Lost-owner break-glass, on a written request approved by a second staff member: promote an
 * active member who has signed in, or put a successor in place of the only active member.
 */
export async function restoreOwner(
  pool: Pool,
  idp: IdpDirectory,
  args: RestoreOwnerArgs,
): Promise<RestoreOwnerResult> {
  await assertMigrator(pool);
  const approval = {
    requestRef: args.requestRef,
    executedBy: args.executedBy,
    approvedBy: args.approvedBy,
  };
  if (args.mode === 'promote') {
    return withResolvedOrg(pool, async (tx, enterOrg) => {
      const member = await asDefiner(
        tx,
        async () =>
          (
            await tx.query<{ org_id: string }>(
              'SELECT org_id FROM public.membership WHERE id = $1',
              [args.membershipId],
            )
          ).rows[0],
      );
      if (member === undefined) throw new RefusedError('no membership has this id');
      await enterOrg(member.org_id);
      await lockOrgMembership(tx);
      const target = first(
        (
          await tx.query<{ role: string; removed: boolean; signed_in: boolean }>(
            `SELECT role, removed_at IS NOT NULL AS removed, first_signed_in_at IS NOT NULL AS signed_in
             FROM membership WHERE id = $1 AND org_id = app_org_id() FOR NO KEY UPDATE`,
            [args.membershipId],
          )
        ).rows,
      );
      if (target.removed) throw new RefusedError('the member was removed; use --successor');
      if (!target.signed_in) {
        throw new RefusedError('only someone who has signed in at least once can be made an Owner');
      }
      if (target.role === 'owner') throw new RefusedError('the member is already an Owner');
      await tx.query(
        "UPDATE membership SET role = 'owner' WHERE id = $1 AND org_id = app_org_id()",
        [args.membershipId],
      );
      await audit(tx, 'membership.role_change', 'membership', args.membershipId, {
        from: target.role,
        to: 'owner',
        sessionsEnded: 0,
        invitesCancelled: 0,
        reason: 'owner_recovery',
        ...approval,
      });
      return {
        ownerId: args.membershipId,
        removedId: null,
        sessionsEnded: 0,
        invitesCancelled: 0,
        lines: [`Membership ${args.membershipId} is now an Owner.`],
      };
    });
  }

  const { successor, replaces } = args;
  const account = await enabledAccount(idp, successor.username);
  return withResolvedOrg(pool, async (tx, enterOrg) => {
    const found = await asDefiner(tx, async () => ({
      old: (
        await tx.query<{ org_id: string }>('SELECT org_id FROM public.membership WHERE id = $1', [
          replaces,
        ])
      ).rows[0],
      taken:
        (await tx.query('SELECT 1 FROM public.membership WHERE oidc_sub = $1', [account.subject]))
          .rows.length > 0,
    }));
    if (found.old === undefined) throw new RefusedError('no membership has the --replaces id');
    if (found.taken) {
      throw new RefusedError(
        'the successor account already has a membership, removed or not (one organisation per person)',
      );
    }
    await enterOrg(found.old.org_id);
    await lockOrgMembership(tx);
    const active = (
      await tx.query<{ id: string; role: string }>(
        `SELECT id, role FROM membership WHERE org_id = app_org_id() AND removed_at IS NULL
         FOR NO KEY UPDATE`,
      )
    ).rows;
    if (active.length !== 1 || active[0]?.id !== replaces || active[0].role !== 'owner') {
      throw new RefusedError(
        '--replaces must be the active Owner and the only active member; otherwise use --promote',
      );
    }
    // First, so the last-owner trigger finds an Owner when the old one is removed.
    const { id: ownerId } = first(
      (
        await named(
          tx.query<{ id: string }>(
            `INSERT INTO membership (org_id, oidc_sub, role, display_name)
             VALUES (app_org_id(), $1, 'owner', $2) RETURNING id`,
            [account.subject, successor.name],
          ),
        )
      ).rows,
    );
    await tx.query(
      'UPDATE membership SET removed_at = now() WHERE id = $1 AND org_id = app_org_id()',
      [replaces],
    );
    const cancelled = await tx.query<{ id: string; role: string }>(
      `UPDATE member_invite SET status = 'cancelled'
       WHERE org_id = app_org_id() AND invited_by = $1 AND status = 'pending'
       RETURNING id, role`,
      [replaces],
    );
    for (const invite of cancelled.rows) {
      await audit(tx, 'invite.cancel', 'invite', invite.id, {
        role: invite.role,
        reason: 'inviter_removed',
        executedBy: args.executedBy,
      });
    }
    const sessionsEnded = await asDefiner(tx, () => sessionRevokeMembership(tx, replaces));
    await audit(tx, 'membership.create', 'membership', ownerId, {
      role: 'owner',
      inviteId: null,
      reactivated: false,
      reason: 'owner_recovery',
      ...approval,
    });
    await audit(tx, 'membership.remove', 'membership', replaces, {
      previousRole: 'owner',
      sessionsEnded,
      invitesCancelled: cancelled.rows.length,
      reason: 'owner_recovery',
      ...approval,
    });
    return {
      ownerId,
      removedId: replaces,
      sessionsEnded,
      invitesCancelled: cancelled.rows.length,
      lines: [
        `Owner membership ${ownerId} created; membership ${replaces} removed (${sessionsEnded} session(s) ended, ${cancelled.rows.length} invite(s) cancelled).`,
        "Disable the old Owner's identity-provider account.",
      ],
    };
  });
}
