import { z } from 'zod';
import { UtcTimestampSchema } from './ids.ts';

/** Actions recorded in `audit_event.action`. */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.session_expired',
  'display.create',
  'display.update',
  'pairing.create',
  'pairing.claim',
  'pairing.complete',
  'player.revoke',
  'player.auth_rejected',
  'media.upload',
  'media.validate',
  'media.delete',
  'playlist.create',
  'playlist.update',
  'publication.create',
  'security.cross_org_denied',
  'security.csrf_rejected',
] as const;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AUDIT_ACTOR_TYPES = ['operator', 'player', 'system', 'anonymous'] as const;
export const AuditActorTypeSchema = z.enum(AUDIT_ACTOR_TYPES);
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;

export const AUDIT_RESULTS = ['success', 'failure', 'denied'] as const;
export const AuditResultSchema = z.enum(AUDIT_RESULTS);
export type AuditResult = z.infer<typeof AuditResultSchema>;

export const AuditEventDtoSchema = z
  .object({
    id: z.string().regex(/^[0-9]+$/),
    occurredAt: UtcTimestampSchema,
    actorType: AuditActorTypeSchema,
    /** Membership id, registration id, or null. Never a name, email or token. */
    actorId: z.string().max(100).nullable(),
    action: z.string().max(80),
    objectType: z.string().max(40).nullable(),
    objectId: z.string().max(100).nullable(),
    result: AuditResultSchema,
    /** Small structured context. Never file content, secrets or signed URLs. */
    detail: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();
export type AuditEventDto = z.infer<typeof AuditEventDtoSchema>;

export const AuditListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    /** Return events with id lower than this (newest first paging). */
    before: z
      .string()
      .regex(/^[0-9]{1,18}$/)
      .optional(),
  })
  .strict();
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;

export const AuditListResponseSchema = z
  .object({
    items: z.array(AuditEventDtoSchema),
    nextBefore: z.string().nullable(),
  })
  .strict();
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;
