import { z } from 'zod';
import { CanvasSchema, RectSchema } from './canvas.ts';
import {
  DisplayIdSchema,
  OrgIdSchema,
  PairingSessionIdSchema,
  RegistrationIdSchema,
  UtcTimestampSchema,
} from './ids.ts';

/** 30 symbols with no 0/O, 1/I/L or U, so a code is easy to read aloud and type. */
export const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 8;

const CODE_PATTERN = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`);

/** Canonical stored form: 8 upper-case symbols from the alphabet. */
export const PairingCodeSchema = z
  .string()
  .regex(CODE_PATTERN, 'pairing code must be 8 letters or digits');
export type PairingCode = z.infer<typeof PairingCodeSchema>;

/**
 * Normalises operator input (lower case, spaces or a dash between groups) to the
 * canonical form. Returns null when the result is not a well-formed code.
 */
export function normalisePairingCode(input: string): PairingCode | null {
  if (input.length > 32) return null;
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  return CODE_PATTERN.test(cleaned) ? cleaned : null;
}

/** Display form: `ABCD-EFGH`. */
export function formatPairingCode(code: PairingCode): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Opaque secrets are base64url strings of 32 random bytes (43 characters). */
export const OpaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'malformed token');
export type OpaqueToken = z.infer<typeof OpaqueTokenSchema>;

/** `POST /player/pairing` has no request body. */
export const PairingCreateResponseSchema = z
  .object({
    pairingId: PairingSessionIdSchema,
    code: PairingCodeSchema,
    /** Secret held only by the player; sent as `Authorization: Bearer` when polling. */
    pollingToken: OpaqueTokenSchema,
    /** Server time. A player must not compare it with its own clock, which may be wrong. */
    expiresAt: UtcTimestampSchema,
    /** Lifetime from the moment of the response; players count down from this. */
    expiresInSeconds: z.number().int().min(1).max(3600),
    pollIntervalMs: z.number().int().min(1000).max(60_000),
  })
  .strict();
export type PairingCreateResponse = z.infer<typeof PairingCreateResponseSchema>;

/** `GET /player/pairing/:id` */
export const PairingPollResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), expiresAt: UtcTimestampSchema }).strict(),
  z
    .object({
      status: z.literal('claimed'),
      /** Delivered exactly once. A second poll returns `consumed`. */
      deviceToken: OpaqueTokenSchema,
      registrationId: RegistrationIdSchema,
      orgId: OrgIdSchema,
      display: z
        .object({
          id: DisplayIdSchema,
          name: z.string(),
          canvas: CanvasSchema,
          contentRect: RectSchema.nullable(),
        })
        .strict(),
    })
    .strict(),
  z.object({ status: z.literal('consumed') }).strict(),
  z.object({ status: z.literal('expired') }).strict(),
]);
export type PairingPollResponse = z.infer<typeof PairingPollResponseSchema>;

/** `POST /api/displays/:id/claim` */
export const PairingClaimRequestSchema = z
  .object({
    code: z
      .string()
      .max(32)
      .transform((value, ctx) => {
        const code = normalisePairingCode(value);
        if (code === null) {
          ctx.addIssue({ code: 'custom', message: 'pairing code must be 8 letters or digits' });
          return z.NEVER;
        }
        return code;
      }),
  })
  .strict();
export type PairingClaimRequest = z.infer<typeof PairingClaimRequestSchema>;

export const PairingClaimResponseSchema = z
  .object({
    displayId: DisplayIdSchema,
    pairingId: PairingSessionIdSchema,
    /** Registration that was revoked because this claim replaces it, if any. */
    replacedRegistrationId: RegistrationIdSchema.nullable(),
  })
  .strict();
export type PairingClaimResponse = z.infer<typeof PairingClaimResponseSchema>;
