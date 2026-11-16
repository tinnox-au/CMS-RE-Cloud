import { MediaPatchSchema, type MediaDto, type PlaylistDto } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { app } from './mediaLibrary.test-support.ts';
import {
  appendToPlaylistBody,
  changedFields,
  draftFromMedia,
  durationBoundsSeconds,
  errorFields,
  fieldErrorsFromApi,
  hasErrors,
  INCOMPLETE_DATE_TIME,
  isDraftDirty,
  NO_MEDIA_DETAIL_ERRORS,
  STANDARD_IMAGE_DURATION_MS,
  validateMediaDraft,
  withoutError,
  type MediaDetailDraft,
} from './mediaDetailDraft.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LIMITS = {
  minImageItemDurationMs: 1_000,
  maxImageItemDurationMs: 3_600_000,
  maxPlaylistItems: 3,
};
const AT = '2026-11-16T00:00:00.000Z';

function image(overrides: Partial<MediaDto> = {}): MediaDto {
  return {
    id: ID(1),
    kind: 'image',
    status: 'ready',
    name: 'IMG_0042.jpg',
    originalName: 'IMG_0042.jpg',
    description: null,
    defaultDurationMs: null,
    availableFrom: null,
    availableUntil: null,
    folderId: null,
    tagIds: [],
    usageCount: 0,
    mimeType: 'image/jpeg',
    bytes: 2_400_000,
    sha256: 'a'.repeat(64),
    width: 1920,
    height: 1080,
    durationMs: null,
    codec: null,
    errorCode: null,
    errorDetail: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function video(overrides: Partial<MediaDto> = {}): MediaDto {
  return image({
    id: ID(2),
    kind: 'video',
    name: 'clip.mp4',
    originalName: 'clip.mp4',
    mimeType: 'video/mp4',
    durationMs: 12_000,
    codec: 'h264',
    ...overrides,
  });
}

function edit(media: MediaDto, change: Partial<MediaDetailDraft>): MediaDetailDraft {
  return { ...draftFromMedia(media), ...change };
}

function patchOf(media: MediaDto, change: Partial<MediaDetailDraft>) {
  const result = validateMediaDraft(edit(media, change), media, LIMITS);
  if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`);
  return result.patch;
}

function errorsOf(media: MediaDto, change: Partial<MediaDetailDraft>) {
  const result = validateMediaDraft(edit(media, change), media, LIMITS);
  if (result.ok) throw new Error('expected the draft to be refused');
  return result.errors;
}

describe('media details draft', () => {
  it('starts from the saved item', () => {
    const media = image({
      name: 'Spring sale',
      description: 'Window poster',
      defaultDurationMs: 7_500,
      folderId: ID(10),
      tagIds: [ID(20), ID(21)],
      availableFrom: '2026-12-01T09:00',
    });
    expect(draftFromMedia(media)).toEqual({
      name: 'Spring sale',
      description: 'Window poster',
      durationText: '7.5',
      folderId: ID(10),
      tagIds: [ID(20), ID(21)],
      availableFrom: '2026-12-01T09:00',
      availableUntil: '',
    });
    expect(draftFromMedia(image()).durationText).toBe('');
    expect(draftFromMedia(video()).durationText).toBe('');
  });

  it('is clean when nothing would be sent', () => {
    const media = image({
      name: 'Spring sale',
      defaultDurationMs: 10_000,
      tagIds: [ID(20), ID(21)],
    });
    expect(isDraftDirty(draftFromMedia(media), media, LIMITS)).toBe(false);
    // The same values written another way.
    expect(isDraftDirty(edit(media, { name: '  Spring sale ' }), media, LIMITS)).toBe(false);
    expect(isDraftDirty(edit(media, { durationText: '10.0' }), media, LIMITS)).toBe(false);
    expect(isDraftDirty(edit(media, { description: '   ' }), media, LIMITS)).toBe(false);
    expect(isDraftDirty(edit(media, { tagIds: [ID(21), ID(20)] }), media, LIMITS)).toBe(false);
    expect(validateMediaDraft(draftFromMedia(media), media, LIMITS)).toEqual({
      ok: true,
      patch: null,
      changed: [],
    });
  });

  it('names the changed fields in the order of the form', () => {
    const media = image();
    const draft = edit(media, {
      tagIds: [ID(20)],
      folderId: ID(10),
      durationText: '8',
      description: 'Poster',
      name: 'Spring sale',
    });
    expect(changedFields(draft, media, LIMITS)).toEqual([
      'name',
      'description',
      'defaultDurationMs',
      'folderId',
      'tagIds',
    ]);
    expect(isDraftDirty(draft, media, LIMITS)).toBe(true);
  });

  it('sends only what changed, trimmed', () => {
    const media = image({ description: 'Old' });
    expect(patchOf(media, { name: '  Spring sale  ' })).toEqual({ name: 'Spring sale' });
    expect(patchOf(media, { description: ' Line one\nLine two ' })).toEqual({
      description: 'Line one\nLine two',
    });
    expect(patchOf(media, { description: '  ' })).toEqual({ description: null });
    expect(patchOf(media, { folderId: ID(10) })).toEqual({ folderId: ID(10) });
    expect(patchOf(image({ folderId: ID(10) }), { folderId: null })).toEqual({ folderId: null });
    expect(patchOf(media, { tagIds: [ID(20), ID(21), ID(20)] })).toEqual({
      tagIds: [ID(20), ID(21)],
    });
  });

  it('goes back to the file name when the name is emptied', () => {
    const renamed = image({ name: 'Spring sale' });
    expect(patchOf(renamed, { name: '   ' })).toEqual({ name: null });
    // An item that already shows its file name has nothing to go back to.
    expect(patchOf(image(), { name: '' })).toBeNull();
    expect(isDraftDirty(edit(image(), { name: '' }), image(), LIMITS)).toBe(false);
  });

  it('does not check a field that was not touched', () => {
    // A file name may be longer than a name is allowed to be; it is only shown.
    const long = image({ name: `${'x'.repeat(200)}.jpg`, originalName: `${'x'.repeat(200)}.jpg` });
    expect(patchOf(long, { description: 'Poster' })).toEqual({ description: 'Poster' });
    expect(errorsOf(long, { name: `${'y'.repeat(200)}.jpg` }).name).toBe(
      'Use at most 120 characters. This name has 204.',
    );
  });

  it('refuses what the shared schema refuses, at the field', () => {
    const media = image();
    expect(errorsOf(media, { name: 'a'.repeat(121) })).toEqual({
      name: 'Use at most 120 characters. This name has 121.',
    });
    expect(patchOf(media, { name: 'a'.repeat(120) })).toEqual({ name: 'a'.repeat(120) });
    expect(errorsOf(media, { name: 'Spring\tsale' }).name).toMatch(/control characters/);
    expect(errorsOf(media, { description: 'd'.repeat(501) }).description).toBe(
      'Use at most 500 characters. This description has 501.',
    );
    expect(errorsOf(media, { description: 'Tab\there' }).description).toMatch(
      /Line breaks are fine/,
    );
    const many = Array.from({ length: 51 }, (_, index) => ID(100 + index));
    expect(errorsOf(media, { tagIds: many }).tagIds).toBe(
      'One item carries at most 50 tags. Remove some.',
    );
    expect(errorsOf(media, { name: 'a'.repeat(121), durationText: 'soon' })).toEqual({
      name: 'Use at most 120 characters. This name has 121.',
      defaultDurationMs: 'Use a number of seconds, for example 10 or 7.5.',
    });
  });

  it('every body it builds passes the shared schema', () => {
    const media = image({ name: 'Spring sale', defaultDurationMs: 5_000, tagIds: [ID(20)] });
    const patches = [
      patchOf(media, { name: '' }),
      patchOf(media, { durationText: '' }),
      patchOf(media, { durationText: '12.345' }),
      patchOf(media, { tagIds: [] }),
      patchOf(media, { name: 'Autumn', description: 'New', folderId: ID(10), tagIds: [ID(21)] }),
    ];
    for (const patch of patches) {
      expect(patch).not.toBeNull();
      expect(MediaPatchSchema.safeParse(patch).success).toBe(true);
    }
    expect(patches[1]).toEqual({ defaultDurationMs: null });
    expect(patches[2]).toEqual({ defaultDurationMs: 12_345 });
    expect(patches[3]).toEqual({ tagIds: [] });
  });

  it('sends both sides of the availability window together, and checks their order', () => {
    const media = image({ availableFrom: '2026-12-01T09:00' });
    expect(patchOf(media, { availableUntil: '2026-12-24T17:00' })).toEqual({
      availableFrom: '2026-12-01T09:00',
      availableUntil: '2026-12-24T17:00',
    });
    expect(patchOf(media, { availableFrom: '' })).toEqual({
      availableFrom: null,
      availableUntil: null,
    });
    expect(changedFields(edit(media, { availableFrom: '' }), media, LIMITS)).toEqual([
      'availableFrom',
    ]);
    for (const until of ['2026-12-01T09:00', '2026-11-30T23:59']) {
      expect(errorsOf(media, { availableUntil: until })).toEqual({
        availableUntil: 'Must be after Available from.',
      });
    }
    expect(errorsOf(media, { availableFrom: '0999-12-01T09:00' }).availableFrom).toBe(
      'Enter a full date and time, year 1000 or later.',
    );
  });

  it('refuses a half-typed window side instead of saving it as no limit', () => {
    const FULL = 'Enter a full date and time, year 1000 or later.';
    // A stored start whose year is being retyped.
    const windowed = image({
      availableFrom: '2026-12-01T09:00',
      availableUntil: '2026-12-24T17:00',
    });
    expect(errorsOf(windowed, { availableFrom: INCOMPLETE_DATE_TIME })).toEqual({
      availableFrom: FULL,
    });
    // A date without a time on an item with no window: dirty, so Save is offered and refused.
    const open = image();
    expect(isDraftDirty(edit(open, { availableFrom: INCOMPLETE_DATE_TIME }), open, LIMITS)).toBe(
      true,
    );
    expect(errorsOf(open, { availableFrom: INCOMPLETE_DATE_TIME })).toEqual({
      availableFrom: FULL,
    });
    expect(errorsOf(open, { availableUntil: INCOMPLETE_DATE_TIME })).toEqual({
      availableUntil: FULL,
    });
  });

  it('keeps the default duration inside the configured limits', () => {
    const media = image();
    expect(patchOf(media, { durationText: '1' })).toEqual({ defaultDurationMs: 1_000 });
    expect(patchOf(media, { durationText: '3600' })).toEqual({ defaultDurationMs: 3_600_000 });
    expect(errorsOf(media, { durationText: '0.5' }).defaultDurationMs).toBe(
      'Must be at least 1 s.',
    );
    expect(errorsOf(media, { durationText: '3601' }).defaultDurationMs).toBe(
      'Must be at most 3600 s.',
    );
    expect(errorsOf(media, { durationText: '-3' }).defaultDurationMs).toMatch(/number of seconds/);
    expect(durationBoundsSeconds(LIMITS)).toEqual({ min: 1, max: 3600 });
    expect(
      durationBoundsSeconds({ minImageItemDurationMs: 2_500, maxImageItemDurationMs: 9_900 }),
    ).toEqual({ min: 3, max: 9 });
  });

  it('never sends a default duration for a video', () => {
    const media = video();
    const draft = edit(media, { durationText: '15', name: 'Clip' });
    expect(changedFields(draft, media, LIMITS)).toEqual(['name']);
    expect(validateMediaDraft(draft, media, LIMITS)).toEqual({
      ok: true,
      patch: { name: 'Clip' },
      changed: ['name'],
    });
  });

  it('lists and clears problems', () => {
    const errors = errorsOf(image(), { name: 'a'.repeat(121), durationText: 'x' });
    expect(errorFields(errors)).toEqual(['name', 'defaultDurationMs']);
    expect(hasErrors(errors)).toBe(true);
    const cleared = withoutError(errors, 'name');
    expect(errorFields(cleared)).toEqual(['defaultDurationMs']);
    expect(withoutError(cleared, 'name')).toBe(cleared);
    expect(hasErrors(NO_MEDIA_DETAIL_ERRORS)).toBe(false);
    expect(hasErrors({ form: 'at least one field is required' })).toBe(true);
  });

  it('puts a refusal by the server at the field it names', () => {
    expect(
      fieldErrorsFromApi([
        { path: 'defaultDurationMs', message: 'must be between 1000 and 3600000 milliseconds' },
        { path: 'defaultDurationMs', message: 'second message is not shown twice' },
        { path: 'tagIds.3', message: 'Invalid UUID' },
        { path: 'body', message: 'not a field of this form' },
        { path: 'name', message: ' ' },
      ]),
    ).toEqual({
      defaultDurationMs:
        'The server refused this value: must be between 1000 and 3600000 milliseconds',
      tagIds: 'The server refused this value: Invalid UUID',
      name: 'The server refused this value.',
    });
    expect(fieldErrorsFromApi([])).toEqual({});
  });
});

function playlist(items: readonly { media: MediaDto; durationMs: number | null }[]): PlaylistDto {
  return {
    id: ID(50),
    name: 'Reception loop',
    description: 'Front desk',
    transition: 'cut',
    shuffle: false,
    items: items.map((item, index) => ({
      id: ID(60 + index),
      position: index,
      mediaId: item.media.id,
      durationMs: item.durationMs,
      fit: index === 0 ? 'cover' : null,
      media: item.media,
    })),
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('adding a media item to a playlist', () => {
  it('keeps the playlist as it is and adds the item at the end', () => {
    const first = image({ id: ID(3) });
    const clip = video();
    const result = appendToPlaylistBody(
      playlist([
        { media: first, durationMs: 4_000 },
        { media: clip, durationMs: null },
      ]),
      image({ defaultDurationMs: 7_500 }),
      LIMITS,
    );
    expect(result).toEqual({
      ok: true,
      body: {
        name: 'Reception loop',
        items: [
          { mediaId: ID(3), durationMs: 4_000, fit: 'cover' },
          { mediaId: ID(2), durationMs: null, fit: null },
          { mediaId: ID(1), durationMs: 7_500, fit: null },
        ],
      },
    });
    // The description is left out, so the stored one stays.
    expect(result.ok && 'description' in result.body).toBe(false);
  });

  it('sends the items in play order whatever order they arrived in', () => {
    const original = playlist([
      { media: image({ id: ID(3) }), durationMs: 4_000 },
      { media: image({ id: ID(4) }), durationMs: 5_000 },
    ]);
    const shuffled = { ...original, items: [...original.items].reverse() };
    const result = appendToPlaylistBody(shuffled, video(), LIMITS);
    expect(
      result.ok && result.body.items.map((item) => ('mediaId' in item ? item.mediaId : null)),
    ).toEqual([ID(3), ID(4), ID(2)]);
  });

  it('keeps an app item as an app item', () => {
    const base = playlist([{ media: image({ id: ID(3) }), durationMs: 4_000 }]);
    const withApp: PlaylistDto = {
      ...base,
      items: [
        ...base.items,
        { id: ID(70), position: 1, appId: app(7).id, durationMs: 20_000, app: app(7) },
      ],
    };
    const result = appendToPlaylistBody(withApp, video(), LIMITS);
    expect(result.ok && result.body.items[1]).toEqual({ appId: app(7).id, durationMs: 20_000 });
  });

  it('uses 10 seconds for an image without a default and no duration for a video', () => {
    expect(STANDARD_IMAGE_DURATION_MS).toBe(10_000);
    const forImage = appendToPlaylistBody(playlist([]), image(), LIMITS);
    expect(forImage.ok && forImage.body.items).toEqual([
      { mediaId: ID(1), durationMs: 10_000, fit: null },
    ]);
    const forVideo = appendToPlaylistBody(playlist([]), video(), LIMITS);
    expect(forVideo.ok && forVideo.body.items).toEqual([
      { mediaId: ID(2), durationMs: null, fit: null },
    ]);
  });

  it('refuses a full playlist and a file that is not ready', () => {
    const full = playlist([
      { media: image({ id: ID(3) }), durationMs: 4_000 },
      { media: image({ id: ID(4) }), durationMs: 4_000 },
      { media: image({ id: ID(5) }), durationMs: 4_000 },
    ]);
    expect(appendToPlaylistBody(full, image(), LIMITS)).toEqual({
      ok: false,
      message: 'This playlist already holds 3 items. A playlist can hold at most 3.',
    });
    expect(appendToPlaylistBody(playlist([]), image({ status: 'failed' }), LIMITS)).toEqual({
      ok: false,
      message: 'Only a file that is ready can be added to a playlist.',
    });
  });
});
