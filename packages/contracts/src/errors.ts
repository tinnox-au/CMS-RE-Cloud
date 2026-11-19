import { z } from 'zod';

/** Stable machine-readable API error codes. */
export const API_ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'csrf_failed',
  'origin_not_allowed',
  'not_found',
  'conflict',
  'idempotency_conflict',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'storage_quota_exceeded',
  'media_not_ready',
  'media_in_use',
  'playlist_in_use',
  'app_in_use',
  'schedule_in_use',
  'layout_in_use',
  'last_owner',
  'publication_rejected',
  'pairing_code_invalid',
  'pairing_expired',
  'pairing_locked',
  'device_revoked',
  'url_expired',
  'url_signature_invalid',
  'range_not_satisfiable',
  'service_unavailable',
  'internal_error',
] as const;
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorDetailSchema = z
  .object({
    /** Dotted path to the offending field, or an item reference such as items[2]. */
    path: z.string().max(200),
    message: z.string().max(500),
    code: z.string().max(80).optional(),
  })
  .strict();
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

/** Envelope for every non-2xx JSON response from the API. */
export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        /** Human-readable, safe to show to an operator. Never contains secrets or stack traces. */
        message: z.string().max(500),
        details: z.array(ApiErrorDetailSchema).max(100).optional(),
        requestId: z.string().max(100).optional(),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

export function apiError(
  code: ApiErrorCode,
  message: string,
  extra: { details?: ApiErrorDetail[]; requestId?: string } = {},
): ApiError {
  return { error: { code, message, ...extra } };
}
