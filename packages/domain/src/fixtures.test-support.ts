import { DEFAULT_LIMITS, type HeartbeatV1, type Limits } from '@tinnox/contracts';
import type { DisplayTarget, MediaRecord } from './types.ts';

export const limits: Limits = DEFAULT_LIMITS;

export const ID = {
  display: '11111111-1111-4111-8111-111111111111',
  otherDisplay: '11111111-1111-4111-8111-222222222222',
  jpeg: '22222222-2222-4222-8222-000000000001',
  png: '22222222-2222-4222-8222-000000000002',
  video: '22222222-2222-4222-8222-000000000003',
  processing: '22222222-2222-4222-8222-000000000004',
  failed: '22222222-2222-4222-8222-000000000005',
  hevc: '22222222-2222-4222-8222-000000000006',
  pubA: '33333333-3333-4333-8333-00000000000a',
  pubB: '33333333-3333-4333-8333-00000000000b',
  regA: '44444444-4444-4444-8444-00000000000a',
  regB: '44444444-4444-4444-8444-00000000000b',
} as const;

export function display(overrides: Partial<DisplayTarget> = {}): DisplayTarget {
  return {
    id: ID.display,
    canvas: { width: 1920, height: 1080 },
    contentRect: null,
    defaultFit: 'contain',
    route: 'browser',
    ...overrides,
  };
}

function media(id: string, overrides: Partial<MediaRecord>): MediaRecord {
  return {
    id,
    kind: 'image',
    status: 'ready',
    mimeType: 'image/jpeg',
    bytes: 120_000,
    sha256: id.replace(/-/g, '').padEnd(64, 'a'),
    width: 1600,
    height: 900,
    durationMs: null,
    codec: null,
    ...overrides,
  };
}

export function library(): Map<string, MediaRecord> {
  const records = [
    media(ID.jpeg, {}),
    media(ID.png, { mimeType: 'image/png', width: 640, height: 1344, bytes: 300_000 }),
    media(ID.video, {
      kind: 'video',
      mimeType: 'video/mp4',
      codec: 'h264',
      durationMs: 12_500,
      width: 1920,
      height: 1080,
      bytes: 4_000_000,
    }),
    media(ID.processing, {
      status: 'processing',
      mimeType: null,
      bytes: null,
      sha256: null,
      width: null,
      height: null,
    }),
    media(ID.failed, {
      status: 'failed',
      mimeType: null,
      bytes: null,
      sha256: null,
      width: null,
      height: null,
    }),
    media(ID.hevc, {
      kind: 'video',
      mimeType: 'video/mp4',
      codec: 'hevc',
      durationMs: 8_000,
      width: 1920,
      height: 1080,
    }),
  ];
  return new Map(records.map((r) => [r.id, r]));
}

export function heartbeat(overrides: Partial<HeartbeatV1> = {}): HeartbeatV1 {
  return {
    schemaVersion: 1,
    seq: 1,
    sentAt: '2026-11-14T00:00:00.000Z',
    displayId: ID.display,
    downloadedPublicationId: ID.pubA,
    activePublicationId: ID.pubA,
    activeItemIndex: 0,
    playerState: 'playing',
    staging: null,
    errors: [],
    player: { version: 'test', storagePersisted: true, online: true },
    ...overrides,
  };
}
