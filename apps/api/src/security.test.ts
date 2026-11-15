import {
  PAIRING_CODE_ALPHABET,
  MediaUrlQuerySchema,
  OpaqueTokenSchema,
  PairingCodeSchema,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { mfaSatisfied } from './auth/oidc.ts';
import { sniffMediaType } from './media/sniff.ts';
import { displayNameFromUpload } from './routes/media.ts';
import {
  buildMediaUrl,
  pairingClientKey,
  randomPairingCode,
  randomToken,
  safeEqual,
  signMediaUrl,
  verifyMediaUrl,
  type MediaUrlClaims,
} from './security.ts';

const secret = 'unit-test-secret-0123456789abcdef0123456789';
const claims: MediaUrlClaims = {
  registrationId: '11111111-1111-4111-8111-111111111111',
  publicationId: '22222222-2222-4222-8222-222222222222',
  assetId: '33333333-3333-4333-8333-333333333333',
  expiresAtSeconds: 2_000_000_000,
};

describe('signed media URLs', () => {
  it('accepts its own signature until the expiry and refuses it from then on', () => {
    const sig = signMediaUrl(secret, claims);
    expect(verifyMediaUrl(secret, claims, sig, claims.expiresAtSeconds - 1)).toBe('ok');
    expect(verifyMediaUrl(secret, claims, sig, claims.expiresAtSeconds)).toBe('expired');
    expect(verifyMediaUrl(secret, claims, sig, claims.expiresAtSeconds + 1)).toBe('expired');
  });

  it('refuses a signature when any signed field differs', () => {
    const sig = signMediaUrl(secret, claims);
    const other = '44444444-4444-4444-8444-444444444444';
    const variants: MediaUrlClaims[] = [
      { ...claims, registrationId: other },
      { ...claims, publicationId: other },
      { ...claims, assetId: other },
      { ...claims, expiresAtSeconds: claims.expiresAtSeconds + 1 },
      // Swapping two ids must not produce the same signed text.
      { ...claims, registrationId: claims.publicationId, publicationId: claims.registrationId },
    ];
    for (const variant of variants) {
      expect(verifyMediaUrl(secret, variant, sig, 0)).toBe('bad_signature');
    }
    expect(verifyMediaUrl('another-secret-0123456789abcdef0123456789', claims, sig, 0)).toBe(
      'bad_signature',
    );
    expect(verifyMediaUrl(secret, claims, '', 0)).toBe('bad_signature');
    expect(verifyMediaUrl(secret, claims, `${sig}A`, 0)).toBe('bad_signature');
    expect(verifyMediaUrl(secret, { ...claims, expiresAtSeconds: Number.NaN }, sig, 0)).toBe(
      'bad_signature',
    );
  });

  it('reports a forged signature as forged even when it is also expired', () => {
    expect(verifyMediaUrl(secret, claims, 'A'.repeat(43), claims.expiresAtSeconds + 10)).toBe(
      'bad_signature',
    );
  });

  it('builds a URL whose query matches the contract schema', () => {
    const url = new URL(buildMediaUrl('https://api.example', secret, claims));
    expect(url.origin).toBe('https://api.example');
    expect(url.pathname).toBe(`/player/media/${claims.assetId}`);
    const query = MediaUrlQuerySchema.parse(Object.fromEntries(url.searchParams));
    expect(query.sig).toBe(signMediaUrl(secret, claims));
  });
});

describe('tokens and codes', () => {
  it('produces opaque tokens of the contract form, never repeating', () => {
    const tokens = new Set(Array.from({ length: 200 }, randomToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(OpaqueTokenSchema.safeParse(token).success).toBe(true);
  });

  it('produces pairing codes from the unambiguous alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const code = randomPairingCode();
      expect(PairingCodeSchema.safeParse(code).success).toBe(true);
      for (const symbol of code) seen.add(symbol);
    }
    // 4000 draws from 30 symbols: every symbol appears, so no part of the alphabet is unreachable.
    expect(seen.size).toBe(PAIRING_CODE_ALPHABET.length);
  });

  it('compares strings without early exit on content', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('derives a stable, non-reversible pairing rate-limit key from an address', () => {
    const key = pairingClientKey(secret, '203.0.113.9');
    expect(key).toBe(pairingClientKey(secret, '203.0.113.9'));
    expect(key).not.toBe(pairingClientKey(secret, '203.0.113.10'));
    expect(key).not.toContain('203.0.113.9');
    expect(key.length).toBeLessThanOrEqual(128);
  });
});

describe('upload helpers', () => {
  it('recognises only JPEG, PNG and ISO-BMFF signatures', () => {
    const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
    expect(sniffMediaType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('image/jpeg');
    expect(sniffMediaType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png',
    );
    expect(
      sniffMediaType(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d)),
    ).toBe('video/mp4');
    expect(sniffMediaType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffMediaType(Buffer.from('<!doctype html><html>'))).toBeNull();
    expect(sniffMediaType(Buffer.from('GIF89a..........'))).toBeNull();
    expect(sniffMediaType(Buffer.from('%PDF-1.7 ........'))).toBeNull();
    expect(sniffMediaType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(sniffMediaType(bytes())).toBeNull();
  });

  it('reduces an uploaded file name to a harmless label', () => {
    expect(displayNameFromUpload('holiday.jpg')).toBe('holiday.jpg');
    expect(displayNameFromUpload('../../etc/passwd')).toBe('passwd');
    expect(displayNameFromUpload('C:\\Users\\me\\clip.mp4')).toBe('clip.mp4');
    expect(displayNameFromUpload('a\u0000b\r\nc.png')).toBe('abc.png');
    expect(displayNameFromUpload('evil\u202egnp.exe')).toBe('evilgnp.exe');
    expect(displayNameFromUpload('')).toBe('upload');
    expect(displayNameFromUpload('dir/')).toBe('upload');
    expect(displayNameFromUpload(undefined)).toBe('upload');
    expect(displayNameFromUpload('x'.repeat(1000)).length).toBe(255);
  });
});

describe('MFA evidence from ID token claims', () => {
  it('does not judge when nothing is required, and says so', () => {
    expect(mfaSatisfied({ acr: null, amr: [] }, { acrValues: [], amrValues: [] })).toEqual({
      ok: true,
      checked: false,
    });
  });

  it('requires a listed acr value when acr values are configured', () => {
    const required = { acrValues: ['2', 'urn:mfa'], amrValues: [] };
    expect(mfaSatisfied({ acr: '2', amr: [] }, required)).toEqual({ ok: true, checked: true });
    expect(mfaSatisfied({ acr: '1', amr: [] }, required)).toEqual({ ok: false });
    expect(mfaSatisfied({ acr: null, amr: ['otp'] }, required)).toEqual({ ok: false });
  });

  it('requires at least one listed amr value when amr values are configured', () => {
    const required = { acrValues: [], amrValues: ['otp', 'mfa'] };
    expect(mfaSatisfied({ acr: null, amr: ['pwd', 'otp'] }, required)).toEqual({
      ok: true,
      checked: true,
    });
    expect(mfaSatisfied({ acr: '2', amr: ['pwd'] }, required)).toEqual({ ok: false });
    expect(mfaSatisfied({ acr: null, amr: [] }, required)).toEqual({ ok: false });
  });

  it('requires both when both are configured', () => {
    const required = { acrValues: ['2'], amrValues: ['otp'] };
    expect(mfaSatisfied({ acr: '2', amr: ['otp'] }, required)).toEqual({ ok: true, checked: true });
    expect(mfaSatisfied({ acr: '2', amr: ['pwd'] }, required)).toEqual({ ok: false });
    expect(mfaSatisfied({ acr: '1', amr: ['otp'] }, required)).toEqual({ ok: false });
  });
});
