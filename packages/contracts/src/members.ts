import { z } from 'zod';
import { InviteIdSchema, MembershipIdSchema, UtcTimestampSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { RoleSchema } from './session.ts';
import { labelSchema } from './text.ts';

/** Roles an invite can carry: nobody is invited as an Owner (promotion after the first sign-in). Twin of member_invite_role_known. */
export const INVITE_ROLES = ['admin', 'editor', 'viewer'] as const;
export const InviteRoleSchema = z.enum(INVITE_ROLES);
export type InviteRole = z.infer<typeof InviteRoleSchema>;

/** Days an invite waits for TINNOX. Twin of member_invite_guard (14 days). */
export const INVITE_TTL_DAYS = 14;

/** A member's display name in a request. Twin of membership_display_name_length and _trimmed. */
export const MemberNameSchema = labelSchema(ABSOLUTE.maxNameLength, 'name');

// shortcut: copies of text.ts's SINGLE_LINE and NO_DIRECTION_CONTROLS, which it does not export; export and reuse them when text.ts next changes.
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose of this pattern
const SINGLE_LINE = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]*$/;
const NO_DIRECTION_CONTROLS = /^[^\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]*$/;

/**
 * A work e-mail address in an invite request. The database twin checks only length and an "@".
 * No control or text-direction characters, as every other label: PostgreSQL text cannot hold NUL,
 * and Owners, Admins and TINNOX staff read the address (Users page, `provision-member pending`).
 */
export const InviteEmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'work e-mail address must look like name@example.com')
  .regex(SINGLE_LINE, 'work e-mail address must not contain control characters')
  .regex(NO_DIRECTION_CONTROLS, 'work e-mail address must not contain text-direction characters');

const NameOut = z.string().min(1).max(ABSOLUTE.maxNameLength);

/** `GET /api/members` item. Never an e-mail address (D3 a). */
export const MemberDtoSchema = z
  .object({
    id: MembershipIdSchema,
    displayName: NameOut.nullable(),
    role: RoleSchema,
    firstSignedInAt: UtcTimestampSchema.nullable(),
    removedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type MemberDto = z.infer<typeof MemberDtoSchema>;

export const MemberListResponseSchema = z
  .object({ items: z.array(MemberDtoSchema).max(ABSOLUTE.maxListItems) })
  .strict();
export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;

/** `GET /api/members/names` item: what activity needs. Never a role or an e-mail address. */
export const MemberNameDtoSchema = z
  .object({
    id: MembershipIdSchema,
    displayName: NameOut.nullable(),
    removed: z.boolean(),
    /** When the name last changed; events before it show "(renamed)". Null when never renamed. */
    renamedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type MemberNameDto = z.infer<typeof MemberNameDtoSchema>;

export const MemberNameListResponseSchema = z
  .object({ items: z.array(MemberNameDtoSchema).max(ABSOLUTE.maxListItems) })
  .strict();
export type MemberNameListResponse = z.infer<typeof MemberNameListResponseSchema>;

/** `PATCH /api/members/:id`. */
export const MemberPatchSchema = z
  .object({
    role: RoleSchema.optional(),
    displayName: MemberNameSchema.optional(),
  })
  .strict()
  .refine((p) => p.role !== undefined || p.displayName !== undefined, {
    message: 'name a role or a display name to change',
  });
export type MemberPatch = z.infer<typeof MemberPatchSchema>;

/** Answer of `PATCH /api/members/:id` and `POST /api/members/:id/remove`. */
export const MemberChangeResponseSchema = z
  .object({
    member: MemberDtoSchema,
    sessionsEnded: z.number().int().min(0),
    invitesCancelled: z.number().int().min(0),
  })
  .strict();
export type MemberChangeResponse = z.infer<typeof MemberChangeResponseSchema>;

/** Answer of `POST /api/members/:id/sign-out`. */
export const MemberSignOutResponseSchema = z
  .object({ sessionsEnded: z.number().int().min(0) })
  .strict();
export type MemberSignOutResponse = z.infer<typeof MemberSignOutResponseSchema>;

/** `POST /api/invites`. The organisation and the inviter come from the session. */
export const InviteCreateSchema = z
  .object({
    name: MemberNameSchema,
    email: InviteEmailSchema,
    role: InviteRoleSchema,
  })
  .strict();
export type InviteCreate = z.infer<typeof InviteCreateSchema>;

/** A pending invite (`GET /api/invites` item, `POST /api/invites` answer). */
export const InviteDtoSchema = z
  .object({
    id: InviteIdSchema,
    name: NameOut,
    email: z.string().min(3).max(254),
    role: InviteRoleSchema,
    invitedBy: MembershipIdSchema,
    createdAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
  })
  .strict();
export type InviteDto = z.infer<typeof InviteDtoSchema>;

export const InviteListResponseSchema = z
  .object({ items: z.array(InviteDtoSchema).max(ABSOLUTE.maxPendingInvites) })
  .strict();
export type InviteListResponse = z.infer<typeof InviteListResponseSchema>;

/** The short reference staff and customers quote: the id's first 8 hex digits, upper case. Never used to derive a username. */
export function inviteReference(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
