import { z } from 'zod';
import { OrgIdSchema, UtcTimestampSchema } from './ids.ts';
import { LimitsSchema } from './limits.ts';

export const ROLES = ['operator'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/** `GET /api/session` */
export const SessionResponseSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false) }).strict(),
  z
    .object({
      authenticated: z.literal(true),
      user: z.object({ displayName: z.string().max(200), role: RoleSchema }).strict(),
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

export const LogoutResponseSchema = z
  .object({
    /** Identity-provider end-session URL the browser should navigate to, if any. */
    redirectTo: z.string().max(2000).nullable(),
  })
  .strict();
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
