import {
  ABSOLUTE,
  INVITE_ROLES,
  InviteEmailSchema,
  inviteReference,
  MemberNameSchema,
  ROLES,
  type InviteDto,
  type InviteRole,
  type MemberDto,
  type Role,
} from '@tinnox/contracts';
import { canManage, grantableRoles, isDemotion, ROLE_LABELS } from '@tinnox/domain';
import type { ApiRequestError } from '../api/client.ts';

/**
 * The Users page in words and rules (docs/portal-v2/stage-c.md, section 7.4). Pure functions,
 * no DOM. The rank rule decides which rows and roles an actor may touch; the API decides every
 * request again. Members never carry an e-mail address (D3); a pending invite does, until it
 * closes.
 */

/** One line per role (section 1.1), under its label in the invite and role dialogs. */
export const ROLE_DESCRIPTIONS: { readonly [R in Role]: string } = {
  owner:
    'Holds the account. Can do everything, and is the only role that makes, changes or removes Admins and Owners.',
  admin:
    'Everything an Editor does, plus inviting, changing and removing Editors and Viewers and reading the full audit log.',
  editor: 'Makes, pushes and deletes content, sets up screens and pairs players.',
  viewer: 'Sees every screen, all content and each screen’s reported status. Changes nothing.',
};

/** What a member without a name is called, here and in activity. */
export const UNNAMED_PERSON = 'Unnamed person';

/** The member's name as recorded by TINNOX, or "Unnamed person" until TINNOX names them. */
export function memberName(member: { readonly displayName: string | null }): string {
  return member.displayName ?? UNNAMED_PERSON;
}

/**
 * A short reference to a member: the first 8 characters of their membership ID, as an invite's
 * reference is made. The audit log shows the whole ID, so staff and customers can match them.
 */
export function memberReference(id: string): string {
  return inviteReference(id);
}

/**
 * The member's name where people must be told apart (a row, its menu, a confirm): their name,
 * or "Unnamed person 3F9A12C4" with their reference until TINNOX names them. After the upgrade
 * every existing member is unnamed, so "Unnamed person" alone would name several rows.
 */
export function memberLabel(member: {
  readonly id: string;
  readonly displayName: string | null;
}): string {
  return member.displayName ?? `${UNNAMED_PERSON} ${memberReference(member.id)}`;
}

/** "a Viewer", "an Admin". */
export function roleWithArticle(role: Role): string {
  const label = ROLE_LABELS[role];
  return `${/^[AEIOU]/.test(label) ? 'an' : 'a'} ${label}`;
}

function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export type MemberAction = 'role' | 'name' | 'signOut' | 'remove';

const ALL_ACTIONS: readonly MemberAction[] = ['role', 'name', 'signOut', 'remove'];

/** Actions the actor may take on the row: none for self, removed rows, or a target the rank rule protects. */
export function memberActions(
  actor: { readonly id: string; readonly role: Role },
  target: MemberDto,
): readonly MemberAction[] {
  if (sameId(actor.id, target.id)) return [];
  if (target.removedAt !== null) return [];
  return canManage(actor.role, target.role) ? ALL_ACTIONS : [];
}

/** True when the row is protected by the rank rule from this actor (not self, not removed). */
export function managedByOwner(
  actor: { readonly id: string; readonly role: Role },
  target: MemberDto,
): boolean {
  return (
    !sameId(actor.id, target.id) && target.removedAt === null && !canManage(actor.role, target.role)
  );
}

export interface RoleChoice {
  readonly role: Role;
  readonly current: boolean;
  readonly disabledReason: string | null;
}

/** The roles the actor may give this member, highest first; Owner waits for a first sign-in. */
export function roleChoices(actorRole: Role, target: MemberDto): readonly RoleChoice[] {
  const grantable = grantableRoles(actorRole, 'change');
  return ROLES.filter((role) => grantable.includes(role)).map((role) => ({
    role,
    current: role === target.role,
    disabledReason:
      role === 'owner' && target.role !== 'owner' && target.firstSignedInAt === null
        ? 'Available after their first sign-in.'
        : null,
  }));
}

function isInviteRole(role: Role): role is InviteRole {
  return (INVITE_ROLES as readonly Role[]).includes(role);
}

/** The roles the actor may invite with, highest first. Never Owner. */
export function inviteRoleChoices(actorRole: Role): readonly InviteRole[] {
  return grantableRoles(actorRole, 'invite').filter(isInviteRole);
}

function invitesWord(count: number): string {
  return count === 1 ? '1 invite' : `${count} invites`;
}

/** What a role change does, said before it is made. */
export function roleChangeConsequence(
  name: string,
  from: Role,
  to: Role,
  invitesToCancel: number,
): string {
  if (from === to)
    return `${name} is ${roleWithArticle(to)} now. Choose another role to change it.`;
  if (!isDemotion(from, to)) {
    const owner =
      to === 'owner' ? ' As an Owner they can also change and remove Admins and Owners.' : '';
    return `${name} becomes ${roleWithArticle(to)}. They stay signed in, and the new role applies from their next action.${owner}`;
  }
  const invites =
    invitesToCancel === 0
      ? ''
      : ` ${invitesWord(invitesToCancel)} they requested ${invitesToCancel === 1 ? 'is' : 'are'} cancelled, because ${roleWithArticle(to)} cannot invite ${invitesToCancel === 1 ? 'that role' : 'those roles'}.`;
  return `${name} becomes ${roleWithArticle(to)} and is signed out everywhere now. Anything they have not saved is lost, and their next sign-in asks for their password and one-time code.${invites}`;
}

/**
 * How many pending invites the member requested that a change would cancel: those their new
 * role cannot invite with, or all of them on removal (`newRole` null). The API does the same.
 */
export function invitesCancelledBy(
  invites: readonly InviteDto[],
  memberId: string,
  newRole: Role | null,
): number {
  const keeps = newRole === null ? [] : grantableRoles(newRole, 'invite');
  return invites.filter(
    (invite) => sameId(invite.invitedBy, memberId) && !keeps.includes(invite.role),
  ).length;
}

/** What removing a member does, for the confirm dialog. */
export function removeConsequence(
  name: string,
  organisation: string,
  invitesToCancel: number,
): string {
  const invites =
    invitesToCancel === 0
      ? ''
      : ` Their ${invitesToCancel === 1 ? 'pending invite is' : `${invitesToCancel} pending invites are`} cancelled.`;
  return `${name} is signed out now and can no longer use TINNOX CMS for ${organisation}. Their content and the activity history stay.${invites} To bring them back later, invite them again; they get the role on the new invite.`;
}

/** What is wrong with a name as typed, before any clash; null when the API would take it. */
function nameFormatProblem(name: string): string | null {
  if (MemberNameSchema.safeParse(name).success) return null;
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name.';
  if (trimmed.length > ABSOLUTE.maxNameLength) {
    return `Use at most ${ABSOLUTE.maxNameLength} characters (now ${trimmed.length}).`;
  }
  return 'Remove the line breaks, tabs and other invisible characters from the name.';
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * What is wrong with the name of a new invite, or null. Like the API: no other active member
 * and no pending invite may have it, ignoring case; a removed member's name may come back.
 */
export function inviteNameProblem(
  name: string,
  members: readonly MemberDto[],
  invites: readonly InviteDto[],
): string | null {
  const problem = nameFormatProblem(name);
  if (problem !== null) return problem;
  const clash =
    members.some(
      (member) =>
        member.removedAt === null &&
        member.displayName !== null &&
        sameName(member.displayName, name),
    ) || invites.some((invite) => sameName(invite.name, name));
  return clash ? 'Another person in this organisation has this name.' : null;
}

/**
 * What is wrong with a corrected name, or null. No other member may have, or have had, it
 * (removed members keep their name in the activity history), and no pending invite may use it:
 * TINNOX fulfils an invite with its name, so taking it would leave the invite stuck (as the API).
 */
export function memberNameProblem(
  name: string,
  members: readonly MemberDto[],
  invites: readonly InviteDto[],
  selfId: string,
): string | null {
  const problem = nameFormatProblem(name);
  if (problem !== null) return problem;
  const clash = members.some(
    (member) =>
      !sameId(member.id, selfId) &&
      member.displayName !== null &&
      sameName(member.displayName, name),
  );
  if (clash) return 'Another person in this organisation has, or had, this name.';
  return invites.some((invite) => sameName(invite.name, name))
    ? 'An invite waiting for TINNOX uses this name.'
    : null;
}

/** What is wrong with a work e-mail address as typed, or null. The same check as the API's. */
export function inviteEmailProblem(email: string): string | null {
  const result = InviteEmailSchema.safeParse(email);
  if (result.success) return null;
  const trimmed = email.trim();
  if (trimmed === '') return 'Enter the person’s work e-mail address.';
  if (trimmed.length > 254) return `Use at most 254 characters (now ${trimmed.length}).`;
  const invisible = result.error.issues.some((issue) => /control|direction/.test(issue.message));
  return invisible
    ? 'Remove the line breaks, tabs and other invisible characters from the address.'
    : 'Enter an address like name@example.com.';
}

const LAST_OWNER =
  'An organisation always keeps at least one Owner. Make someone else an Owner first.';

const CONFLICT_MESSAGES: Readonly<Record<string, string>> = {
  name: 'Another person in this organisation has this name.',
  email: 'An invite for this address is already waiting.',
  displayName: 'Another person in this organisation has, or had, this name.',
};

const REFUSED_MESSAGES: Readonly<Record<string, string>> = {
  name: 'The server did not accept this name. Use letters, numbers and ordinary punctuation.',
  email: 'The server did not accept this address. Enter one like name@example.com.',
  displayName:
    'The server did not accept this name. Use letters, numbers and ordinary punctuation.',
  role: 'The server did not accept this role.',
};

type RefusalField = 'name' | 'email' | 'displayName' | 'role';

function isRefusalField(path: string): path is RefusalField {
  return path === 'name' || path === 'email' || path === 'displayName' || path === 'role';
}

/**
 * Where a refused member or invite change belongs: a field of the dialog (the first one the
 * API named), or the dialog as a whole (`field` null) with the words to show.
 */
export function memberRefusal(error: ApiRequestError): {
  field: RefusalField | null;
  message: string;
} {
  if (error.code === 'last_owner') return { field: null, message: LAST_OWNER };
  const notSignedIn = error.details.find((detail) => detail.code === 'not_signed_in_yet');
  if (error.code === 'conflict' && notSignedIn !== undefined) {
    return {
      field: 'role',
      message: 'Only someone who has signed in at least once can be made an Owner.',
    };
  }
  if (error.code === 'conflict' || error.code === 'validation_failed') {
    const words = error.code === 'conflict' ? CONFLICT_MESSAGES : REFUSED_MESSAGES;
    for (const detail of error.details) {
      if (!isRefusalField(detail.path)) continue;
      const message = words[detail.path] ?? detail.message;
      return { field: detail.path, message };
    }
  }
  return { field: null, message: error.message };
}

/** "1 person", "3 people". */
export function peopleCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/** "1 invite waiting for TINNOX", "2 invites waiting for TINNOX". */
export function inviteCountLabel(n: number): string {
  return `${invitesWord(n)} waiting for TINNOX`;
}

/** "No session was open", "1 session ended", "3 sessions ended". */
export function sessionsEndedLabel(n: number): string {
  if (n === 0) return 'No session was open';
  return `${n} ${n === 1 ? 'session' : 'sessions'} ended`;
}

/** "16 Nov 2026" in the viewer's zone. `timeZone` is for tests. A text that is not a time is returned as it is. */
export function formatDate(iso: string, timeZone?: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(time);
}

/** True once the invite is past its expiry; TINNOX's daily run then closes it. */
export function inviteExpired(invite: Pick<InviteDto, 'expiresAt'>, nowMs: number): boolean {
  const at = Date.parse(invite.expiresAt);
  return !Number.isNaN(at) && at <= nowMs;
}

/** "by Dana Lee · 16 Nov 2026"; without the inviter's name while the people are not loaded. */
export function inviteRequestedLabel(
  invite: Pick<InviteDto, 'invitedBy' | 'createdAt'>,
  members: readonly MemberDto[] | null,
  timeZone?: string,
): string {
  const date = formatDate(invite.createdAt, timeZone);
  const inviter = members?.find((member) => sameId(member.id, invite.invitedBy));
  return inviter === undefined ? date : `by ${memberLabel(inviter)} · ${date}`;
}
