import { z } from 'zod';
import { UuidSchema, UtcTimestampSchema } from './ids.ts';
import { InviteEmailSchema } from './members.ts';
import { OpaqueTokenSchema } from './pairing.ts';

/** Addresses on an organisation's alert list. Counted by the API under a per-organisation lock. */
export const MAX_ALERT_RECIPIENTS = 20;

/** Days a confirmation link stays valid. */
export const ALERT_CONFIRM_TTL_DAYS = 7;

/** "30 minutes", "1 hour", "1 hour 30 minutes", "48 hours": the e-mail and the screen page. */
export function alertDelayText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [
    ...(hours > 0 ? [`${hours} ${hours === 1 ? 'hour' : 'hours'}`] : []),
    ...(rest > 0 ? [`${rest} ${rest === 1 ? 'minute' : 'minutes'}`] : []),
  ];
  return parts.join(' ');
}

/**
 * An alert address: an invite e-mail without the characters of RFC 5322 names, groups, lists and
 * quoted parts, so the mailer delivers to exactly the stored string (twin of
 * alert_recipient_email_shape, 0014). Lower-cased here, then measured again, because lower-casing
 * can lengthen a string ('İ' becomes two code points).
 */
export const AlertEmailSchema = InviteEmailSchema.regex(
  /^[^<>()[\]\\,;:"\s]+$/,
  'alert address must be a plain address like name@example.com',
)
  .transform((email) => email.toLowerCase())
  .pipe(z.string().max(254));

/** `POST /api/alert-recipients`. The address comes out lower-cased. */
export const AlertRecipientCreateSchema = z.object({ email: AlertEmailSchema }).strict();
export type AlertRecipientCreate = z.infer<typeof AlertRecipientCreateSchema>;

/** `POST /api/alert-recipients/confirm`: the token from the link's fragment. */
export const AlertRecipientConfirmSchema = z.object({ token: OpaqueTokenSchema }).strict();
export type AlertRecipientConfirm = z.infer<typeof AlertRecipientConfirmSchema>;

/** An expired address receives nothing; remove it and add it again. */
export const ALERT_RECIPIENT_STATUSES = ['waiting', 'confirmed', 'expired'] as const;
export const AlertRecipientStatusSchema = z.enum(ALERT_RECIPIENT_STATUSES);
export type AlertRecipientStatus = z.infer<typeof AlertRecipientStatusSchema>;

/** Only `alerts.manage` holders read this: it carries the address. */
export const AlertRecipientDtoSchema = z
  .object({
    id: UuidSchema,
    email: z.string().min(3).max(254),
    status: AlertRecipientStatusSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type AlertRecipientDto = z.infer<typeof AlertRecipientDtoSchema>;

export const AlertRecipientListResponseSchema = z
  .object({ items: z.array(AlertRecipientDtoSchema).max(MAX_ALERT_RECIPIENTS) })
  .strict();
export type AlertRecipientListResponse = z.infer<typeof AlertRecipientListResponseSchema>;
