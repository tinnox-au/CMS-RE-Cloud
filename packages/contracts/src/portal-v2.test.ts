/** Contract tests for the shapes added with portal v2, stage A (docs/portal-v2/stage-a.md section 2). */
import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE,
  API_ERROR_CODES,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  ApiErrorSchema,
  AuditListQuerySchema,
  DEFAULT_TAG_COLOUR,
  DELIVERY_SUMMARIES,
  DeliveryStatusListResponseSchema,
  DescriptionInputSchema,
  DisplayDtoSchema,
  DisplayPatchSchema,
  FolderCreateSchema,
  FolderDtoSchema,
  FolderIdSchema,
  FolderListResponseSchema,
  FolderNameSchema,
  FolderPatchSchema,
  IdParamSchema,
  MEDIA_KINDS,
  MediaDtoSchema,
  MediaPatchSchema,
  MediaUsageResponseSchema,
  NameSchema,
  OverviewResponseSchema,
  PLAYLIST_PREVIEW_COUNT,
  PUSH_OUTCOMES,
  PUSH_PENDING_STATES,
  PUSH_STATES,
  PlaylistDtoSchema,
  PlaylistDuplicateResponseSchema,
  PlaylistReplaceSchema,
  PlaylistSummaryDtoSchema,
  PushPlanResponseSchema,
  PushPlanRowSchema,
  PushRequestSchema,
  PushResponseSchema,
  PushResultSchema,
  ROUTES,
  TAG_COLOURS,
  TAG_SCOPES,
  TagCreateSchema,
  TagDtoSchema,
  TagIdSchema,
  TagIdsInputSchema,
  TagListQuerySchema,
  TagListResponseSchema,
  TagNameSchema,
  TagPatchSchema,
  apiError,
  auditCategoryOf,
  duplicatePlaylistName,
  isPushPending,
} from './index.ts';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-11-15T00:00:00.000Z';
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;
const without = (value: Record<string, unknown>, key: string): Record<string, unknown> => {
  const { [key]: _removed, ...rest } = value;
  return rest;
};

const mediaDto = (o: Record<string, unknown> = {}) => ({
  id: U(1),
  kind: 'image',
  status: 'ready',
  name: 'Lobby poster',
  originalName: 'poster-final.png',
  description: null,
  defaultDurationMs: null,
  availableFrom: null,
  availableUntil: null,
  folderId: null,
  tagIds: [],
  usageCount: 0,
  mimeType: 'image/png',
  bytes: 10,
  sha256: 'ab'.repeat(32),
  width: 4,
  height: 4,
  durationMs: null,
  codec: null,
  errorCode: null,
  errorDetail: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
});

const displayDto = (o: Record<string, unknown> = {}) => ({
  id: U(3),
  siteId: U(9),
  name: 'Foyer wall',
  description: null,
  canvas: { width: 768, height: 448 },
  contentRect: null,
  defaultFit: 'contain',
  rotation: 0,
  workingHours: null,
  route: 'browser',
  player: null,
  tagIds: [],
  assignedPlaylist: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
});

const statusView = (o: Record<string, unknown> = {}) => ({
  displayId: U(3),
  paired: false,
  registrationId: null,
  desired: null,
  downloaded: null,
  active: null,
  playerState: null,
  staging: null,
  lastHeartbeatAt: null,
  stale: true,
  staleAfterSeconds: 60,
  errors: [],
  summary: 'unpaired',
  asOf: NOW,
  ...o,
});

const issue = { path: 'playlist', message: 'The playlist has no items.', code: 'playlist_empty' };

describe('shared text rules', () => {
  it('keeps the name rules and messages of M0', () => {
    expect(NameSchema.parse('  Foyer wall  ')).toBe('Foyer wall');
    const blank = NameSchema.safeParse('   ');
    expect(blank.success).toBe(false);
    if (!blank.success) expect(blank.error.issues[0]?.message).toBe('name is required');
    const control = NameSchema.safeParse('bad\u0007name');
    expect(control.success).toBe(false);
    if (!control.success)
      expect(control.error.issues[0]?.message).toBe('name must not contain control characters');
    expect(ok(NameSchema, 'x'.repeat(ABSOLUTE.maxNameLength))).toBe(true);
    expect(ok(NameSchema, 'x'.repeat(ABSOLUTE.maxNameLength + 1))).toBe(false);
  });

  it('refuses C1 controls, line separators and text-direction controls in names and descriptions', () => {
    const spoof = NameSchema.safeParse('report\u202Egpj.exe');
    expect(spoof.success).toBe(false);
    if (!spoof.success)
      expect(spoof.error.issues[0]?.message).toBe(
        'name must not contain text-direction characters',
      );
    for (const bad of ['a\u0085b', 'a\u009fb', 'a\u2028b', 'a\u2029b']) {
      expect(ok(NameSchema, bad), JSON.stringify(bad)).toBe(false);
      expect(ok(TagNameSchema, bad), JSON.stringify(bad)).toBe(false);
      expect(ok(FolderNameSchema, bad), JSON.stringify(bad)).toBe(false);
      expect(ok(DescriptionInputSchema, bad), JSON.stringify(bad)).toBe(false);
    }
    for (const bad of [
      '\u061c',
      '\u200e',
      '\u200f',
      '\u202a',
      '\u202d',
      '\u202e',
      '\u2066',
      '\u2069',
    ]) {
      const text = `ZZ ${bad}name`;
      expect(ok(NameSchema, text), JSON.stringify(text)).toBe(false);
      expect(ok(TagNameSchema, text), JSON.stringify(text)).toBe(false);
      expect(ok(FolderNameSchema, text), JSON.stringify(text)).toBe(false);
      expect(ok(MediaPatchSchema, { name: text }), JSON.stringify(text)).toBe(false);
      expect(ok(DescriptionInputSchema, text), JSON.stringify(text)).toBe(false);
    }
    // What people really type stays allowed: other scripts, emoji with joiners, line feeds in
    // a description, and a clearable name sent blank.
    for (const good of [
      'Café Ünïcode',
      'لوحة الاستقبال',
      'שלט ראשי',
      '👩\u200d💻 desk',
      'a\u200cb',
    ]) {
      expect(ok(NameSchema, good), good).toBe(true);
      expect(ok(TagNameSchema, good), good).toBe(true);
    }
    expect(ok(DescriptionInputSchema, 'line one\nline two')).toBe(true);
    expect(MediaPatchSchema.parse({ name: '  ' })).toEqual({ name: null });
  });

  it('bounds a description, allows line feeds only, and reads an empty one as cleared', () => {
    expect(DescriptionInputSchema.parse('  Two lines\nof text  ')).toBe('Two lines\nof text');
    expect(DescriptionInputSchema.parse('')).toBeNull();
    expect(DescriptionInputSchema.parse('   \n ')).toBeNull();
    expect(DescriptionInputSchema.parse(null)).toBeNull();
    expect(ok(DescriptionInputSchema, 'x'.repeat(ABSOLUTE.maxDescriptionLength))).toBe(true);
    expect(ok(DescriptionInputSchema, 'x'.repeat(ABSOLUTE.maxDescriptionLength + 1))).toBe(false);
    // Surrounding white space does not count towards the limit.
    expect(ok(DescriptionInputSchema, ` ${'x'.repeat(ABSOLUTE.maxDescriptionLength)} `)).toBe(true);
    for (const bad of [
      'tab\there',
      'carriage\r\nreturn',
      'nul\u0000',
      'escape\u001b[0m',
      'del\u007f',
    ])
      expect(ok(DescriptionInputSchema, bad), JSON.stringify(bad)).toBe(false);
    for (const bad of [5, {}, ['x'], undefined])
      expect(ok(DescriptionInputSchema, bad)).toBe(false);
  });
});

describe('tags', () => {
  it('lists the scopes and colours of the build spec', () => {
    expect(TAG_SCOPES).toEqual(['media', 'display']);
    expect(TAG_COLOURS).toEqual([
      'teal',
      'sky',
      'slate',
      'green',
      'amber',
      'red',
      'violet',
      'pink',
    ]);
    expect(DEFAULT_TAG_COLOUR).toBe('teal');
    expect(ABSOLUTE.maxTagNameLength).toBe(40);
  });

  it('creates a tag with a trimmed name and the default colour', () => {
    expect(TagCreateSchema.parse({ scope: 'media', name: '  Summer sale ' })).toEqual({
      scope: 'media',
      name: 'Summer sale',
      colour: 'teal',
    });
    expect(TagCreateSchema.parse({ scope: 'display', name: 'Level 2', colour: 'pink' })).toEqual({
      scope: 'display',
      name: 'Level 2',
      colour: 'pink',
    });
  });

  it('refuses a tag that is out of bounds or carries unknown content', () => {
    const base = { scope: 'media', name: 'Summer sale' };
    const bad = [
      { name: 'Summer sale' },
      { scope: 'media' },
      { ...base, name: '' },
      { ...base, name: '   ' },
      { ...base, name: 'x'.repeat(41) },
      { ...base, name: 'two\nlines' },
      { ...base, name: 7 },
      { ...base, scope: 'playlist' },
      { ...base, colour: 'magenta' },
      { ...base, colour: '#0f4761' },
      { ...base, orgId: U(1) },
      { ...base, id: U(1) },
    ];
    bad.forEach((b, i) => expect(ok(TagCreateSchema, b), `case ${i}`).toBe(false));
    expect(ok(TagCreateSchema, { ...base, name: 'x'.repeat(40) })).toBe(true);
  });

  it('patches the name or the colour, never the scope, and never nothing', () => {
    expect(TagPatchSchema.parse({ name: ' Autumn ' })).toEqual({ name: 'Autumn' });
    expect(TagPatchSchema.parse({ colour: 'amber' })).toEqual({ colour: 'amber' });
    expect(ok(TagPatchSchema, { name: 'Autumn', colour: 'red' })).toBe(true);
    for (const bad of [
      {},
      { scope: 'display' },
      { name: '' },
      { colour: 'gold' },
      { usageCount: 3 },
    ])
      expect(ok(TagPatchSchema, bad), JSON.stringify(bad)).toBe(false);
  });

  it('describes a tag strictly and bounds the list query', () => {
    const dto = { id: U(20), scope: 'media', name: 'Summer sale', colour: 'teal', usageCount: 2 };
    expect(ok(TagDtoSchema, dto)).toBe(true);
    expect(ok(TagListResponseSchema, { items: [dto] })).toBe(true);
    for (const bad of [
      { ...dto, usageCount: -1 },
      { ...dto, usageCount: 1.5 },
      { ...dto, usageCount: null },
      { ...dto, name: '' },
      { ...dto, orgId: U(1) },
      { ...dto, colour: 'blue' },
    ])
      expect(ok(TagDtoSchema, bad), JSON.stringify(bad)).toBe(false);
    expect(TagListQuerySchema.parse({})).toEqual({});
    expect(TagListQuerySchema.parse({ scope: 'display' })).toEqual({ scope: 'display' });
    expect(ok(TagListQuerySchema, { scope: 'all' })).toBe(false);
    expect(ok(TagListQuerySchema, { scope: 'media', orgId: U(1) })).toBe(false);
  });

  it('bounds a tag set and refuses repeats, whatever the letter case', () => {
    expect(ok(TagIdsInputSchema, [])).toBe(true);
    expect(ok(TagIdsInputSchema, [U(1), U(2)])).toBe(true);
    const full = Array.from({ length: ABSOLUTE.maxTagsPerItem }, (_, i) => U(i + 1));
    expect(ok(TagIdsInputSchema, full)).toBe(true);
    expect(ok(TagIdsInputSchema, [...full, U(999)])).toBe(false);
    expect(ok(TagIdsInputSchema, [U(1), U(1)])).toBe(false);
    const lower = '00000000-0000-4000-8000-00000000000a';
    expect(ok(TagIdsInputSchema, [lower, lower.toUpperCase()])).toBe(false);
    expect(ok(TagIdsInputSchema, ['summer-sale'])).toBe(false);
    expect(ok(TagIdSchema, U(1))).toBe(true);
    expect(ok(FolderIdSchema, 'folder-1')).toBe(false);
  });
});

describe('folders', () => {
  it('bounds the name on create and rename', () => {
    expect(FolderCreateSchema.parse({ name: '  Campaigns 2026 ' })).toEqual({
      name: 'Campaigns 2026',
    });
    expect(ok(FolderCreateSchema, { name: 'x'.repeat(ABSOLUTE.maxFolderNameLength) })).toBe(true);
    expect(ABSOLUTE.maxFolderNameLength).toBe(80);
    for (const schema of [FolderCreateSchema, FolderPatchSchema]) {
      for (const bad of [
        {},
        { name: '' },
        { name: ' ' },
        { name: 'x'.repeat(81) },
        { name: 'a\u0000b' },
        { name: 'ok', parentId: U(1) },
        { name: 'ok', orgId: U(1) },
      ])
        expect(ok(schema, bad), JSON.stringify(bad)).toBe(false);
    }
    expect(FolderPatchSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('describes a folder strictly', () => {
    const dto = { id: U(30), name: 'Campaigns', itemCount: 12 };
    expect(ok(FolderDtoSchema, dto)).toBe(true);
    expect(
      ok(FolderListResponseSchema, { items: [dto, { ...dto, id: U(31), itemCount: 0 }] }),
    ).toBe(true);
    expect(ok(FolderDtoSchema, { ...dto, itemCount: -1 })).toBe(false);
    expect(ok(FolderDtoSchema, { ...dto, orgId: U(1) })).toBe(false);
    expect(ok(FolderDtoSchema, { id: U(30), name: 'Campaigns' })).toBe(false);
  });
});

describe('media', () => {
  it('requires the stage A fields in a media record', () => {
    expect(ok(MediaDtoSchema, mediaDto())).toBe(true);
    expect(
      ok(
        MediaDtoSchema,
        mediaDto({
          description: 'Shown in the lobby.',
          defaultDurationMs: 8000,
          folderId: U(30),
          tagIds: [U(20), U(21)],
          usageCount: 3,
        }),
      ),
    ).toBe(true);
    for (const field of [
      'name',
      'description',
      'defaultDurationMs',
      'folderId',
      'tagIds',
      'usageCount',
    ]) {
      expect(ok(MediaDtoSchema, without(mediaDto(), field)), field).toBe(false);
    }
  });

  it('never accepts an empty shown name, an empty description or unbounded values', () => {
    const bad = [
      mediaDto({ name: '' }),
      mediaDto({ name: null }),
      mediaDto({ name: 'x'.repeat(ABSOLUTE.maxOriginalNameLength + 1) }),
      mediaDto({ description: '' }),
      mediaDto({ description: 'x'.repeat(501) }),
      mediaDto({ defaultDurationMs: 0 }),
      mediaDto({ defaultDurationMs: ABSOLUTE.maxItemDurationMs + 1 }),
      mediaDto({ folderId: 'root' }),
      mediaDto({ tagIds: null }),
      mediaDto({ tagIds: Array.from({ length: ABSOLUTE.maxTagsPerItem + 1 }, (_, i) => U(i)) }),
      mediaDto({ usageCount: -1 }),
      mediaDto({ storageKey: 'org/object' }),
    ];
    bad.forEach((b, i) => expect(ok(MediaDtoSchema, b), `case ${i}`).toBe(false));
  });

  it('patches any subset of the editable fields, and at least one', () => {
    expect(MediaPatchSchema.parse({ name: '  Lobby poster ' })).toEqual({ name: 'Lobby poster' });
    expect(MediaPatchSchema.parse({ description: 'Line one\nLine two' })).toEqual({
      description: 'Line one\nLine two',
    });
    expect(MediaPatchSchema.parse({ defaultDurationMs: 8000 })).toEqual({
      defaultDurationMs: 8000,
    });
    expect(MediaPatchSchema.parse({ folderId: U(30) })).toEqual({ folderId: U(30) });
    expect(MediaPatchSchema.parse({ tagIds: [U(20)] })).toEqual({ tagIds: [U(20)] });
    expect(
      ok(MediaPatchSchema, {
        name: 'Lobby poster',
        description: 'x',
        defaultDurationMs: 1,
        folderId: U(30),
        tagIds: [],
      }),
    ).toBe(true);
    expect(ok(MediaPatchSchema, {})).toBe(false);
  });

  it('clears a field with null, and a name or description with an empty string', () => {
    expect(
      MediaPatchSchema.parse({
        name: null,
        description: null,
        defaultDurationMs: null,
        folderId: null,
      }),
    ).toEqual({ name: null, description: null, defaultDurationMs: null, folderId: null });
    expect(MediaPatchSchema.parse({ name: '', description: '   ' })).toEqual({
      name: null,
      description: null,
    });
  });

  it('refuses values out of bounds and fields an operator must not set', () => {
    const bad = [
      { name: 'x'.repeat(ABSOLUTE.maxNameLength + 1) },
      { name: 'two\nlines' },
      { name: 5 },
      { description: 'x'.repeat(501) },
      { description: 'bell\u0007' },
      { defaultDurationMs: 0 },
      { defaultDurationMs: -1000 },
      { defaultDurationMs: 1500.5 },
      { defaultDurationMs: '8000' },
      { defaultDurationMs: ABSOLUTE.maxItemDurationMs + 1 },
      { folderId: '' },
      { folderId: 'not-a-uuid' },
      { tagIds: [U(1), U(1)] },
      { tagIds: ['x'] },
      { tagIds: U(1) },
      { tagIds: null },
      { name: 'ok', originalName: 'evil.png' },
      { name: 'ok', status: 'ready' },
      { name: 'ok', orgId: U(1) },
      { name: 'ok', storageKey: 'a/b' },
      { name: 'ok', usageCount: 0 },
    ];
    bad.forEach((b, i) => expect(ok(MediaPatchSchema, b), `case ${i}`).toBe(false));
    expect(ok(MediaPatchSchema, { defaultDurationMs: ABSOLUTE.maxItemDurationMs })).toBe(true);
  });

  it('describes where a media item is used', () => {
    expect(ok(MediaUsageResponseSchema, { playlists: [], displays: [] })).toBe(true);
    expect(
      ok(MediaUsageResponseSchema, {
        playlists: [{ id: U(40), name: 'Reception loop' }],
        displays: [{ id: U(3), name: 'Foyer wall' }],
      }),
    ).toBe(true);
    for (const bad of [
      { playlists: [] },
      { playlists: [{ id: U(40) }], displays: [] },
      { playlists: [{ id: U(40), name: '' }], displays: [] },
      { playlists: [{ id: U(40), name: 'x', itemCount: 2 }], displays: [] },
      { playlists: [], displays: [{ id: 'x', name: 'Foyer wall' }] },
      { playlists: [], displays: [], publications: [] },
    ])
      expect(ok(MediaUsageResponseSchema, bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('playlists', () => {
  const summary = (o: Record<string, unknown> = {}) => ({
    id: U(40),
    name: 'Reception loop',
    description: null,
    itemCount: 3,
    totalDurationMs: 25_500,
    kinds: ['image', 'video'],
    previewMediaIds: [U(1), U(2)],
    assignedDisplayCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  });

  it('requires and bounds the summary additions', () => {
    expect(ok(PlaylistSummaryDtoSchema, summary())).toBe(true);
    expect(
      ok(
        PlaylistSummaryDtoSchema,
        summary({
          description: 'Front desk',
          itemCount: 0,
          totalDurationMs: 0,
          kinds: [],
          previewMediaIds: [],
          assignedDisplayCount: 0,
        }),
      ),
    ).toBe(true);
    expect(PLAYLIST_PREVIEW_COUNT).toBe(4);
    for (const field of [
      'description',
      'totalDurationMs',
      'kinds',
      'previewMediaIds',
      'assignedDisplayCount',
    ]) {
      expect(ok(PlaylistSummaryDtoSchema, without(summary(), field)), field).toBe(false);
    }
    const bad = [
      summary({ description: '' }),
      summary({ totalDurationMs: -1 }),
      summary({ totalDurationMs: 1.5 }),
      summary({ totalDurationMs: ABSOLUTE.maxPlaylistItems * ABSOLUTE.maxItemDurationMs + 1 }),
      summary({ kinds: ['image', 'video', 'app', 'image'] }),
      summary({ kinds: ['audio'] }),
      summary({ previewMediaIds: [U(1), U(2), U(3), U(4), U(5)] }),
      summary({ previewMediaIds: ['https://example.invalid/a.png'] }),
      summary({ assignedDisplayCount: -1 }),
      summary({ deletedAt: NOW }),
    ];
    bad.forEach((b, i) => expect(ok(PlaylistSummaryDtoSchema, b), `case ${i}`).toBe(false));
    expect(MEDIA_KINDS).toHaveLength(2);
    expect(ok(PlaylistSummaryDtoSchema, summary({ kinds: ['image', 'video', 'app'] }))).toBe(true);
  });

  it('carries the description in the full playlist', () => {
    const dto = {
      id: U(40),
      name: 'Reception loop',
      description: 'Front desk',
      items: [
        { id: U(50), position: 0, mediaId: U(1), durationMs: 5000, fit: null, media: mediaDto() },
      ],
      transition: 'cut',
      shuffle: false,
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(ok(PlaylistDtoSchema, dto)).toBe(true);
    expect(ok(PlaylistDtoSchema, { ...dto, description: null })).toBe(true);
    // A duplicate answers with the full playlist.
    expect(ok(PlaylistDuplicateResponseSchema, dto)).toBe(true);
    const { description: _removed, ...without } = dto;
    expect(ok(PlaylistDtoSchema, without)).toBe(false);
    // An app item carries the current app record, and no fit.
    const app = {
      id: U(60),
      name: 'Lobby clock',
      description: null,
      content: {
        type: 'clock',
        settings: {
          hourCycle: '12',
          showSeconds: false,
          textColour: '#ffffff',
          backgroundColour: '#000000',
        },
      },
      usageCount: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const appItem = { id: U(51), position: 1, appId: U(60), durationMs: 10_000, app };
    expect(ok(PlaylistDtoSchema, { ...dto, items: [...dto.items, appItem] })).toBe(true);
    expect(ok(PlaylistDtoSchema, { ...dto, items: [{ ...appItem, fit: null }] })).toBe(false);
    expect(ok(PlaylistDtoSchema, { ...dto, items: [{ ...appItem, durationMs: null }] })).toBe(
      false,
    );
    // An item must carry a complete media record, stage A fields included.
    const { usageCount: _gone, ...oldMedia } = mediaDto();
    expect(ok(PlaylistDtoSchema, { ...dto, items: [{ ...dto.items[0], media: oldMedia }] })).toBe(
      false,
    );
  });

  it('accepts a replace with or without a description', () => {
    const item = { mediaId: U(1), durationMs: 5000, fit: null };
    // M0 clients send no description: it parses, and the field stays absent.
    expect(PlaylistReplaceSchema.parse({ name: 'Loop', items: [item] })).toEqual({
      name: 'Loop',
      items: [item],
    });
    expect(
      PlaylistReplaceSchema.parse({ name: 'Loop', description: ' Front desk ', items: [] }),
    ).toEqual({ name: 'Loop', description: 'Front desk', items: [] });
    expect(PlaylistReplaceSchema.parse({ name: 'Loop', description: '', items: [] })).toEqual({
      name: 'Loop',
      description: null,
      items: [],
    });
    expect(PlaylistReplaceSchema.parse({ name: 'Loop', description: null, items: [] })).toEqual({
      name: 'Loop',
      description: null,
      items: [],
    });
    expect(
      ok(PlaylistReplaceSchema, { name: 'Loop', description: 'x'.repeat(501), items: [] }),
    ).toBe(false);
    expect(ok(PlaylistReplaceSchema, { name: 'Loop', items: [], deletedAt: NOW })).toBe(false);
  });

  it('names a copy within the name limit without splitting a character', () => {
    expect(duplicatePlaylistName('Reception loop')).toBe('Copy of Reception loop');
    expect(duplicatePlaylistName('  Reception loop  ')).toBe('Copy of Reception loop');
    const long = duplicatePlaylistName('x'.repeat(ABSOLUTE.maxNameLength));
    expect(long).toHaveLength(ABSOLUTE.maxNameLength);
    expect(long.startsWith('Copy of xxx')).toBe(true);
    // The cut never leaves trailing white space: the result is a valid name as it stands.
    const spaced = duplicatePlaylistName(`${'x'.repeat(ABSOLUTE.maxNameLength - 9)} tail`);
    expect(spaced).toBe(`Copy of ${'x'.repeat(ABSOLUTE.maxNameLength - 9)}`);
    expect(NameSchema.parse(spaced)).toBe(spaced);
    // An emoji is two UTF-16 units; a cut in the middle would leave half a character.
    const emoji = duplicatePlaylistName(`${'x'.repeat(ABSOLUTE.maxNameLength - 9)}\u{1F600}`);
    expect(emoji).toBe(`Copy of ${'x'.repeat(ABSOLUTE.maxNameLength - 9)}`);
    expect(emoji.length).toBeLessThanOrEqual(ABSOLUTE.maxNameLength);
    expect(duplicatePlaylistName(`${'x'.repeat(ABSOLUTE.maxNameLength - 10)}\u{1F600}`)).toBe(
      `Copy of ${'x'.repeat(ABSOLUTE.maxNameLength - 10)}\u{1F600}`,
    );
    for (const name of ['a', 'Copy of Copy of a', 'x'.repeat(200)])
      expect(ok(NameSchema, duplicatePlaylistName(name)), name).toBe(true);
  });
});

describe('displays', () => {
  it('requires the stage A fields in a display record', () => {
    expect(ok(DisplayDtoSchema, displayDto())).toBe(true);
    expect(
      ok(
        DisplayDtoSchema,
        displayDto({
          description: 'Behind the front desk.',
          tagIds: [U(22)],
          assignedPlaylist: { id: U(40), name: 'Reception loop' },
        }),
      ),
    ).toBe(true);
    for (const field of ['description', 'tagIds', 'assignedPlaylist']) {
      expect(ok(DisplayDtoSchema, without(displayDto(), field)), field).toBe(false);
    }
    const bad = [
      displayDto({ description: '' }),
      displayDto({ assignedPlaylist: U(40) }),
      displayDto({ assignedPlaylist: { id: U(40) } }),
      displayDto({ assignedPlaylist: { id: U(40), name: 'Loop', items: [] } }),
      displayDto({ assignedPlaylistId: U(40) }),
      displayDto({ online: true }),
    ];
    bad.forEach((b, i) => expect(ok(DisplayDtoSchema, b), `case ${i}`).toBe(false));
  });

  it('patches the description, the tags and the assigned playlist', () => {
    expect(DisplayPatchSchema.parse({ description: ' Behind the desk ' })).toEqual({
      description: 'Behind the desk',
    });
    expect(DisplayPatchSchema.parse({ description: '' })).toEqual({ description: null });
    expect(DisplayPatchSchema.parse({ tagIds: [U(22), U(23)] })).toEqual({
      tagIds: [U(22), U(23)],
    });
    expect(DisplayPatchSchema.parse({ assignedPlaylistId: U(40) })).toEqual({
      assignedPlaylistId: U(40),
    });
    expect(DisplayPatchSchema.parse({ assignedPlaylistId: null })).toEqual({
      assignedPlaylistId: null,
    });
    // The M0 fields still work on their own and together with the new ones.
    expect(ok(DisplayPatchSchema, { name: 'Foyer wall', defaultFit: 'cover' })).toBe(true);
    expect(ok(DisplayPatchSchema, { name: 'Foyer wall', assignedPlaylistId: U(40) })).toBe(true);
    for (const bad of [
      {},
      { description: 'x'.repeat(501) },
      { tagIds: [U(22), U(22)] },
      { assignedPlaylistId: 'none' },
      { assignedPlaylist: { id: U(40), name: 'Loop' } },
      { siteId: U(9) },
      { route: 'browser' },
      { orgId: U(1) },
    ])
      expect(ok(DisplayPatchSchema, bad), JSON.stringify(bad)).toBe(false);
  });

  it('lists the status of every display', () => {
    expect(ok(DeliveryStatusListResponseSchema, { items: [] })).toBe(true);
    expect(
      ok(DeliveryStatusListResponseSchema, {
        items: [statusView(), statusView({ displayId: U(4) })],
      }),
    ).toBe(true);
    expect(ok(DeliveryStatusListResponseSchema, { items: [statusView({ online: true })] })).toBe(
      false,
    );
    expect(
      ok(DeliveryStatusListResponseSchema, { items: [statusView({ summary: 'online' })] }),
    ).toBe(false);
    expect(ok(DeliveryStatusListResponseSchema, { items: [], total: 0 })).toBe(false);
  });
});

describe('push to displays', () => {
  const display = { id: U(3), name: 'Foyer wall' };
  const playlist = { id: U(40), name: 'Reception loop' };
  const row = (o: Record<string, unknown> = {}) => ({
    display,
    playlist,
    state: 'changes',
    issues: [],
    lastPushedAt: NOW,
    ...o,
  });

  it('lists the states and which of them are pending', () => {
    expect(PUSH_STATES).toEqual([
      'nothing_assigned',
      'never_pushed',
      'changes',
      'up_to_date',
      'blocked',
    ]);
    expect(PUSH_PENDING_STATES).toEqual(['never_pushed', 'changes']);
    expect(PUSH_STATES.filter(isPushPending)).toEqual(['never_pushed', 'changes']);
    expect(PUSH_OUTCOMES).toEqual(['published', 'unchanged', 'rejected', 'skipped']);
  });

  it('accepts one well-formed row for every state', () => {
    const rows = [
      row({ state: 'nothing_assigned', playlist: null, lastPushedAt: null }),
      row({ state: 'nothing_assigned', playlist: null }),
      row({ state: 'never_pushed', lastPushedAt: null }),
      row({ state: 'changes' }),
      row({ state: 'up_to_date' }),
      row({ state: 'blocked', issues: [issue] }),
      row({
        state: 'blocked',
        lastPushedAt: null,
        issues: [issue, { path: 'items[2]', message: 'Item 3 failed.', code: 'media_failed' }],
      }),
    ];
    rows.forEach((r, i) => expect(ok(PushPlanRowSchema, r), `case ${i}`).toBe(true));
  });

  it('refuses a row that contradicts itself', () => {
    const bad = [
      row({ state: 'nothing_assigned' }),
      row({ state: 'changes', playlist: null }),
      row({ state: 'blocked' }),
      row({ state: 'up_to_date', issues: [issue] }),
      row({ state: 'never_pushed' }),
      row({ state: 'changes', lastPushedAt: null }),
      row({ state: 'up_to_date', lastPushedAt: null }),
      row({ state: 'pending' }),
      row({ issues: [{ ...issue, code: 'made_up' }], state: 'blocked' }),
      row({ issues: [{ path: 'playlist', message: 'x' }], state: 'blocked' }),
      row({ issues: Array.from({ length: 101 }, () => issue), state: 'blocked' }),
      row({ display: { id: U(3) } }),
      row({ manifest: {} }),
    ];
    bad.forEach((b, i) => expect(ok(PushPlanRowSchema, b), `case ${i}`).toBe(false));
  });

  it('checks the pending count against the rows', () => {
    const items = [
      row({ state: 'changes' }),
      row({ state: 'never_pushed', lastPushedAt: null }),
      row({ state: 'up_to_date' }),
      row({ state: 'blocked', issues: [issue] }),
      row({ state: 'nothing_assigned', playlist: null, lastPushedAt: null }),
    ];
    expect(ok(PushPlanResponseSchema, { items, pendingCount: 2 })).toBe(true);
    expect(ok(PushPlanResponseSchema, { items: [], pendingCount: 0 })).toBe(true);
    expect(ok(PushPlanResponseSchema, { items, pendingCount: 3 })).toBe(false);
    expect(ok(PushPlanResponseSchema, { items, pendingCount: 0 })).toBe(false);
    expect(ok(PushPlanResponseSchema, { items })).toBe(false);
    expect(ok(PushPlanResponseSchema, { items, pendingCount: 2, generatedAt: NOW })).toBe(false);
  });

  it('bounds a push request to 1 to 200 distinct displays', () => {
    expect(ABSOLUTE.maxPushDisplays).toBe(200);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => U(i + 1));
    expect(ok(PushRequestSchema, { displayIds: ids(1) })).toBe(true);
    expect(ok(PushRequestSchema, { displayIds: ids(200) })).toBe(true);
    for (const bad of [
      {},
      { displayIds: [] },
      { displayIds: ids(201) },
      { displayIds: [U(1), U(1)] },
      { displayIds: ['all'] },
      { displayIds: U(1) },
      { displayIds: ids(1), playlistId: U(40) },
      { displayIds: ids(1), orgId: U(1) },
      { displayIds: ids(1), force: true },
    ])
      expect(ok(PushRequestSchema, bad), JSON.stringify(bad).slice(0, 80)).toBe(false);
  });

  it('ties the publication and the issues of a result to its outcome', () => {
    const result = (o: Record<string, unknown>) => ({
      displayId: U(3),
      outcome: 'published',
      publicationId: U(60),
      issues: [],
      ...o,
    });
    const good = [
      result({}),
      result({ outcome: 'unchanged' }),
      result({ outcome: 'rejected', publicationId: null, issues: [issue] }),
      result({ outcome: 'skipped', publicationId: null }),
    ];
    good.forEach((r, i) => expect(ok(PushResultSchema, r), `good ${i}`).toBe(true));
    expect(ok(PushResponseSchema, { results: good })).toBe(true);
    const bad = [
      result({ publicationId: null }),
      result({ outcome: 'unchanged', publicationId: null }),
      result({ outcome: 'rejected', issues: [issue] }),
      result({ outcome: 'rejected', publicationId: null }),
      result({ outcome: 'skipped' }),
      result({ outcome: 'skipped', publicationId: null, issues: [issue] }),
      result({ issues: [issue] }),
      result({ outcome: 'queued' }),
      result({ manifest: {} }),
    ];
    bad.forEach((r, i) => expect(ok(PushResultSchema, r), `bad ${i}`).toBe(false));
    expect(ok(PushResponseSchema, { results: [] })).toBe(false);
    expect(
      ok(PushResponseSchema, {
        results: Array.from({ length: 201 }, (_, i) => result({ displayId: U(i + 1) })),
      }),
    ).toBe(false);
  });
});

describe('overview', () => {
  const overview = (o: Record<string, unknown> = {}) => ({
    displays: {
      total: 4,
      paired: 3,
      bySummary: {
        unpaired: 1,
        nothing_published: 0,
        awaiting_player: 0,
        stale: 1,
        updating: 0,
        error: 0,
        standing_by: 0,
        in_sync: 2,
      },
    },
    media: {
      total: 5,
      ready: 3,
      processing: 1,
      failed: 1,
      usedBytes: 1024,
      limitBytes: 5_368_709_120,
    },
    playlists: { total: 2 },
    pendingPushCount: 1,
    ...o,
  });

  it('accepts the dashboard numbers and counts every delivery summary', () => {
    expect(ok(OverviewResponseSchema, overview())).toBe(true);
    const parsed = OverviewResponseSchema.parse(overview());
    expect(Object.keys(parsed.displays.bySummary).sort()).toEqual([...DELIVERY_SUMMARIES].sort());
  });

  it('refuses a missing or unknown counter and impossible numbers', () => {
    const base = overview();
    const { stale: _stale, ...withoutStale } = base.displays.bySummary;
    const bad = [
      overview({ displays: { ...base.displays, bySummary: withoutStale } }),
      overview({ displays: { ...base.displays, bySummary: { ...withoutStale, stale: -1 } } }),
      overview({
        displays: { ...base.displays, bySummary: { ...base.displays.bySummary, online: 3 } },
      }),
      overview({ displays: { total: 4, paired: 3 } }),
      overview({ media: { ...base.media, limitBytes: 0 } }),
      overview({ media: { ...base.media, usedBytes: -1 } }),
      overview({ media: { ...base.media, ready: 1.5 } }),
      overview({ playlists: {} }),
      overview({ playlists: { total: 2, deleted: 1 } }),
      overview({ pendingPushCount: null }),
      overview({ organisation: { id: U(1) } }),
    ];
    bad.forEach((b, i) => expect(ok(OverviewResponseSchema, b), `case ${i}`).toBe(false));
  });
});

describe('audit', () => {
  it('names the stage A actions, each in the form the database accepts', () => {
    for (const action of [
      'media.update',
      'tag.create',
      'tag.update',
      'tag.delete',
      'folder.create',
      'folder.update',
      'folder.delete',
      'playlist.delete',
    ])
      expect(AUDIT_ACTIONS, action).toContain(action);
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    // CHECK constraint on audit_event.action (db/migrations/0001_schema.sql).
    for (const action of AUDIT_ACTIONS) expect(action).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });

  it('derives the categories from the actions', () => {
    expect([...AUDIT_CATEGORIES].sort()).toEqual(
      [...new Set(AUDIT_ACTIONS.map(auditCategoryOf))].sort(),
    );
    expect(auditCategoryOf('publication.create')).toBe('publication');
    expect(auditCategoryOf('security.cross_org_denied')).toBe('security');
    expect(auditCategoryOf('a.b.c')).toBe('a');
    expect(auditCategoryOf('nodot')).toBe('nodot');
  });

  it('filters the list by category and result', () => {
    expect(AuditListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      AuditListQuerySchema.parse({
        limit: '20',
        before: '99',
        category: 'media',
        result: 'denied',
      }),
    ).toEqual({ limit: 20, before: '99', category: 'media', result: 'denied' });
    for (const category of AUDIT_CATEGORIES)
      expect(ok(AuditListQuerySchema, { category }), category).toBe(true);
    for (const bad of [
      { category: 'media.update' },
      { category: 'billing' },
      { category: '' },
      { category: "media' OR '1'='1" },
      { result: 'ok' },
      { result: '' },
      { action: 'media.update' },
      { orgId: U(1) },
    ])
      expect(ok(AuditListQuerySchema, bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('identifiers in addresses', () => {
  it('accepts a UUID in either letter case and parses it to lower case', () => {
    const lower = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    expect(IdParamSchema.parse({ id: lower })).toEqual({ id: lower });
    expect(IdParamSchema.parse({ id: lower.toUpperCase() })).toEqual({ id: lower });
    expect(IdParamSchema.parse({ id: 'A1b2C3d4-E5f6-4A7b-8C9d-0E1f2A3b4C5d' })).toEqual({
      id: lower,
    });
  });

  it('still refuses anything that is not exactly one UUID', () => {
    for (const bad of [
      {},
      { id: '' },
      { id: 'status' },
      { id: `${U(1)} ` },
      { id: U(1).replaceAll('-', '') },
      { id: U(1), other: U(2) },
      { id: [U(1)] },
      { id: null },
    ]) {
      expect(ok(IdParamSchema, bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('errors and routes', () => {
  it('has an error code for a playlist that is still assigned', () => {
    expect(API_ERROR_CODES).toContain('playlist_in_use');
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
    expect(
      ok(ApiErrorSchema, apiError('playlist_in_use', 'The playlist is assigned to 2 displays.')),
    ).toBe(true);
  });

  it('has the codes, audit actions and routes of built-in apps', () => {
    expect(API_ERROR_CODES).toContain('app_in_use');
    for (const action of ['app.create', 'app.update', 'app.delete'] as const) {
      expect(AUDIT_ACTIONS).toContain(action);
      expect(auditCategoryOf(action)).toBe('app');
    }
    expect(AUDIT_CATEGORIES).toContain('app');
    expect(ROUTES.apps).toBe('/api/apps');
    expect(ROUTES.appPattern).toBe('/api/apps/:id');
    expect(ROUTES.app('../x')).toBe('/api/apps/..%2Fx');
  });

  it('builds every stage A path and percent-encodes its parameter', () => {
    expect(ROUTES.displaysStatus).toBe('/api/displays/status');
    expect(ROUTES.mediaUsagePattern).toBe('/api/media/:id/usage');
    expect(ROUTES.mediaUsage(U(1))).toBe(`/api/media/${U(1)}/usage`);
    expect(ROUTES.tags).toBe('/api/tags');
    expect(ROUTES.tagPattern).toBe('/api/tags/:id');
    expect(ROUTES.tag(U(20))).toBe(`/api/tags/${U(20)}`);
    expect(ROUTES.folders).toBe('/api/folders');
    expect(ROUTES.folderPattern).toBe('/api/folders/:id');
    expect(ROUTES.folder(U(30))).toBe(`/api/folders/${U(30)}`);
    expect(ROUTES.playlistDuplicatePattern).toBe('/api/playlists/:id/duplicate');
    expect(ROUTES.playlistDuplicate(U(40))).toBe(`/api/playlists/${U(40)}/duplicate`);
    expect(ROUTES.push).toBe('/api/push');
    expect(ROUTES.overview).toBe('/api/overview');
    for (const build of [ROUTES.mediaUsage, ROUTES.tag, ROUTES.folder, ROUTES.playlistDuplicate]) {
      const path = build('../../x?y#z');
      expect(path).toContain('..%2F..%2Fx%3Fy%23z');
      expect(path).not.toContain('?');
    }
  });

  it('keeps every pattern and its builder in step', () => {
    const routes = ROUTES as unknown as Record<string, unknown>;
    const patterns = Object.keys(routes).filter((key) => key.endsWith('Pattern'));
    expect(patterns.length).toBeGreaterThan(10);
    for (const key of patterns) {
      const build = routes[key.slice(0, -'Pattern'.length)];
      expect(typeof build, key).toBe('function');
      const pattern = routes[key] as string;
      const built = (build as (id: string) => string)(U(7));
      expect(built, key).toBe(pattern.replace(/:[A-Za-z]+/, U(7)));
    }
  });
});
