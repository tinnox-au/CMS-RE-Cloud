import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE,
  APP_TEXT_LIMITS,
  AppContentSchema,
  AppCreateSchema,
  AppPatchSchema,
  ClockSettingsSchema,
  CountdownSettingsSchema,
  DateSettingsSchema,
  QrSettingsSchema,
  TextSettingsSchema,
  TickerSettingsSchema,
  ManifestV3Schema,
  PlaylistItemInputSchema,
  CanvasSpecSchema,
  DEFAULT_LIMITS,
  DisplayCreateSchema,
  HeartbeatV1Schema,
  IdempotencyKeySchema,
  LocalDateTimeSchema,
  LoginQuerySchema,
  ManifestSchema,
  ManifestV1Schema,
  ManifestV2Schema,
  MediaJobResultSchema,
  MediaPatchSchema,
  MediaUrlQuerySchema,
  PAIRING_CODE_ALPHABET,
  PairingClaimRequestSchema,
  PlaylistReplaceSchema,
  ROUTES,
  WorkingHoursSchema,
  apiError,
  ApiErrorSchema,
  formatPairingCode,
  limitsFromEnv,
  manifestEtag,
  manifestV2Facts,
  normalisePairingCode,
  parseManifest,
  publicationIdFromEtag,
} from './index.ts';

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;
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
    expect(parseManifest(manifest({ schemaVersion: 4 }))).toMatchObject({
      ok: false,
      reason: 'unsupported_version',
      message: 'manifest schemaVersion 4 is not supported (expected 1, 2 or 3)',
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

describe('manifest v2', () => {
  const HOURS = [{ start: '09:00', end: '17:00' }, null, null, null, null, null, null];
  const v2 = (o: Record<string, unknown> = {}) =>
    manifest({
      schemaVersion: 2,
      timeZone: 'Australia/Melbourne',
      transition: 'fade',
      shuffle: true,
      rotation: 90,
      workingHours: HOURS,
      assets: [asset({ availableFrom: '2026-12-01T09:00', availableUntil: null })],
      ...o,
    });

  it('accepts a well-formed v2 manifest through every entry point', () => {
    expect(ManifestV2Schema.safeParse(v2()).success).toBe(true);
    expect(ManifestSchema.safeParse(v2()).success).toBe(true);
    expect(ManifestSchema.safeParse(manifest()).success).toBe(true);
    expect(parseManifest(v2())).toMatchObject({ ok: true, manifest: { schemaVersion: 2 } });
  });

  it('reads the playback facts of either version', () => {
    expect(manifestV2Facts(ManifestSchema.parse(manifest()))).toEqual({
      transition: 'cut',
      shuffle: false,
      rotation: 0,
      workingHours: null,
      timeZone: null,
    });
    expect(manifestV2Facts(ManifestSchema.parse(v2()))).toEqual({
      transition: 'fade',
      shuffle: true,
      rotation: 90,
      workingHours: HOURS,
      timeZone: 'Australia/Melbourne',
    });
  });

  it('rejects extra or missing fields, unknown values and a window out of order', () => {
    const noShuffle = Object.fromEntries(Object.entries(v2()).filter(([k]) => k !== 'shuffle'));
    const bad = [
      v2({ html: '<script>' }),
      noShuffle,
      v2({ rotation: 45 }),
      v2({ transition: 'wipe' }),
      v2({ timeZone: '' }),
      v2({ assets: [asset({ availableFrom: null, availableUntil: null, url: 'x' })] }),
      v2({ assets: [asset()] }),
      v2({
        assets: [asset({ availableFrom: '2026-12-01T09:00', availableUntil: '2026-12-01T09:00' })],
      }),
      v2({
        assets: [asset({ availableFrom: '2026-12-02T09:00', availableUntil: '2026-12-01T09:00' })],
      }),
    ];
    bad.forEach((m, i) => expect(parseManifest(m).ok, `case ${i}`).toBe(false));
  });

  it('refuses a v1 document that carries a v2 field', () => {
    expect(parseManifest(manifest({ rotation: 0 })).ok).toBe(false);
    expect(
      parseManifest(manifest({ assets: [asset({ availableFrom: null, availableUntil: null })] }))
        .ok,
    ).toBe(false);
  });
});

describe('built-in apps', () => {
  const style = { textColour: '#ffffff', backgroundColour: '#000000' };
  const SETTINGS = {
    clock: { hourCycle: '24', showSeconds: true, ...style },
    date: { format: 'long', ...style },
    countdown: {
      target: '2026-12-25T09:00',
      label: 'Until the party',
      finishedText: 'Happy holidays',
      showSeconds: false,
      ...style,
    },
    ticker: { text: 'Doors open at nine', speed: 'slow', ...style },
    qr: { content: 'https://example.invalid/menu', caption: '', ...style },
    text: { heading: 'Welcome', body: 'Line one\nLine two', ...style },
  } as const;
  const SCHEMAS = {
    clock: ClockSettingsSchema,
    date: DateSettingsSchema,
    countdown: CountdownSettingsSchema,
    ticker: TickerSettingsSchema,
    qr: QrSettingsSchema,
    text: TextSettingsSchema,
  } as const;
  const appItem = (o: Record<string, unknown> = {}) => ({
    kind: 'app',
    appId: U(60),
    durationMs: 10_000,
    content: { type: 'clock', settings: SETTINGS.clock },
    ...o,
  });

  it('accepts every app with valid settings, and only with all of them', () => {
    for (const type of Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]) {
      expect(ok(SCHEMAS[type], SETTINGS[type]), type).toBe(true);
      expect(ok(AppContentSchema, { type, settings: SETTINGS[type] }), type).toBe(true);
      expect(ok(SCHEMAS[type], { ...SETTINGS[type], extra: true }), `${type} extra`).toBe(false);
      expect(ok(SCHEMAS[type], { ...SETTINGS[type], textColour: '#FFFFFF' }), `${type} upper`).toBe(
        false,
      );
      expect(ok(SCHEMAS[type], { ...SETTINGS[type], backgroundColour: '#fff' }), type).toBe(false);
      const { textColour: _gone, ...missing } = SETTINGS[type];
      expect(ok(SCHEMAS[type], missing), `${type} missing`).toBe(false);
    }
  });

  it('refuses a lone surrogate, which a QR code cannot hold', () => {
    const settings = { caption: '', textColour: '#ffffff', backgroundColour: '#000000' };
    expect(QrSettingsSchema.safeParse({ ...settings, content: 'a\ud800b' }).success).toBe(false);
    expect(
      QrSettingsSchema.safeParse({ ...settings, content: 'caf\u00e9 \ud83d\ude00' }).success,
    ).toBe(true);
  });

  it('bounds every text field and refuses control and direction characters', () => {
    const fields = [
      [CountdownSettingsSchema, SETTINGS.countdown, 'label', APP_TEXT_LIMITS.countdownLabel],
      [CountdownSettingsSchema, SETTINGS.countdown, 'finishedText', APP_TEXT_LIMITS.finishedText],
      [TickerSettingsSchema, SETTINGS.ticker, 'text', APP_TEXT_LIMITS.tickerText],
      [QrSettingsSchema, SETTINGS.qr, 'content', APP_TEXT_LIMITS.qrContent],
      [QrSettingsSchema, SETTINGS.qr, 'caption', APP_TEXT_LIMITS.qrCaption],
      [TextSettingsSchema, SETTINGS.text, 'heading', APP_TEXT_LIMITS.heading],
      [TextSettingsSchema, SETTINGS.text, 'body', APP_TEXT_LIMITS.body],
    ] as const;
    for (const [schema, base, field, max] of fields) {
      const at = (value: string) => schema.safeParse({ ...base, [field]: value });
      expect(at('x'.repeat(max)).success, `${field} at max`).toBe(true);
      expect(at('x'.repeat(max + 1)).success, `${field} over max`).toBe(false);
      expect(at('a\u0007b').success, `${field} control`).toBe(false);
      expect(at('a\u202eb').success, `${field} direction`).toBe(false);
      expect(at('a\u2028b').success, `${field} separator`).toBe(false);
    }
    // Trimmed; a line feed only in the Text message.
    expect(TickerSettingsSchema.parse({ ...SETTINGS.ticker, text: '  hi  ' }).text).toBe('hi');
    expect(ok(TickerSettingsSchema, { ...SETTINGS.ticker, text: 'a\nb' })).toBe(false);
    expect(ok(TextSettingsSchema, { ...SETTINGS.text, heading: 'a\nb' })).toBe(false);
    // Required text, optional text stays ''.
    expect(ok(TickerSettingsSchema, { ...SETTINGS.ticker, text: '   ' })).toBe(false);
    expect(ok(QrSettingsSchema, { ...SETTINGS.qr, content: '' })).toBe(false);
    expect(ok(CountdownSettingsSchema, { ...SETTINGS.countdown, finishedText: '' })).toBe(false);
    expect(CountdownSettingsSchema.parse({ ...SETTINGS.countdown, label: ' ' }).label).toBe('');
    expect(ok(CountdownSettingsSchema, { ...SETTINGS.countdown, target: '2026-02-30T09:00' })).toBe(
      false,
    );
    expect(ok(ClockSettingsSchema, { ...SETTINGS.clock, hourCycle: '23' })).toBe(false);
    expect(ok(DateSettingsSchema, { ...SETTINGS.date, format: 'iso' })).toBe(false);
    expect(ok(TickerSettingsSchema, { ...SETTINGS.ticker, speed: 'warp' })).toBe(false);
  });

  it('refuses a Text app with neither heading nor message', () => {
    expect(ok(TextSettingsSchema, { ...SETTINGS.text, heading: '' })).toBe(true);
    expect(ok(TextSettingsSchema, { ...SETTINGS.text, body: '' })).toBe(true);
    const both = TextSettingsSchema.safeParse({ ...SETTINGS.text, heading: ' ', body: '' });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]).toMatchObject({
      path: ['heading'],
      message: 'enter a heading or a message',
    });
  });

  it('refuses a type with the settings of another', () => {
    expect(ok(AppContentSchema, { type: 'date', settings: SETTINGS.clock })).toBe(false);
    expect(ok(AppContentSchema, { type: 'weather', settings: SETTINGS.clock })).toBe(false);
    expect(ok(AppContentSchema, { type: 'clock', settings: SETTINGS.clock, extra: 1 })).toBe(false);
  });

  it('creates with content and patches at least one field', () => {
    const content = { type: 'qr', settings: SETTINGS.qr };
    expect(AppCreateSchema.parse({ name: ' Menu ', content })).toEqual({ name: 'Menu', content });
    expect(ok(AppCreateSchema, { name: 'Menu' })).toBe(false);
    expect(ok(AppPatchSchema, { content })).toBe(true);
    expect(ok(AppPatchSchema, {})).toBe(false);
    expect(ok(AppPatchSchema, { type: 'clock' })).toBe(false);
  });

  it('accepts a v3 manifest with media and app items', () => {
    const v3 = manifest({
      schemaVersion: 3,
      timeZone: 'Australia/Melbourne',
      transition: 'cut',
      shuffle: false,
      rotation: 0,
      workingHours: null,
      assets: [appItem(), asset({ availableFrom: null, availableUntil: null })],
    });
    expect(ok(ManifestV3Schema, v3)).toBe(true);
    expect(parseManifest(v3)).toMatchObject({ ok: true, manifest: { schemaVersion: 3 } });
    expect(manifestV2Facts(ManifestSchema.parse(v3)).timeZone).toBe('Australia/Melbourne');
    expect(ok(ManifestV3Schema, { ...v3, assets: [appItem()] })).toBe(true);
    // An app item never names an asset, and carries nothing extra.
    expect(ok(ManifestV3Schema, { ...v3, assets: [appItem({ assetId: U(1) })] })).toBe(false);
    expect(ok(ManifestV3Schema, { ...v3, assets: [appItem({ fit: 'contain' })] })).toBe(false);
    expect(ok(ManifestV3Schema, { ...v3, assets: [appItem({ durationMs: 0 })] })).toBe(false);
    expect(ok(ManifestV3Schema, { ...v3, extra: true })).toBe(false);
    // Window order and repeated assets are still checked on media items.
    expect(
      ok(ManifestV3Schema, {
        ...v3,
        assets: [
          appItem(),
          asset({ availableFrom: '2026-12-02T09:00', availableUntil: '2026-12-01T09:00' }),
        ],
      }),
    ).toBe(false);
    // v2 is frozen: a released 0.2.0 player must refuse an app item rather than misread it.
    expect(ok(ManifestV2Schema, { ...v3, schemaVersion: 2 })).toBe(false);
  });

  it('takes a playlist item as media or as an app, never a mix', () => {
    expect(ok(PlaylistItemInputSchema, { mediaId: U(1), durationMs: null, fit: null })).toBe(true);
    expect(ok(PlaylistItemInputSchema, { appId: U(60), durationMs: 5000 })).toBe(true);
    expect(ok(PlaylistItemInputSchema, { appId: U(60), durationMs: 5000, fit: null })).toBe(false);
    expect(ok(PlaylistItemInputSchema, { appId: U(60), durationMs: null })).toBe(false);
    expect(ok(PlaylistItemInputSchema, { appId: U(60) })).toBe(false);
    expect(
      ok(PlaylistItemInputSchema, { mediaId: U(1), appId: U(60), durationMs: 5000, fit: null }),
    ).toBe(false);
  });
});

describe('time rules', () => {
  it('accepts only real wall-clock date-times from year 1000', () => {
    for (const v of ['2026-11-14T09:30', '1000-01-01T00:00', '2028-02-29T23:59'])
      expect(LocalDateTimeSchema.safeParse(v).success, v).toBe(true);
    for (const v of [
      '0000-01-01T00:00',
      '0999-12-31T23:59',
      '2026-02-30T09:00',
      '2026-02-29T09:00',
      '2026-13-01T09:00',
      '2026-11-14T24:00',
      '2026-11-14T09:60',
      '2026-11-14T09:30:00',
      '2026-11-14T09:30Z',
      '2026-11-14 09:30',
    ])
      expect(LocalDateTimeSchema.safeParse(v).success, v).toBe(false);
  });

  it('accepts seven days with at least one open, each ending after it starts', () => {
    const open = { start: '09:00', end: '24:00' };
    expect(WorkingHoursSchema.safeParse([open, null, null, null, null, null, null]).success).toBe(
      true,
    );
    for (const bad of [
      [null, null, null, null, null, null, null],
      [open, null, null, null, null, null],
      [open, null, null, null, null, null, null, null],
      [{ start: '17:00', end: '09:00' }, null, null, null, null, null, null],
      [{ start: '09:00', end: '09:00' }, null, null, null, null, null, null],
      [{ start: '09:00', end: '24:01' }, null, null, null, null, null, null],
      [{ start: '9:00', end: '17:00' }, null, null, null, null, null, null],
      [{ start: '09:00', end: '17:00', note: 'x' }, null, null, null, null, null, null],
    ])
      expect(WorkingHoursSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('patches a media availability window with both sides together, in order', () => {
    expect(
      MediaPatchSchema.parse({ availableFrom: '2026-12-01T09:00', availableUntil: null }),
    ).toEqual({ availableFrom: '2026-12-01T09:00', availableUntil: null });
    expect(ok(MediaPatchSchema, { availableFrom: null, availableUntil: null })).toBe(true);
    for (const bad of [
      { availableFrom: '2026-12-01T09:00' },
      { availableUntil: null },
      { availableFrom: '2026-12-01T09:00', availableUntil: '2026-12-01T09:00' },
      { availableFrom: '2026-12-02T09:00', availableUntil: '2026-12-01T09:00' },
    ])
      expect(ok(MediaPatchSchema, bad), JSON.stringify(bad)).toBe(false);
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
