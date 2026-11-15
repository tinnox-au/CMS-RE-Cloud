import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE,
  CanvasSpecSchema,
  DEFAULT_LIMITS,
  DisplayCreateSchema,
  HeartbeatV1Schema,
  IdempotencyKeySchema,
  LoginQuerySchema,
  ManifestV1Schema,
  MediaJobResultSchema,
  MediaUrlQuerySchema,
  PAIRING_CODE_ALPHABET,
  PairingClaimRequestSchema,
  PlaylistReplaceSchema,
  ROUTES,
  apiError,
  ApiErrorSchema,
  formatPairingCode,
  limitsFromEnv,
  manifestEtag,
  normalisePairingCode,
  parseManifest,
  publicationIdFromEtag,
} from './index.ts';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asset = (o: Record<string, unknown> = {}) => ({
  assetId: U(1),
  mediaType: 'image/png',
  kind: 'image',
  bytes: 10,
  sha256: 'ab'.repeat(32),
  durationMs: 5000,
  fit: 'contain',
  width: 4,
  height: 4,
  ...o,
});
const manifest = (o: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  publicationId: U(2),
  displayId: U(3),
  createdAt: '2026-11-14T00:00:00.000Z',
  canvas: { width: 640, height: 1344 },
  contentRect: null,
  muted: true,
  assets: [asset()],
  ...o,
});

describe('canvas and content rectangle', () => {
  it('accepts landscape, portrait and unusual canvases', () => {
    for (const canvas of [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 640, height: 1344 },
      { width: 768, height: 448 },
      { width: 16, height: 16384 },
    ]) {
      expect(
        CanvasSpecSchema.safeParse({ canvas, contentRect: null }).success,
        JSON.stringify(canvas),
      ).toBe(true);
    }
  });
  it('rejects out-of-range, fractional and non-numeric dimensions', () => {
    for (const canvas of [
      { width: 15, height: 100 },
      { width: 100, height: 16385 },
      { width: 100.5, height: 100 },
      { width: '100', height: 100 },
      { width: -1, height: 100 },
      { width: 100 },
    ]) {
      expect(
        CanvasSpecSchema.safeParse({ canvas, contentRect: null }).success,
        JSON.stringify(canvas),
      ).toBe(false);
    }
  });
  it('validates content rectangle bounds against the canvas', () => {
    const canvas = { width: 640, height: 1344 };
    expect(
      CanvasSpecSchema.safeParse({ canvas, contentRect: { x: 0, y: 64, width: 640, height: 1280 } })
        .success,
    ).toBe(true);
    const tooWide = CanvasSpecSchema.safeParse({
      canvas,
      contentRect: { x: 1, y: 0, width: 640, height: 100 },
    });
    expect(tooWide.success).toBe(false);
    if (!tooWide.success) expect(tooWide.error.issues[0]?.message).toMatch(/exceeds canvas width/);
    expect(
      CanvasSpecSchema.safeParse({
        canvas,
        contentRect: { x: 0, y: 1300, width: 100, height: 100 },
      }).success,
    ).toBe(false);
    expect(
      CanvasSpecSchema.safeParse({ canvas, contentRect: { x: -1, y: 0, width: 100, height: 100 } })
        .success,
    ).toBe(false);
    expect(
      CanvasSpecSchema.safeParse({ canvas, contentRect: { x: 0, y: 0, width: 8, height: 100 } })
        .success,
    ).toBe(false);
  });
  it('applies defaults and bounds when creating a display, and rejects unknown fields', () => {
    const parsed = DisplayCreateSchema.parse({
      siteId: U(9),
      name: '  Foyer wall  ',
      canvas: { width: 768, height: 448 },
    });
    expect(parsed).toMatchObject({ name: 'Foyer wall', contentRect: null, defaultFit: 'contain' });
    expect(
      DisplayCreateSchema.safeParse({
        siteId: U(9),
        name: 'x',
        canvas: { width: 768, height: 448 },
        orgId: U(1),
      }).success,
    ).toBe(false);
    expect(
      DisplayCreateSchema.safeParse({
        siteId: U(9),
        name: 'x',
        canvas: { width: 768, height: 448 },
        contentRect: { x: 700, y: 0, width: 100, height: 100 },
      }).success,
    ).toBe(false);
    expect(
      DisplayCreateSchema.safeParse({
        siteId: U(9),
        name: 'bad\u0000name',
        canvas: { width: 768, height: 448 },
      }).success,
    ).toBe(false);
    expect(
      DisplayCreateSchema.safeParse({
        siteId: U(9),
        name: '   ',
        canvas: { width: 768, height: 448 },
      }).success,
    ).toBe(false);
  });
});

describe('manifest v1', () => {
  it('accepts a well-formed manifest', () => {
    expect(ManifestV1Schema.safeParse(manifest()).success).toBe(true);
    expect(parseManifest(manifest())).toMatchObject({ ok: true });
  });
  it('distinguishes an unsupported version from a malformed document', () => {
    expect(parseManifest(manifest({ schemaVersion: 2 }))).toMatchObject({
      ok: false,
      reason: 'unsupported_version',
    });
    expect(parseManifest({ hello: 'world' })).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parseManifest('<html>')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parseManifest(manifest({ assets: [] }))).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
  });
  it('rejects bad hashes, sizes, durations, extra fields, URLs in place of ids and audio', () => {
    const bad = [
      manifest({ assets: [asset({ sha256: 'AB'.repeat(32) })] }),
      manifest({ assets: [asset({ sha256: 'abc' })] }),
      manifest({ assets: [asset({ bytes: 0 })] }),
      manifest({ assets: [asset({ durationMs: 0 })] }),
      manifest({ assets: [asset({ mediaType: 'image/svg+xml' })] }),
      manifest({ assets: [asset({ assetId: 'https://example.invalid/a.png' })] }),
      manifest({ assets: [asset({ url: 'https://example.invalid/a.png' })] }),
      manifest({ assets: [asset({ fit: 'stretch' })] }),
      manifest({ muted: false }),
      manifest({ html: '<script>' }),
      manifest({ contentRect: { x: 600, y: 0, width: 100, height: 100 } }),
      manifest({ assets: Array.from({ length: ABSOLUTE.maxPlaylistItems + 1 }, () => asset()) }),
    ];
    bad.forEach((m, i) => expect(ManifestV1Schema.safeParse(m).success, `case ${i}`).toBe(false));
  });
  it('requires a repeated asset to carry the same facts', () => {
    expect(
      ManifestV1Schema.safeParse(
        manifest({ assets: [asset(), asset({ durationMs: 9000, fit: 'cover' })] }),
      ).success,
    ).toBe(true);
    expect(
      ManifestV1Schema.safeParse(
        manifest({ assets: [asset(), asset({ sha256: 'cd'.repeat(32) })] }),
      ).success,
    ).toBe(false);
  });
  it('round-trips the ETag form', () => {
    expect(manifestEtag(U(2))).toBe(`"${U(2)}"`);
    expect(publicationIdFromEtag(`"${U(2)}"`)).toBe(U(2));
    expect(publicationIdFromEtag(`W/"${U(2)}"`)).toBe(U(2));
    for (const h of [undefined, null, '', '*', U(2), '"abc"', `"${U(2)}", "x"`, 'x'.repeat(500)])
      expect(publicationIdFromEtag(h)).toBeNull();
  });
});

describe('heartbeat v1', () => {
  const hb = (o: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    seq: 1,
    sentAt: '2026-11-14T00:00:00.000Z',
    displayId: U(3),
    downloadedPublicationId: U(2),
    activePublicationId: U(2),
    activeItemIndex: 0,
    playerState: 'playing',
    staging: null,
    errors: [],
    player: { version: '0.1.0', storagePersisted: true, online: true },
    ...o,
  });
  const error = {
    code: 'integrity_mismatch',
    message: 'hash differs',
    at: '2026-11-14T00:00:00.000Z',
    publicationId: U(2),
    assetId: U(1),
  };
  it('accepts a valid report', () => {
    expect(HeartbeatV1Schema.safeParse(hb()).success).toBe(true);
    expect(
      HeartbeatV1Schema.safeParse(
        hb({
          errors: [error],
          staging: { publicationId: U(4), phase: 'downloading', assetsDone: 1, assetsTotal: 3 },
        }),
      ).success,
    ).toBe(true);
  });
  it('bounds every size and rejects inconsistent or unknown content', () => {
    const bad = [
      hb({ seq: -1 }),
      hb({ seq: 1.5 }),
      hb({ seq: Number.MAX_SAFE_INTEGER + 2 }),
      hb({ schemaVersion: 2 }),
      hb({ activeItemIndex: null }),
      hb({ activePublicationId: null, activeItemIndex: null }),
      hb({ playerState: 'online' }),
      hb({ errors: Array.from({ length: ABSOLUTE.maxHeartbeatErrors + 1 }, () => error) }),
      hb({ errors: [{ ...error, message: 'x'.repeat(ABSOLUTE.maxErrorMessageLength + 1) }] }),
      hb({ errors: [{ ...error, code: 'made_up' }] }),
      hb({ staging: { publicationId: U(4), phase: 'downloading', assetsDone: 4, assetsTotal: 3 } }),
      hb({ player: { version: 'x'.repeat(41), storagePersisted: null, online: true } }),
      hb({ orgId: U(1) }),
      hb({ displayId: 'not-a-uuid' }),
    ];
    bad.forEach((r, i) => expect(HeartbeatV1Schema.safeParse(r).success, `case ${i}`).toBe(false));
  });
});

describe('pairing codes', () => {
  it('uses an unambiguous alphabet', () => {
    expect(PAIRING_CODE_ALPHABET).toHaveLength(30);
    for (const ch of '01OILU') expect(PAIRING_CODE_ALPHABET.includes(ch)).toBe(false);
  });
  it('normalises operator input and rejects malformed codes', () => {
    expect(normalisePairingCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalisePairingCode(' AB CD EF GH ')).toBe('ABCDEFGH');
    expect(formatPairingCode('ABCDEFGH')).toBe('ABCD-EFGH');
    for (const bad of [
      '',
      'ABCDEFG',
      'ABCDEFGHJ',
      'ABCD0FGH',
      'ABCDIFGH',
      "ABCD';--",
      'A'.repeat(40),
    ])
      expect(normalisePairingCode(bad), bad).toBeNull();
    expect(PairingClaimRequestSchema.parse({ code: 'abcd-efgh' })).toEqual({ code: 'ABCDEFGH' });
    expect(PairingClaimRequestSchema.safeParse({ code: 'ABCD0FGH' }).success).toBe(false);
    expect(PairingClaimRequestSchema.safeParse({ code: 'ABCDEFGH', displayId: U(1) }).success).toBe(
      false,
    );
  });
});

describe('other request schemas', () => {
  it('bounds playlists and idempotency keys', () => {
    const item = { mediaId: U(1), durationMs: 5000, fit: null };
    expect(
      PlaylistReplaceSchema.safeParse({
        name: 'Lobby loop',
        items: [item, { ...item, durationMs: null, fit: 'cover' }],
      }).success,
    ).toBe(true);
    expect(
      PlaylistReplaceSchema.safeParse({
        name: 'x',
        items: Array.from({ length: ABSOLUTE.maxPlaylistItems + 1 }, () => item),
      }).success,
    ).toBe(false);
    expect(
      PlaylistReplaceSchema.safeParse({ name: 'x', items: [{ ...item, html: '<b>' }] }).success,
    ).toBe(false);
    expect(
      PlaylistReplaceSchema.safeParse({ name: 'x', items: [{ ...item, durationMs: -5 }] }).success,
    ).toBe(false);
    expect(IdempotencyKeySchema.safeParse(U(7)).success).toBe(true);
    for (const bad of ['short', 'has space in the key!', 'x'.repeat(65)])
      expect(IdempotencyKeySchema.safeParse(bad).success).toBe(false);
  });
  it('accepts only local return paths after sign-in', () => {
    for (const ok of [undefined, '/', '/displays', '/displays/abc-123'])
      expect(LoginQuerySchema.safeParse({ returnTo: ok }).success, String(ok)).toBe(true);
    for (const bad of [
      '//evil.example',
      'https://evil.example',
      '/\\evil',
      'displays',
      '/a?b=c',
      '/a#b',
      '/a%2f%2fb',
    ]) {
      expect(LoginQuerySchema.safeParse({ returnTo: bad }).success, bad).toBe(false);
    }
  });
  it('validates signed media URL parameters and worker results', () => {
    const q = { pub: U(2), reg: U(5), exp: '1794640000', sig: 'A'.repeat(43) };
    expect(MediaUrlQuerySchema.safeParse(q).success).toBe(true);
    expect(MediaUrlQuerySchema.safeParse({ ...q, sig: 'short' }).success).toBe(false);
    expect(MediaUrlQuerySchema.safeParse({ ...q, exp: 'tomorrow' }).success).toBe(false);
    expect(MediaUrlQuerySchema.safeParse({ ...q, path: '../x' }).success).toBe(false);
    expect(
      MediaJobResultSchema.safeParse({
        schemaVersion: 1,
        jobId: U(6),
        outcome: 'accepted',
        kind: 'video',
        mimeType: 'video/mp4',
        width: 1920,
        height: 1080,
        durationMs: 4000,
        codec: 'h264',
      }).success,
    ).toBe(true);
    expect(
      MediaJobResultSchema.safeParse({
        schemaVersion: 1,
        jobId: U(6),
        outcome: 'rejected',
        errorCode: 'unsupported_codec',
        errorDetail: 'hevc',
      }).success,
    ).toBe(true);
    expect(
      MediaJobResultSchema.safeParse({
        schemaVersion: 1,
        jobId: U(6),
        outcome: 'accepted',
        kind: 'video',
        mimeType: 'video/mp4',
        width: 1920,
        height: 1080,
        durationMs: 4000,
        codec: 'h264',
        sha256: 'x',
      }).success,
    ).toBe(false);
    expect(
      MediaJobResultSchema.safeParse({
        schemaVersion: 1,
        jobId: U(6),
        outcome: 'rejected',
        errorCode: 'whatever',
        errorDetail: null,
      }).success,
    ).toBe(false);
  });
  it('builds an error envelope that matches its schema', () => {
    const e = apiError('validation_failed', 'The request is not valid.', {
      details: [{ path: 'canvas.width', message: 'too small' }],
    });
    expect(ApiErrorSchema.safeParse(e).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: 'nope', message: 'x' } }).success).toBe(false);
  });
  it('percent-encodes route parameters', () => {
    expect(ROUTES.display(U(3))).toBe(`/api/displays/${U(3)}`);
    expect(ROUTES.playerMedia('../../etc')).toBe('/player/media/..%2F..%2Fetc');
    expect(ROUTES.playlistPublishPattern).toBe('/api/playlists/:id/publish');
  });
});

describe('limits', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_LIMITS).toMatchObject({
      maxUploadBytes: 209_715_200,
      maxImageSidePx: 8192,
      maxImagePixels: 40_000_000,
      maxVideoWidthPx: 3840,
      maxVideoHeightPx: 2160,
      maxVideoDurationMs: 600_000,
      minImageItemDurationMs: 1000,
      maxImageItemDurationMs: 3_600_000,
      minCanvasSidePx: 16,
      maxCanvasSidePx: 16_384,
      maxOrgStorageBytes: 5_368_709_120,
      pairingCodeTtlSeconds: 600,
      pairingMaxWrongAttempts: 5,
      pairingMaxSessionsPerIp: 10,
    });
    expect(limitsFromEnv({})).toEqual(DEFAULT_LIMITS);
  });
  it('reads overrides and rejects unusable values with the variable name', () => {
    expect(
      limitsFromEnv({ LIMIT_MAX_UPLOAD_BYTES: '1048576', LIMIT_MAX_PLAYLIST_ITEMS: ' 20 ' }),
    ).toMatchObject({ maxUploadBytes: 1_048_576, maxPlaylistItems: 20 });
    expect(() => limitsFromEnv({ LIMIT_MAX_UPLOAD_BYTES: '10MB' })).toThrow(
      /LIMIT_MAX_UPLOAD_BYTES/,
    );
    expect(() => limitsFromEnv({ LIMIT_MAX_UPLOAD_BYTES: '-5' })).toThrow(/LIMIT_MAX_UPLOAD_BYTES/);
    expect(() => limitsFromEnv({ LIMIT_MAX_UPLOAD_BYTES: '0' })).toThrow();
    expect(() => limitsFromEnv({ LIMIT_MAX_CANVAS_SIDE_PX: '99999' })).toThrow(/Canvas limits/);
    expect(() => limitsFromEnv({ LIMIT_MAX_PLAYLIST_ITEMS: '5000' })).toThrow(
      /LIMIT_MAX_PLAYLIST_ITEMS/,
    );
    expect(() => limitsFromEnv({ LIMIT_HEARTBEAT_STALE_AFTER_SECONDS: '5' })).toThrow(
      /heartbeatStaleAfterSeconds/,
    );
    expect(() => limitsFromEnv({ LIMIT_MIN_IMAGE_ITEM_DURATION_MS: '9999999' })).toThrow();
  });
});
