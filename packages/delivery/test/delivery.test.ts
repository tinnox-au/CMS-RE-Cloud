import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, DELIVERY_ROUTE_IDS, type HeartbeatV1 } from '@tinnox/contracts';
import {
  buildManifest,
  planPublication,
  type DisplayTarget,
  type MediaRecord,
} from '@tinnox/domain';
import * as deliveryPackage from '../src/index.ts';
import { createBrowserRoute, createDeliveryRegistry } from '../src/index.ts';
import { createFakeStillImageRoute } from './fake-route.ts';

const here = dirname(fileURLToPath(import.meta.url));
const display: DisplayTarget = {
  id: '11111111-1111-4111-8111-111111111111',
  canvas: { width: 768, height: 448 },
  contentRect: null,
  defaultFit: 'contain',
  route: 'browser',
  rotation: 0,
  workingHours: null,
  timeZone: 'Australia/Melbourne',
};
const PNG = '22222222-2222-4222-8222-000000000002';
const MP4 = '22222222-2222-4222-8222-000000000003';
const HEVC = '22222222-2222-4222-8222-000000000006';
const record = (id: string, o: Partial<MediaRecord>): MediaRecord => ({
  id,
  kind: 'image',
  status: 'ready',
  mimeType: 'image/png',
  bytes: 50_000,
  sha256: 'ab'.repeat(32),
  width: 768,
  height: 448,
  durationMs: null,
  codec: null,
  availableFrom: null,
  availableUntil: null,
  ...o,
});
const mediaById = new Map<string, MediaRecord>([
  [PNG, record(PNG, {})],
  [
    MP4,
    record(MP4, {
      kind: 'video',
      mimeType: 'video/mp4',
      codec: 'h264',
      durationMs: 6000,
      sha256: 'cd'.repeat(32),
      bytes: 900_000,
    }),
  ],
  [
    HEVC,
    record(HEVC, {
      kind: 'video',
      mimeType: 'video/mp4',
      codec: 'hevc',
      durationMs: 6000,
      sha256: 'ef'.repeat(32),
    }),
  ],
]);
const png = { mediaId: PNG, durationMs: 4000, fit: null };
const mp4 = { mediaId: MP4, durationMs: null, fit: null };

describe('domain publishing is independent of the browser route', () => {
  it('publishes through a test-only route that shares no code with the browser route', () => {
    const fake = createFakeStillImageRoute();
    const plan = planPublication({
      display,
      items: [png],
      mediaById,
      limits: DEFAULT_LIMITS,
      playback: { transition: 'cut', shuffle: false },
      route: fake,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const manifest = buildManifest(plan.draft, {
      publicationId: '33333333-3333-4333-8333-00000000000a',
      createdAt: new Date('2026-11-14T00:00:00Z'),
    });
    const prepared = fake.prepare(manifest);
    expect(prepared).toEqual({ kind: 'fake-package', lines: [`${'ab'.repeat(32)} 4000`] });
    expect(fake.prepared).toEqual([manifest]);
  });

  it('gives a different verdict per route for the same playlist', () => {
    const items = [png, mp4];
    const viaBrowser = planPublication({
      display,
      items,
      mediaById,
      limits: DEFAULT_LIMITS,
      playback: { transition: 'cut', shuffle: false },
      route: createBrowserRoute(),
    });
    const viaFake = planPublication({
      display,
      items,
      mediaById,
      limits: DEFAULT_LIMITS,
      playback: { transition: 'cut', shuffle: false },
      route: createFakeStillImageRoute(),
    });
    expect(viaBrowser.ok).toBe(true);
    expect(viaFake.ok).toBe(false);
    if (viaFake.ok) return;
    expect(viaFake.issues.map((i) => i.code)).toEqual(['unsupported_media_type']);
    expect(viaFake.issues[0]?.message).toContain('The test-only still-image target');
  });

  it('domain source imports only contracts and its own files', () => {
    const domainSrc = join(here, '..', '..', 'domain', 'src');
    const files = readdirSync(domainSrc).filter((f) => f.endsWith('.ts') && !f.includes('.test'));
    expect(files.length).toBeGreaterThan(4);
    const specifiers = new Set<string>();
    for (const file of files) {
      const text = readFileSync(join(domainSrc, file), 'utf8');
      for (const match of text.matchAll(
        /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]/g,
      )) {
        const spec = match[1] ?? match[2] ?? match[3];
        if (spec !== undefined) specifiers.add(spec);
      }
      expect(text, `${file} must not use browser globals`).not.toMatch(
        /\b(window|document|navigator|indexedDB|caches|localStorage)\.[A-Za-z_]/,
      );
    }
    const external = [...specifiers].filter((s) => !s.startsWith('./'));
    expect(external).toEqual(['@tinnox/contracts']);
    const pkg = JSON.parse(readFileSync(join(domainSrc, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@tinnox/contracts']);
  });

  it('the fake is neither exported nor registered, and only the browser route exists', () => {
    expect(Object.keys(deliveryPackage).sort()).toEqual([
      'createBrowserRoute',
      'createDeliveryRegistry',
    ]);
    expect(createDeliveryRegistry().ids()).toEqual(['browser']);
    expect([...DELIVERY_ROUTE_IDS]).toEqual(['browser']);
    const srcFiles = readdirSync(join(here, '..', 'src'), { recursive: true }).map(String);
    for (const f of srcFiles.filter((f) => f.endsWith('.ts'))) {
      expect(readFileSync(join(here, '..', 'src', f), 'utf8')).not.toMatch(/fake/i);
    }
  });
});

describe('browser route', () => {
  const route = createBrowserRoute();

  it('declares the M0 capability profile', () => {
    expect(route.capabilities()).toMatchObject({
      routeId: 'browser',
      profileVersion: 1,
      mediaTypes: ['image/jpeg', 'image/png', 'video/mp4'],
      videoCodecs: ['h264'],
      fitModes: ['contain', 'cover'],
      maxRegions: 1,
      audio: false,
      supportsContentRect: true,
    });
    expect(Object.isFrozen(route.capabilities())).toBe(true);
  });

  it('rejects HEVC with a readable reason', () => {
    const plan = planPublication({
      display,
      items: [{ mediaId: HEVC, durationMs: null, fit: null }],
      mediaById,
      limits: DEFAULT_LIMITS,
      playback: { transition: 'cut', shuffle: false },
      route,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.issues[0]).toMatchObject({ index: 0, code: 'unsupported_codec' });
    expect(plan.issues[0]?.message).toContain('hevc');
  });

  it('honours a lower configured asset size', () => {
    const small = createBrowserRoute({ maxAssetBytes: 100_000 });
    const plan = planPublication({
      display,
      items: [mp4],
      mediaById,
      limits: DEFAULT_LIMITS,
      playback: { transition: 'cut', shuffle: false },
      route: small,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.issues.map((i) => i.code)).toEqual(['asset_too_large']);
  });

  it('prepares a pull publication with the publication id as ETag and does not alter the manifest', () => {
    const plan = planPublication({
      display,
      items: [png, mp4],
      mediaById,
      limits: DEFAULT_LIMITS,
      playback: { transition: 'cut', shuffle: false },
      route,
    });
    if (!plan.ok) throw new Error('expected ok');
    const manifest = buildManifest(plan.draft, {
      publicationId: '33333333-3333-4333-8333-00000000000b',
      createdAt: new Date('2026-11-14T00:00:00Z'),
    });
    const before = JSON.stringify(manifest);
    const prepared = route.prepare(manifest);
    expect(prepared.kind).toBe('pull');
    expect(prepared.etag).toBe('"33333333-3333-4333-8333-00000000000b"');
    expect(JSON.stringify(prepared.manifest)).toBe(before);
  });

  it('normalises a valid heartbeat and labels it as player-software evidence', () => {
    const report: HeartbeatV1 = {
      schemaVersion: 1,
      seq: 3,
      sentAt: '2026-11-14T00:00:00.000Z',
      displayId: display.id,
      downloadedPublicationId: null,
      activePublicationId: null,
      activeItemIndex: null,
      playerState: 'idle',
      staging: null,
      errors: [],
      player: { version: '0.0.0', storagePersisted: null, online: true },
    };
    expect(route.normalizeStatus(report)).toEqual({
      ok: true,
      report,
      evidence: 'player_software',
    });
  });

  it('rejects malformed, oversized and inconsistent reports', () => {
    expect(route.normalizeStatus(null).ok).toBe(false);
    expect(route.normalizeStatus({ schemaVersion: 2 }).ok).toBe(false);
    const base = {
      schemaVersion: 1,
      seq: 1,
      sentAt: '2026-11-14T00:00:00.000Z',
      displayId: display.id,
      downloadedPublicationId: null,
      activePublicationId: null,
      activeItemIndex: null,
      playerState: 'idle',
      staging: null,
      errors: [],
      player: { version: '0', storagePersisted: null, online: true },
    };
    expect(route.normalizeStatus({ ...base, playerState: 'playing' }).ok).toBe(false);
    expect(route.normalizeStatus({ ...base, seq: -1 }).ok).toBe(false);
    expect(route.normalizeStatus({ ...base, extra: 'field' }).ok).toBe(false);
    const error = {
      code: 'playback_error',
      message: 'm',
      at: '2026-11-14T00:00:00.000Z',
      publicationId: null,
      assetId: null,
    };
    expect(
      route.normalizeStatus({ ...base, errors: Array.from({ length: 11 }, () => error) }).ok,
    ).toBe(false);
    expect(
      route.normalizeStatus({ ...base, errors: [{ ...error, message: 'x'.repeat(301) }] }).ok,
    ).toBe(false);
  });

  it('refuses a route id that has no implementation', () => {
    expect(() => createDeliveryRegistry().get('novastar' as never)).toThrow(/no delivery route/);
  });
});
