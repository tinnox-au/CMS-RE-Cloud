import { describe, expect, it } from 'vitest';
import { ManifestV1Schema } from '@tinnox/contracts';
import { checkCapabilities } from './capability.ts';
import { ID, display, library, limits } from './fixtures.test-support.ts';
import {
  buildManifest,
  manifestAssetIds,
  manifestStorageBytes,
  planPublication,
} from './manifest.ts';
import { buildPublicationDraft, validatePlaylist } from './playlist.ts';
import type { PublicationValidator } from './types.ts';

const image = (mediaId: string, durationMs: number | null = 5000) => ({
  mediaId,
  durationMs,
  fit: null,
});
const video = (mediaId: string) => ({ mediaId, durationMs: null, fit: null });

describe('validatePlaylist', () => {
  it('accepts images with durations and video with natural duration', () => {
    expect(
      validatePlaylist([image(ID.jpeg), video(ID.video), image(ID.png, 1000)], library(), limits, {
        mode: 'publish',
      }),
    ).toEqual([]);
  });

  it('allows an empty draft but not an empty publication', () => {
    expect(validatePlaylist([], library(), limits, { mode: 'draft' })).toEqual([]);
    expect(validatePlaylist([], library(), limits, { mode: 'publish' }).map((i) => i.code)).toEqual(
      ['playlist_empty'],
    );
  });

  it('allows processing media in a draft but not in a publication', () => {
    expect(validatePlaylist([image(ID.processing)], library(), limits, { mode: 'draft' })).toEqual(
      [],
    );
    const issues = validatePlaylist([image(ID.processing)], library(), limits, { mode: 'publish' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ index: 0, code: 'media_not_ready' });
  });

  it('reports missing and failed media with the item position', () => {
    const issues = validatePlaylist(
      [image(ID.jpeg), image('99999999-9999-4999-8999-999999999999'), image(ID.failed)],
      library(),
      limits,
      { mode: 'draft' },
    );
    expect(issues.map((i) => [i.index, i.code])).toEqual([
      [1, 'media_missing'],
      [2, 'media_failed'],
    ]);
    expect(issues[0]?.message).toContain('Item 2');
  });

  it('enforces image duration rules and forbids custom video durations', () => {
    const issues = validatePlaylist(
      [
        image(ID.jpeg, null),
        image(ID.jpeg, 999),
        image(ID.jpeg, 3_600_001),
        { mediaId: ID.video, durationMs: 4000, fit: null },
      ],
      library(),
      limits,
      { mode: 'publish' },
    );
    expect(issues.map((i) => i.code)).toEqual([
      'duration_required',
      'duration_out_of_range',
      'duration_out_of_range',
      'duration_not_allowed',
    ]);
  });

  it('accepts the boundary durations', () => {
    expect(
      validatePlaylist([image(ID.jpeg, 1000), image(ID.jpeg, 3_600_000)], library(), limits, {
        mode: 'publish',
      }),
    ).toEqual([]);
  });

  it('enforces the item count limit', () => {
    const many = Array.from({ length: limits.maxPlaylistItems + 1 }, () => image(ID.jpeg));
    expect(validatePlaylist(many, library(), limits, { mode: 'draft' }).map((i) => i.code)).toEqual(
      ['too_many_items'],
    );
  });
});

describe('buildPublicationDraft and buildManifest', () => {
  const created = { publicationId: ID.pubA, createdAt: new Date('2026-11-14T01:02:03.000Z') };

  it('resolves durations, default fit and asset facts in order', () => {
    const result = buildPublicationDraft(
      display({ defaultFit: 'cover' }),
      [
        image(ID.jpeg, 7000),
        video(ID.video),
        { mediaId: ID.png, durationMs: 2000, fit: 'contain' },
      ],
      library(),
      limits,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.items.map((i) => [i.assetId, i.durationMs, i.fit])).toEqual([
      [ID.jpeg, 7000, 'cover'],
      [ID.video, 12_500, 'cover'],
      [ID.png, 2000, 'contain'],
    ]);
    const manifest = buildManifest(result.draft, created);
    expect(ManifestV1Schema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      publicationId: ID.pubA,
      displayId: ID.display,
      createdAt: '2026-11-14T01:02:03.000Z',
      canvas: { width: 1920, height: 1080 },
      contentRect: null,
      muted: true,
    });
    expect(manifest.assets[1]).toMatchObject({
      assetId: ID.video,
      mediaType: 'video/mp4',
      kind: 'video',
      bytes: 4_000_000,
      durationMs: 12_500,
    });
    expect(manifest.assets[1]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries an unusual canvas and content rectangle into the manifest', () => {
    const result = buildPublicationDraft(
      display({
        canvas: { width: 640, height: 1344 },
        contentRect: { x: 0, y: 64, width: 640, height: 1280 },
      }),
      [image(ID.png)],
      library(),
      limits,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = buildManifest(result.draft, created);
    expect(manifest.canvas).toEqual({ width: 640, height: 1344 });
    expect(manifest.contentRect).toEqual({ x: 0, y: 64, width: 640, height: 1280 });
  });

  it('refuses unready media and returns every issue', () => {
    const result = buildPublicationDraft(
      display(),
      [image(ID.processing), image(ID.failed)],
      library(),
      limits,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toEqual(['media_not_ready', 'media_failed']);
  });

  it('refuses a ready record with missing inspection data', () => {
    const lib = library();
    const jpeg = lib.get(ID.jpeg);
    if (jpeg === undefined) throw new Error('fixture');
    lib.set(ID.jpeg, { ...jpeg, sha256: null });
    const result = buildPublicationDraft(display(), [image(ID.jpeg)], lib, limits);
    expect(result.ok).toBe(false);
  });

  it('does not change a built manifest when the draft inputs change afterwards', () => {
    const lib = library();
    const items = [image(ID.jpeg, 5000)];
    const result = buildPublicationDraft(display(), items, lib, limits);
    if (!result.ok) throw new Error('expected ok');
    const manifest = buildManifest(result.draft, created);
    const snapshot = JSON.stringify(manifest);
    items[0] = image(ID.png, 9000);
    lib.delete(ID.jpeg);
    expect(JSON.stringify(manifest)).toBe(snapshot);
  });

  it('counts repeated assets once for storage and lists distinct ids', () => {
    const result = buildPublicationDraft(
      display(),
      [image(ID.jpeg), image(ID.png), image(ID.jpeg, 2000)],
      library(),
      limits,
    );
    if (!result.ok) throw new Error('expected ok');
    const manifest = buildManifest(result.draft, created);
    expect(manifestAssetIds(manifest)).toEqual([ID.jpeg, ID.png]);
    expect(manifestStorageBytes(manifest)).toBe(120_000 + 300_000);
  });
});

describe('planPublication', () => {
  it('asks the route and passes its rejection through', () => {
    const calls: number[] = [];
    const route: PublicationValidator = {
      capabilities: () => {
        throw new Error('not needed');
      },
      validate: (draft) => {
        calls.push(draft.items.length);
        return [{ index: 0, code: 'unsupported_media_type', message: 'no' }];
      },
    };
    const result = planPublication({
      display: display(),
      items: [image(ID.jpeg)],
      mediaById: library(),
      limits,
      route,
    });
    expect(calls).toEqual([1]);
    expect(result.ok).toBe(false);
  });

  it('does not consult the route when the playlist itself is invalid', () => {
    const route: PublicationValidator = {
      capabilities: () => {
        throw new Error('not needed');
      },
      validate: () => {
        throw new Error('must not be called');
      },
    };
    const result = planPublication({
      display: display(),
      items: [],
      mediaById: library(),
      limits,
      route,
    });
    expect(result.ok).toBe(false);
  });
});

describe('checkCapabilities', () => {
  const profile = {
    routeId: 'browser' as const,
    profileVersion: 1,
    label: 'The browser player',
    mediaTypes: ['image/jpeg' as const, 'image/png' as const, 'video/mp4' as const],
    videoCodecs: ['h264'],
    fitModes: ['contain' as const, 'cover' as const],
    maxRegions: 1,
    audio: false,
    supportsContentRect: true,
    maxCanvas: { width: 16384, height: 16384 },
    maxVideoWidthPx: 3840,
    maxVideoHeightPx: 2160,
    maxAssetBytes: 200 * 1024 * 1024,
    maxItems: 200,
  };
  const draftOf = (
    items: { mediaId: string; durationMs: number | null; fit: null }[],
    d = display(),
  ) => {
    const r = buildPublicationDraft(d, items, library(), limits);
    if (!r.ok) throw new Error('fixture draft should build');
    return r.draft;
  };

  it('accepts a supported draft', () => {
    expect(checkCapabilities(draftOf([image(ID.jpeg), video(ID.video)]), profile)).toEqual([]);
  });

  it('explains an unsupported codec in plain words', () => {
    const issues = checkCapabilities(draftOf([video(ID.hevc)]), profile);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('unsupported_codec');
    expect(issues[0]?.message).toBe(
      'Item 1 uses the video codec hevc, which The browser player cannot play. Supported codecs: h264.',
    );
  });

  it('rejects media types, content rectangles, canvases and sizes the profile lacks', () => {
    const narrow = {
      ...profile,
      label: 'A limited target',
      mediaTypes: ['image/png' as const],
      fitModes: ['cover' as const],
      supportsContentRect: false,
      maxCanvas: { width: 1024, height: 1024 },
      maxAssetBytes: 100_000,
      maxItems: 1,
    };
    const draft = draftOf(
      [image(ID.jpeg), image(ID.png)],
      display({ contentRect: { x: 0, y: 0, width: 100, height: 100 } }),
    );
    expect(checkCapabilities(draft, narrow).map((i) => i.code)).toEqual([
      'canvas_too_large',
      'content_rect_unsupported',
      'too_many_items',
      'unsupported_media_type',
      'unsupported_fit',
      'asset_too_large',
    ]);
  });

  it('rejects video above the profile resolution', () => {
    const issues = checkCapabilities(draftOf([video(ID.video)]), {
      ...profile,
      maxVideoWidthPx: 1280,
      maxVideoHeightPx: 720,
    });
    expect(issues.map((i) => i.code)).toEqual(['video_resolution_too_large']);
  });
});
