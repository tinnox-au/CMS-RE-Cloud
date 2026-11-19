import { z } from 'zod';
import { MembershipIdSchema, OrgIdSchema, UtcTimestampSchema } from './ids.ts';
import { ABSOLUTE, LimitsSchema } from './limits.ts';

/** Highest first. Each role includes everything the roles after it can do. */
export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/**
 * Active permission keys. Reserved, not listed until a route needs one: org.rename, org.delete,
 * site.manage, support.grant (H1), and the keys of CMS-14, CMS-15, CMS-16 and Epic J.
 * Who holds which key: ROLE_PERMISSIONS in packages/domain/src/permissions.ts.
 */
export const PERMISSION_KEYS = [
  'org.read',
  'activity.read',
  'audit.read',
  'content.write',
  'content.delete',
  'media.delete',
  'screen.assign',
  'push.publish',
  'screen.details',
  'screen.hours',
  'screen.setup',
  'screen.pair',
  'member.read',
  'member.manage',
] as const;
export const PermissionKeySchema = z.enum(PERMISSION_KEYS);
export type PermissionKey = z.infer<typeof PermissionKeySchema>;

/** Reasons the portal shows after a failed sign-in (`?authError=` on the portal root). */
export const AUTH_ERROR_CODES = [
  'state',
  'provider',
  'provider_unavailable',
  'no_membership',
  'mfa_required',
  'reauth_failed',
] as const;
export const AuthErrorCodeSchema = z.enum(AUTH_ERROR_CODES);
export type AuthErrorCode = z.infer<typeof AuthErrorCodeSchema>;

/** `GET /api/session` */
export const SessionResponseSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false) }).strict(),
  z
    .object({
      authenticated: z.literal(true),
      user: z
        .object({
          membershipId: MembershipIdSchema,
          /** Null until TINNOX names the member; the portal then shows the role label. */
          displayName: z.string().min(1).max(ABSOLUTE.maxNameLength).nullable(),
          role: RoleSchema,
          /** The keys the role holds now. The portal checks these, never role names. */
          permissions: z.array(PermissionKeySchema).max(PERMISSION_KEYS.length),
        })
        .strict(),
      /** Organisation derived from the membership row, never from client input. */
      organization: z.object({ id: OrgIdSchema, name: z.string() }).strict(),
      /** Echo in the `X-CSRF-Token` header on every state-changing request. */
      csrfToken: z.string().min(20).max(200),
      expiresAt: UtcTimestampSchema,
      limits: LimitsSchema,
    })
    .strict(),
]);
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/** Query of `GET /api/auth/login`. `returnTo` must be a same-origin path. */
export const LoginQuerySchema = z
  .object({
    returnTo: z
      .string()
      .max(200)
      .regex(/^\/(?!\/)[A-Za-z0-9\-._~/]*$/, 'returnTo must be a local path')
      .optional(),
  })
  .strict();
export type LoginQuery = z.infer<typeof LoginQuerySchema>;

/** Longest `redirectTo` the portal accepts; the API drops `id_token_hint` to stay within it. */
export const LOGOUT_REDIRECT_MAX_LENGTH = 2000;

export const LogoutResponseSchema = z
  .object({
    /** Identity-provider end-session URL the browser should navigate to, if any. */
    redirectTo: z.string().max(LOGOUT_REDIRECT_MAX_LENGTH).nullable(),
  })
  .strict();
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
