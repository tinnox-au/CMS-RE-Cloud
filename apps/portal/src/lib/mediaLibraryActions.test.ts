import { DEFAULT_LIMITS, type PlaylistDto } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { app, ID, media } from './mediaLibrary.test-support.ts';
import {
  addToPlaylistBlock,
  appendedItemDurationMs,
  DEFAULT_IMAGE_DURATION_MS,
  deletedNote,
  deletedToast,
  deleteUsageWarning,
  deleteWording,
  playlistFullReason,
  playlistWithMediaAppended,
} from './mediaLibraryActions.ts';

const T = '2026-11-14T03:00:00.000Z';

function playlist(items: PlaylistDto['items']): PlaylistDto {
  return {
    id: ID(9),
    name: 'Lobby loop',
    description: 'Foyer',
    items,
    transition: 'cut',
    shuffle: false,
    createdAt: T,
    updatedAt: T,
  };
}

describe('adding a file to a playlist', () => {
  it('gives an image its own default, else 10 seconds, within the limits; a video none', () => {
    expect(DEFAULT_IMAGE_DURATION_MS).toBe(10_000);
    expect(appendedItemDurationMs(media(1, 'image'), DEFAULT_LIMITS)).toBe(10_000);
    expect(
      appendedItemDurationMs(media(1, 'image', { defaultDurationMs: 4000 }), DEFAULT_LIMITS),
    ).toBe(4000);
    expect(
      appendedItemDurationMs(media(1, 'image', { defaultDurationMs: 500 }), {
        minImageItemDurationMs: 2000,
        maxImageItemDurationMs: 5000,
      }),
    ).toBe(2000);
    expect(appendedItemDurationMs(media(2, 'video'), DEFAULT_LIMITS)).toBeNull();
  });

  it('keeps every item in play order and adds the file last, leaving the description', () => {
    const body = playlistWithMediaAppended(
      playlist([
        {
          id: ID(5),
          position: 1,
          mediaId: ID(2),
          durationMs: null,
          fit: 'cover',
          media: media(2, 'video'),
        },
        {
          id: ID(6),
          position: 0,
          mediaId: ID(3),
          durationMs: 7000,
          fit: null,
          media: media(3, 'image'),
        },
      ]),
      media(1, 'image', { defaultDurationMs: 3000 }),
      DEFAULT_LIMITS,
    );
    expect(body).toEqual({
      name: 'Lobby loop',
      items: [
        { mediaId: ID(3), durationMs: 7000, fit: null },
        { mediaId: ID(2), durationMs: null, fit: 'cover' },
        { mediaId: ID(1), durationMs: 3000, fit: null },
      ],
    });
    expect('description' in body).toBe(false);
  });

  it('sends an app item back as an app item', () => {
    const body = playlistWithMediaAppended(
      playlist([{ id: ID(5), position: 0, appId: ID(7), durationMs: 15_000, app: app(7) }]),
      media(1, 'video'),
      DEFAULT_LIMITS,
    );
    expect(body.items).toEqual([
      { appId: ID(7), durationMs: 15_000 },
      { mediaId: ID(1), durationMs: null, fit: null },
    ]);
  });

  it('says why a playlist or a file cannot take part', () => {
    expect(playlistFullReason({ itemCount: 199 }, { maxPlaylistItems: 200 })).toBeNull();
    expect(playlistFullReason({ itemCount: 200 }, { maxPlaylistItems: 200 })).toMatch(/200 items/);
    expect(addToPlaylistBlock({ status: 'ready' })).toBeNull();
    expect(addToPlaylistBlock({ status: 'processing' })).not.toBeNull();
    expect(addToPlaylistBlock({ status: 'failed' })).not.toBeNull();
  });
});

describe('deleting files', () => {
  it('keeps the M0 wording for one file', () => {
    expect(deleteWording(1)).toEqual({ title: 'Delete this file?', confirmLabel: 'Delete file' });
    expect(deleteWording(3)).toEqual({ title: 'Delete 3 files?', confirmLabel: 'Delete 3 files' });
  });

  it('warns when the server will refuse, and only then', () => {
    expect(deleteUsageWarning([media(1, 'image')])).toBeNull();
    expect(deleteUsageWarning([media(1, 'image', { usageCount: 2 })])).toMatch(/2 playlists/);
    expect(deleteUsageWarning([media(1, 'image', { usageCount: 1 }), media(2, 'image')])).toMatch(
      /^1 of them is used/,
    );
  });

  it('reports what was deleted', () => {
    expect(deletedToast(['a.png'])).toBe('a.png deleted');
    expect(deletedToast(['a.png', 'b.png'])).toBe('2 files deleted');
    expect(deletedNote({ done: [], failed: [{ item: 1, error: null }] })).toBeNull();
    expect(deletedNote({ done: [{ item: 1, result: null }], failed: [] })).toBe(
      '1 file was deleted.',
    );
    expect(
      deletedNote({
        done: [
          { item: 1, result: null },
          { item: 2, result: null },
        ],
        failed: [],
      }),
    ).toBe('2 files were deleted.');
  });
});
