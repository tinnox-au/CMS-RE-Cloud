import {
  AUDIT_CATEGORIES,
  INVITE_ROLES,
  PERMISSION_KEYS,
  ROLES,
  type AuditCategory,
  type PermissionKey,
  type Role,
} from '@tinnox/contracts';

const VIEWER = ['org.read', 'activity.read'] as const;
const EDITOR = [
  ...VIEWER,
  'content.write',
  'content.delete',
  'media.delete',
  'screen.assign',
  'push.publish',
  'screen.details',
  'screen.hours',
  'screen.setup',
  'screen.pair',
] as const;
const ADMIN = [...EDITOR, 'audit.read', 'member.read', 'member.manage'] as const;

/** The one role-to-key table (section 1.3 of docs/portal-v2/stage-c.md). Moving a key is one line here. */
export const ROLE_PERMISSIONS: { readonly [R in Role]: readonly PermissionKey[] } = Object.freeze({
  owner: Object.freeze(ADMIN),
  admin: Object.freeze(ADMIN),
  editor: Object.freeze(EDITOR),
  viewer: Object.freeze(VIEWER),
});
export const ROLE_RANK: { readonly [R in Role]: number } = Object.freeze({
  owner: 3,
  admin: 2,
  editor: 1,
  viewer: 0,
});
export const ROLE_LABELS: { readonly [R in Role]: string } = Object.freeze({
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
});

/**
 * Rank rule (section 1.4): the roles each role may manage, which are also the roles it may give
 * by a change. Owner differs from Admin only here, never through a key.
 */
const MANAGES: { readonly [R in Role]: readonly Role[] } = Object.freeze({
  owner: Object.freeze([...ROLES]),
  admin: Object.freeze(['editor', 'viewer'] as const),
  editor: Object.freeze([]),
  viewer: Object.freeze([]),
});

/** Fails closed for a value that is not a role at run time (an unparsed database string). */
function known<T>(table: { readonly [R in Role]: readonly T[] }, role: Role): readonly T[] {
  return Object.hasOwn(table, role) ? table[role] : [];
}

export function can(role: Role, key: PermissionKey): boolean {
  return known(ROLE_PERMISSIONS, role).includes(key);
}

/** The role's keys in PERMISSION_KEYS order (the session's `permissions`). */
export function permissionsOf(role: Role): PermissionKey[] {
  return PERMISSION_KEYS.filter((key) => can(role, key));
}

/** Rank rule: an Owner manages every role; an Admin manages Editors and Viewers; nobody else manages anyone. */
export function canManage(actor: Role, target: Role): boolean {
  return known(MANAGES, actor).includes(target);
}

const INVITABLE: readonly Role[] = INVITE_ROLES;

/** Roles the actor may give (section 1.4). Owner for 'change' still needs the target's first sign-in (API). */
export function grantableRoles(actor: Role, purpose: 'invite' | 'change'): readonly Role[] {
  const roles = known(MANAGES, actor);
  // Nobody is invited as an Owner (INVITE_ROLES): promotion follows the first sign-in.
  return purpose === 'invite' ? roles.filter((role) => INVITABLE.includes(role)) : roles;
}

/** The new role ranks lower than the old one. */
export function isDemotion(from: Role, to: Role): boolean {
  return ROLE_RANK[to] < ROLE_RANK[from];
}

/** Categories GET /api/audit returns without audit.read (section 1.5). Explicit, never "all but". */
export const ACTIVITY_CATEGORIES: readonly AuditCategory[] = Object.freeze([
  'display',
  'pairing',
  'player',
  'media',
  'tag',
  'folder',
  'app',
  'playlist',
  'schedule',
  'layout',
  'publication',
] as const);

/** Every category with the full log (audit.read), else the activity categories. */
export function visibleAuditCategories(fullLog: boolean): readonly AuditCategory[] {
  return fullLog ? AUDIT_CATEGORIES : ACTIVITY_CATEGORIES;
}
