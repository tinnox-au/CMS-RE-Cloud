import {
  DEFAULT_LIMITS,
  DELIVERY_SUMMARIES,
  type DeliveryStatusView,
  type MediaDto,
  type PlaylistDto,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  displayFormFromDto,
  EMPTY_DISPLAY_FORM,
  parsePixels,
  previewShape,
  toDisplayPatch,
  validateDisplayForm,
  type DisplayFormValues,
} from './displayForm.ts';
import { durationFieldText, parseImageDuration } from './duration.ts';
import { formatAge, formatBytes, formatDurationMs } from './format.ts';
import {
  appendApp,
  appendMedia,
  draftFromPlaylist,
  draftLoopMs,
  isDirty,
  itemRefId,
  moveItem,
  removeItem,
  updateItem,
  validateDraft,
} from './playlistDraft.ts';
import { presentStatus } from './status.ts';
import { newEntry, nextToStart, patchEntry, preflightMessage } from './uploadQueue.ts';

import { app } from './mediaLibrary.test-support.ts';

const ID = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const T = '2026-11-14T03:00:00.000Z';

/* ---------- canvas form ---------- */

function form(change: Partial<DisplayFormValues> = {}): DisplayFormValues {
  return { ...EMPTY_DISPLAY_FORM, name: 'Foyer wall', siteId: ID(1), ...change };
}

describe('display form validation', () => {
  it('accepts a plain landscape canvas and applies schema defaults', () => {
    const result = validateDisplayForm(form(), DEFAULT_LIMITS);
    expect(result).toEqual({
      ok: true,
      value: {
        siteId: ID(1),
        name: 'Foyer wall',
        canvas: { width: 1920, height: 1080 },
        contentRect: null,
        defaultFit: 'contain',
      },
    });
  });

  it('accepts portrait and an unusual LED-shaped canvas', () => {
    expect(validateDisplayForm(form({ width: '1080', height: '1920' }), DEFAULT_LIMITS).ok).toBe(
      true,
    );
    expect(validateDisplayForm(form({ width: '3840', height: '480' }), DEFAULT_LIMITS).ok).toBe(
      true,
    );
  });

  it('requires a name and a site', () => {
    const result = validateDisplayForm(form({ name: '   ', siteId: '' }), DEFAULT_LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toBeDefined();
      expect(result.errors.siteId).toBeDefined();
    }
  });

  it.each(['', 'abc', '19.5', '-100', '1e3', '1920px', ' 1 9 '])(
    'rejects width %j as not a whole number of pixels',
    (width) => {
      const result = validateDisplayForm(form({ width }), DEFAULT_LIMITS);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.width).toMatch(/whole number/);
    },
  );

  it('enforces the configured side limits at both ends', () => {
    const limits = { minCanvasSidePx: 16, maxCanvasSidePx: 4096 };
    expect(validateDisplayForm(form({ width: '16', height: '4096' }), limits).ok).toBe(true);
    const low = validateDisplayForm(form({ width: '15' }), limits);
    const high = validateDisplayForm(form({ height: '4097' }), limits);
    expect(low.ok).toBe(false);
    expect(high.ok).toBe(false);
    if (!low.ok) expect(low.errors.width).toContain('between 16 and 4096');
    if (!high.ok) expect(high.errors.height).toContain('between 16 and 4096');
  });

  it('accepts a content rectangle that touches the canvas edge exactly', () => {
    const result = validateDisplayForm(
      form({
        useContentRect: true,
        rectX: '320',
        rectY: '0',
        rectWidth: '1600',
        rectHeight: '1080',
      }),
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contentRect).toEqual({ x: 320, y: 0, width: 1600, height: 1080 });
    }
  });

  it('rejects a content rectangle that leaves the canvas, with the shared schema message', () => {
    const result = validateDisplayForm(
      form({
        useContentRect: true,
        rectX: '321',
        rectY: '0',
        rectWidth: '1600',
        rectHeight: '1080',
      }),
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.contentRect).toContain('exceeds canvas width');
  });

  it('ignores rectangle fields when the rectangle is switched off', () => {
    const result = validateDisplayForm(
      form({ useContentRect: false, rectWidth: 'junk', rectHeight: '' }),
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contentRect).toBeNull();
  });

  it('reports each bad rectangle field separately', () => {
    const result = validateDisplayForm(
      form({ useContentRect: true, rectX: '-1', rectY: 'a', rectWidth: '', rectHeight: '8' }),
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        'rectHeight',
        'rectWidth',
        'rectX',
        'rectY',
      ]);
    }
  });

  it('rejects control characters in the name through the shared schema', () => {
    const result = validateDisplayForm(form({ name: 'Foyer\u0007wall' }), DEFAULT_LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toMatch(/control characters/);
  });

  it('round-trips an existing display and builds a patch without the site', () => {
    const values = displayFormFromDto({
      id: ID(2),
      siteId: ID(1),
      name: 'Column',
      description: null,
      tagIds: [],
      assignedPlaylist: null,
      assignedSchedule: null,
      canvas: { width: 640, height: 1344 },
      contentRect: { x: 0, y: 64, width: 640, height: 1280 },
      defaultFit: 'cover',
      rotation: 0,
      workingHours: null,
      route: 'browser',
      player: null,
      createdAt: T,
      updatedAt: T,
    });
    const result = validateDisplayForm(values, DEFAULT_LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(toDisplayPatch(result.value)).toEqual({
        name: 'Column',
        canvas: { width: 640, height: 1344 },
        contentRect: { x: 0, y: 64, width: 640, height: 1280 },
        defaultFit: 'cover',
      });
    }
  });

  it('parsePixels accepts only unsigned whole numbers', () => {
    expect(parsePixels(' 1920 ')).toBe(1920);
    expect(parsePixels('0')).toBe(0);
    expect(parsePixels('1920.0')).toBeNull();
    expect(parsePixels('1234567')).toBeNull();
  });

  it('preview shape follows typing and flags an out-of-bounds rectangle', () => {
    expect(previewShape(form({ width: '' }))).toBeNull();
    expect(previewShape(form({ width: '0' }))).toBeNull();
    expect(previewShape(form())?.contentRect).toBeNull();
    const out = previewShape(
      form({ useContentRect: true, rectX: '1000', rectWidth: '1000', rectHeight: '500' }),
    );
    expect(out?.contentRectOutOfBounds).toBe(true);
    expect(out?.contentRect).toBeNull();
    const inside = previewShape(
      form({ useContentRect: true, rectX: '0', rectWidth: '1000', rectHeight: '500' }),
    );
    expect(inside?.contentRect).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
  });
});

/* ---------- durations ---------- */

describe('image duration', () => {
  it('parses whole and fractional seconds to whole milliseconds', () => {
    expect(parseImageDuration('10', DEFAULT_LIMITS)).toEqual({ ok: true, ms: 10_000 });
    expect(parseImageDuration(' 7.5 ', DEFAULT_LIMITS)).toEqual({ ok: true, ms: 7_500 });
    expect(parseImageDuration('1.001', DEFAULT_LIMITS)).toEqual({ ok: true, ms: 1_001 });
  });

  it('accepts the exact limits and rejects one step outside them', () => {
    expect(parseImageDuration('1', DEFAULT_LIMITS).ok).toBe(true);
    expect(parseImageDuration('3600', DEFAULT_LIMITS).ok).toBe(true);
    expect(parseImageDuration('0.999', DEFAULT_LIMITS).ok).toBe(false);
    expect(parseImageDuration('3600.001', DEFAULT_LIMITS).ok).toBe(false);
  });

  it.each(['', '  ', 'ten', '-5', '5s', '1e2', '1,5', '.5', '5.', '1.2345', '0x10'])(
    'rejects %j',
    (text) => {
      expect(parseImageDuration(text, DEFAULT_LIMITS).ok).toBe(false);
    },
  );

  it('uses the configured limits, not built-in ones', () => {
    const limits = { minImageItemDurationMs: 5_000, maxImageItemDurationMs: 20_000 };
    expect(parseImageDuration('4', limits)).toEqual({
      ok: false,
      message: 'Must be at least 5 s.',
    });
    expect(parseImageDuration('21', limits)).toEqual({
      ok: false,
      message: 'Must be at most 20 s.',
    });
  });

  it('shows stored milliseconds as seconds', () => {
    expect(durationFieldText(10_000)).toBe('10');
    expect(durationFieldText(7_500)).toBe('7.5');
  });
});

/* ---------- status presentation ---------- */

function view(change: Partial<DeliveryStatusView> = {}): DeliveryStatusView {
  return {
    displayId: ID(1),
    paired: true,
    registrationId: ID(2),
    desired: { publicationId: ID(3), publishedAt: T },
    downloaded: { publicationId: ID(3) },
    active: { publicationId: ID(3), itemIndex: 0 },
    playerState: 'playing',
    staging: null,
    lastHeartbeatAt: '2026-11-14T03:09:50.000Z',
    stale: false,
    staleAfterSeconds: 60,
    errors: [],
    summary: 'in_sync',
    asOf: '2026-11-14T03:10:00.000Z',
    ...change,
  };
}

describe('status presentation', () => {
  it('shows a healthy tone only for in_sync that is paired and not stale', () => {
    const p = presentStatus(view(), 0);
    expect(p.tone).toBe('good');
    expect(p.reportBadge).toBe('none');
    expect(p.activeMatchesDesired).toBe(true);
    expect(p.downloadedMatchesDesired).toBe(true);
    expect(p.activeItemNumber).toBe(1);
  });

  it('never presents contradictory in_sync data as healthy', () => {
    expect(presentStatus(view({ stale: true }), 0).tone).toBe('warn');
    expect(presentStatus(view({ paired: false, registrationId: null }), 0).tone).toBe('warn');
  });

  it('only in_sync can produce a good tone', () => {
    for (const summary of DELIVERY_SUMMARIES) {
      const p = presentStatus(view({ summary }), 0);
      if (summary !== 'in_sync') expect(p.tone).not.toBe('good');
    }
  });

  it('never uses the word online in any headline or explanation', () => {
    for (const summary of DELIVERY_SUMMARIES) {
      for (const stale of [true, false]) {
        const p = presentStatus(view({ summary, stale }), 0);
        expect(`${p.headline} ${p.explanation}`.toLowerCase()).not.toContain('online');
      }
    }
  });

  it('shows the stale badge exactly when the API says stale and a report exists', () => {
    expect(presentStatus(view({ summary: 'stale', stale: true }), 0).reportBadge).toBe('stale');
    expect(presentStatus(view({ summary: 'stale', stale: false }), 0).reportBadge).toBe('none');
    // An old heartbeat alone does not produce the badge; the server decides staleness.
    expect(
      presentStatus(view({ lastHeartbeatAt: '2026-11-13T03:00:00.000Z', stale: false }), 0)
        .reportBadge,
    ).toBe('none');
  });

  it('distinguishes "no report yet" from a stale report', () => {
    const p = presentStatus(
      view({
        summary: 'awaiting_player',
        stale: true,
        lastHeartbeatAt: null,
        downloaded: null,
        active: null,
        playerState: null,
      }),
      0,
    );
    expect(p.reportBadge).toBe('no_report');
    expect(p.heartbeatAgeSeconds).toBeNull();
    expect(p.heartbeatText).toBe('No report received');
    expect(p.playerStateLabel).toBe('Not reported');
    expect(p.activeItemNumber).toBeNull();
    expect(p.activeMatchesDesired).toBeNull();
  });

  it('measures heartbeat age on the server clock and advances it by local elapsed time', () => {
    expect(presentStatus(view(), 0).heartbeatAgeSeconds).toBe(10);
    expect(presentStatus(view(), 5_000).heartbeatAgeSeconds).toBe(15);
    expect(presentStatus(view(), 5_000).heartbeatText).toBe('15 seconds ago');
    // A negative elapsed value (should not happen) must not make the report look fresher.
    expect(presentStatus(view(), -60_000).heartbeatAgeSeconds).toBe(10);
  });

  it('flags a player that is active on a different publication than desired', () => {
    const p = presentStatus(
      view({
        summary: 'updating',
        downloaded: { publicationId: ID(3) },
        active: { publicationId: ID(4), itemIndex: 2 },
        staging: { publicationId: ID(3), phase: 'ready', assetsDone: 3, assetsTotal: 3 },
      }),
      0,
    );
    expect(p.tone).toBe('warn');
    expect(p.downloadedMatchesDesired).toBe(true);
    expect(p.activeMatchesDesired).toBe(false);
    expect(p.activeItemNumber).toBe(3);
    expect(p.stagingText).toContain('3 of 3 files');
  });

  it('presents a player error as bad', () => {
    expect(presentStatus(view({ summary: 'error', playerState: 'error' }), 0).tone).toBe('bad');
  });
});

/* ---------- playlist draft ---------- */

function media(n: number, kind: 'image' | 'video', change: Partial<MediaDto> = {}): MediaDto {
  return {
    id: ID(n),
    kind,
    status: 'ready',
    name: `file-${n}`,
    originalName: `file-${n}`,
    description: null,
    defaultDurationMs: null,
    availableFrom: null,
    availableUntil: null,
    folderId: null,
    tagIds: [],
    usageCount: 0,
    mimeType: kind === 'image' ? 'image/png' : 'video/mp4',
    bytes: 1000,
    sha256: 'a'.repeat(64),
    width: 1920,
    height: 1080,
    durationMs: kind === 'video' ? 12_500 : null,
    codec: kind === 'video' ? 'h264' : null,
    errorCode: null,
    errorDetail: null,
    createdAt: T,
    updatedAt: T,
    ...change,
  };
}

function playlist(): PlaylistDto {
  return {
    id: ID(9),
    name: 'Lobby loop',
    description: null,
    transition: 'cut',
    shuffle: false,
    createdAt: T,
    updatedAt: T,
    items: [
      // Deliberately out of order: the draft must follow `position`.
      {
        id: ID(6),
        position: 1,
        mediaId: ID(2),
        durationMs: null,
        fit: 'cover',
        media: media(2, 'video'),
      },
      {
        id: ID(5),
        position: 0,
        mediaId: ID(1),
        durationMs: 8_000,
        fit: null,
        media: media(1, 'image'),
      },
    ],
  };
}

describe('playlist draft', () => {
  it('builds the draft in position order and is clean at first', () => {
    const saved = playlist();
    const draft = draftFromPlaylist(saved);
    expect(draft.items.map(itemRefId)).toEqual([ID(1), ID(2)]);
    expect(draft.items[0]?.durationText).toBe('8');
    expect(isDirty(draft, saved)).toBe(false);
  });

  it('becomes dirty on rename, reorder, add, remove, duration and fit changes, and clean again when undone', () => {
    const saved = playlist();
    const draft = draftFromPlaylist(saved);
    expect(isDirty({ ...draft, name: 'Other' }, saved)).toBe(true);
    expect(isDirty({ ...draft, name: ' Lobby loop ' }, saved)).toBe(false);
    const moved = moveItem(draft, 0, 1);
    expect(isDirty(moved, saved)).toBe(true);
    expect(isDirty(moveItem(moved, 1, -1), saved)).toBe(false);
    expect(isDirty(appendMedia(draft, media(3, 'image'), 'k'), saved)).toBe(true);
    expect(isDirty(removeItem(draft, ID(5)), saved)).toBe(true);
    expect(isDirty(updateItem(draft, ID(5), { durationText: '9' }), saved)).toBe(true);
    expect(isDirty(updateItem(draft, ID(6), { fit: 'contain' }), saved)).toBe(true);
  });

  it('moves items and refuses impossible moves without changing the draft', () => {
    const draft = draftFromPlaylist(playlist());
    expect(moveItem(draft, 0, 1).items.map((item) => item.key)).toEqual([ID(6), ID(5)]);
    expect(moveItem(draft, 0, -1)).toBe(draft);
    expect(moveItem(draft, 1, 1)).toBe(draft);
    expect(moveItem(draft, 5, -1)).toBe(draft);
  });

  it('builds a full-list replacement: image durations in ms, video duration always null', () => {
    const draft = updateItem(draftFromPlaylist(playlist()), ID(6), { durationText: '99' });
    expect(validateDraft(draft, DEFAULT_LIMITS)).toEqual({
      ok: true,
      value: {
        name: 'Lobby loop',
        items: [
          { mediaId: ID(1), durationMs: 8_000, fit: null },
          { mediaId: ID(2), durationMs: null, fit: 'cover' },
        ],
      },
    });
  });

  it('gives new images a default duration and allows the same media twice', () => {
    let draft = draftFromPlaylist(playlist());
    draft = appendMedia(draft, media(1, 'image'), 'second-copy');
    const result = validateDraft(draft, DEFAULT_LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.items[2]).toEqual({ mediaId: ID(1), durationMs: 10_000, fit: null });
  });

  it('reports an invalid duration against the item and saves nothing', () => {
    const draft = updateItem(draftFromPlaylist(playlist()), ID(5), { durationText: '0' });
    const result = validateDraft(draft, DEFAULT_LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.items[ID(5)]).toBe('Must be at least 1 s.');
      expect(result.errors.name).toBeNull();
    }
  });

  it('requires a name and enforces the item limit', () => {
    const draft = draftFromPlaylist(playlist());
    const unnamed = validateDraft({ ...draft, name: ' ' }, DEFAULT_LIMITS);
    expect(unnamed.ok).toBe(false);
    if (!unnamed.ok) expect(unnamed.errors.name).toBe('Enter a name.');
    const tooMany = validateDraft(draft, { ...DEFAULT_LIMITS, maxPlaylistItems: 1 });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.errors.form).toContain('at most 1');
  });

  it('keeps an app item as an app: its seconds, no fit, counted in the loop', () => {
    const saved: PlaylistDto = {
      ...playlist(),
      items: [{ id: ID(7), position: 0, appId: app(3).id, durationMs: 15_000, app: app(3) }],
    };
    let draft = draftFromPlaylist(saved);
    expect(draft.items[0]).toMatchObject({ source: 'app', durationText: '15' });
    expect(isDirty(draft, saved)).toBe(false);
    expect(isDirty(updateItem(draft, ID(7), { fit: 'cover' }), saved)).toBe(false);
    draft = appendApp(draft, app(4), 'new');
    expect(draft.items[1]?.durationText).toBe('10');
    expect(draftLoopMs(draft, DEFAULT_LIMITS)).toBe(25_000);
    const result = validateDraft(draft, DEFAULT_LIMITS);
    expect(result.ok && result.value.items).toEqual([
      { appId: app(3).id, durationMs: 15_000 },
      { appId: app(4).id, durationMs: 10_000 },
    ]);
    const bad = validateDraft(updateItem(draft, 'new', { durationText: '0' }), DEFAULT_LIMITS);
    expect(!bad.ok && bad.errors.items['new']).toBe('Must be at least 1 s.');
  });

  it('allows an empty draft to be saved', () => {
    expect(validateDraft({ name: 'Empty', items: [] }, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('adds up one pass, or gives null when a duration is unusable', () => {
    const draft = draftFromPlaylist(playlist());
    expect(draftLoopMs(draft, DEFAULT_LIMITS)).toBe(20_500);
    expect(draftLoopMs(updateItem(draft, ID(5), { durationText: '' }), DEFAULT_LIMITS)).toBeNull();
  });
});

/* ---------- uploads and formatting ---------- */

describe('upload queue', () => {
  const limits = { maxUploadBytes: 1000 };

  it('rejects empty and oversized files before sending', () => {
    expect(preflightMessage({ size: 0 }, limits)).toBe('The file is empty.');
    expect(preflightMessage({ size: 1001 }, limits)).toContain('upload limit');
    expect(preflightMessage({ size: 1000 }, limits)).toBeNull();
    expect(newEntry('a', { name: 'big.mp4', size: 5000 }, limits).status).toBe('rejected');
  });

  it('starts one upload at a time, in order, skipping rejected and cancelled entries', () => {
    let entries = [
      newEntry('a', { name: 'a', size: 0 }, limits),
      newEntry('b', { name: 'b', size: 10 }, limits),
      newEntry('c', { name: 'c', size: 10 }, limits),
    ];
    expect(nextToStart(entries)?.id).toBe('b');
    entries = patchEntry(entries, 'b', { status: 'uploading' });
    expect(nextToStart(entries)).toBeNull();
    entries = patchEntry(entries, 'b', { status: 'cancelled' });
    expect(nextToStart(entries)?.id).toBe('c');
    entries = patchEntry(entries, 'c', { status: 'done' });
    expect(nextToStart(entries)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(200 * 1024 * 1024)).toBe('200 MB');
    expect(formatBytes(-1)).toBe('unknown size');
  });

  it('formats durations', () => {
    expect(formatDurationMs(4_500)).toBe('4.5 s');
    expect(formatDurationMs(10_000)).toBe('10 s');
    expect(formatDurationMs(65_000)).toBe('1 min 5 s');
    expect(formatDurationMs(3_600_000)).toBe('1 h 0 min');
  });

  it('rounds a duration before choosing its unit', () => {
    expect(formatDurationMs(59_940)).toBe('59.9 s');
    expect(formatDurationMs(59_950)).toBe('1 min 0 s');
    expect(formatDurationMs(59_999)).toBe('1 min 0 s');
    expect(formatDurationMs(9_990)).toBe('10 s');
    expect(formatDurationMs(4_449)).toBe('4.4 s');
    expect(formatDurationMs(0)).toBe('0 s');
    expect(formatDurationMs(3_599_600)).toBe('1 h 0 min');
  });

  it('formats relative age without ever going negative', () => {
    expect(formatAge(-30)).toBe('just now');
    expect(formatAge(4)).toBe('just now');
    expect(formatAge(59)).toBe('59 seconds ago');
    expect(formatAge(60)).toBe('1 minute ago');
    expect(formatAge(7200)).toBe('2 hours ago');
    expect(formatAge(86_400 * 3)).toBe('3 days ago');
  });
});
