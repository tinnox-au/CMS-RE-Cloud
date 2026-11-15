/**
 * Small cryptographic helpers: opaque tokens, constant-time comparison,
 * pairing codes and the HMAC signature of player media URLs (D13).
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH, ROUTES } from '@tinnox/contracts';

/** 32 random bytes as base64url: 43 characters, matches OpaqueTokenSchema. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time string comparison. Length differences are not hidden; contents are. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Compare against itself so the work done does not depend on where the inputs differ.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Uniformly random pairing code from the unambiguous alphabet (CSPRNG, no modulo bias). */
export function randomPairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET.charAt(randomInt(PAIRING_CODE_ALPHABET.length));
  }
  return code;
}

/** Keyed hash of a client address, so raw addresses are not stored with pairing sessions. */
export function pairingClientKey(secret: string, clientAddress: string): string {
  return createHmac('sha256', secret)
    .update(`pairing-client\n${clientAddress}`)
    .digest('base64url');
}

/**
 * Short keyed fingerprint of a client address for audit records: lets an administrator
 * correlate repeated events from one source without storing the address itself.
 */
export function clientFingerprint(secret: string, clientKey: string): string {
  return createHmac('sha256', secret)
    .update(`audit-client\n${clientKey}`)
    .digest('base64url')
    .slice(0, 16);
}

export interface MediaUrlClaims {
  readonly registrationId: string;
  readonly publicationId: string;
  readonly assetId: string;
  /** Unix time in seconds after which the URL is refused. */
  readonly expiresAtSeconds: number;
}

const SIGNATURE_VERSION = 'tinnox-media-url-v1';

/** base64url HMAC-SHA256 over every field the URL carries, in a fixed order. */
export function signMediaUrl(secret: string, claims: MediaUrlClaims): string {
  return createHmac('sha256', secret)
    .update(
      [
        SIGNATURE_VERSION,
        claims.registrationId,
        claims.publicationId,
        claims.assetId,
        String(claims.expiresAtSeconds),
      ].join('\n'),
    )
    .digest('base64url');
}

export type MediaUrlCheck = 'ok' | 'bad_signature' | 'expired';

/**
 * Checks the signature in constant time, then the expiry. The signature is
 * checked first so an attacker learns nothing about expiry from a forged URL.
 */
export function verifyMediaUrl(
  secret: string,
  claims: MediaUrlClaims,
  signature: string,
  nowSeconds: number,
): MediaUrlCheck {
  if (!Number.isSafeInteger(claims.expiresAtSeconds)) return 'bad_signature';
  if (!safeEqual(signMediaUrl(secret, claims), signature)) return 'bad_signature';
  if (claims.expiresAtSeconds <= nowSeconds) return 'expired';
  return 'ok';
}

/** Absolute signed URL for one asset. Never log the result. */
export function buildMediaUrl(
  publicOrigin: string,
  secret: string,
  claims: MediaUrlClaims,
): string {
  const query = new URLSearchParams({
    pub: claims.publicationId,
    reg: claims.registrationId,
    exp: String(claims.expiresAtSeconds),
    sig: signMediaUrl(secret, claims),
  });
  return `${publicOrigin}${ROUTES.playerMedia(claims.assetId)}?${query.toString()}`;
}
