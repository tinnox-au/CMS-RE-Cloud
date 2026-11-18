// In-memory stand-ins for the browser storage and the player API, with failure injection.
// Used only by unit tests.
import type {
  Manifest,
  ManifestAppItem,
  ManifestAssetV1,
  ManifestScheduleEvent,
  ManifestV1,
  ManifestV2,
  ManifestV3,
  ManifestV4,
  ManifestV5,
  MediaUrlsResponse,
  PlayerError,
  Rect,
  Transition,
} from '@tinnox/contracts';
import { AbortedError, PlayerFault, RevokedError } from './errors.ts';
import type {
  ActiveVersion,
  AssetStore,
  DeviceApi,
  ManifestFetchResult,
  MediaResponse,
  PairingRecord,
  RegistrationRecord,
  Sleep,
  StagingRecord,
  StateStore,
  StorageEstimate,
} from './types.ts';

export const API_ORIGIN = 'http://api.test';

export async function sha256Of(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function digestBlob(blob: Blob): Promise<string> {
  return sha256Of(new Uint8Array(await blob.arrayBuffer()));
}

export function bytesOf(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (seed * 31 + i * 7) % 251;
  return out;
}

export interface TestAsset {
  readonly asset: ManifestAssetV1;
  readonly data: Uint8Array<ArrayBuffer>;
}

export async function makeAsset(
  seed: number,
  options: { length?: number; kind?: 'image' | 'video'; durationMs?: number } = {},
): Promise<TestAsset> {
  const data = bytesOf(options.length ?? 64, seed);
  const kind = options.kind ?? 'image';
  return {
    data,
    asset: {
      assetId: crypto.randomUUID(),
      mediaType: kind === 'image' ? 'image/png' : 'video/mp4',
      kind,
      bytes: data.byteLength,
      sha256: await sha256Of(data),
      durationMs: options.durationMs ?? 5_000,
      fit: 'contain',
      width: 640,
      height: 360,
    },
  };
}

export const DISPLAY_ID = '0b5d7c1e-3f0a-4c58-9a51-6f2f6f3d9a01';
export const REGISTRATION_ID = '7e0f8d55-0d0b-4d0e-8b53-0f7f2b1c2a02';
export const ORG_ID = '5c0f6a11-9d57-4a36-8a9e-2d1e4c7b3a03';

export function makeManifest(
  assets: readonly ManifestAssetV1[],
  overrides: Partial<ManifestV1> = {},
): ManifestV1 {
  return {
    schemaVersion: 1,
    publicationId: crypto.randomUUID(),
    displayId: DISPLAY_ID,
    createdAt: '2026-11-14T01:00:00.000Z',
    canvas: { width: 1920, height: 1080 },
    contentRect: null,
    muted: true,
    assets: [...assets],
    ...overrides,
  };
}

/** A v2 manifest with every option at its default and no windows, unless overridden. */
export function makeManifestV2(
  assets: readonly ManifestAssetV1[],
  overrides: Partial<ManifestV2> = {},
): ManifestV2 {
  return {
    ...makeManifest([]),
    schemaVersion: 2,
    timeZone: 'Australia/Melbourne',
    transition: 'cut',
    shuffle: false,
    rotation: 0,
    workingHours: null,
    assets: assets.map((asset) => ({ ...asset, availableFrom: null, availableUntil: null })),
    ...overrides,
  };
}

/** A Clock app item (12-hour, white on black). */
export function makeAppItem(durationMs = 10_000): ManifestAppItem {
  return {
    kind: 'app',
    appId: crypto.randomUUID(),
    durationMs,
    content: {
      type: 'clock',
      settings: {
        hourCycle: '12',
        showSeconds: false,
        textColour: '#ffffff',
        backgroundColour: '#000000',
      },
    },
  };
}

/** A v3 manifest (v2 defaults plus app items); media items get no windows. */
export function makeManifestV3(
  items: readonly (ManifestAssetV1 | ManifestAppItem)[],
  overrides: Partial<ManifestV3> = {},
): ManifestV3 {
  return {
    ...makeManifestV2([]),
    schemaVersion: 3,
    assets: items.map((item) =>
      item.kind === 'app' ? item : { ...item, availableFrom: null, availableUntil: null },
    ),
    ...overrides,
  };
}

/** One playlist of a v4 test manifest; cut and listed order unless said otherwise. */
export interface TestPlaylist {
  readonly items: readonly (ManifestAssetV1 | ManifestAppItem)[];
  readonly transition?: Transition;
  readonly shuffle?: boolean;
}

/** All seven days of a schedule event, Monday first. */
export const EVERY_DAY: boolean[] = [true, true, true, true, true, true, true];

/**
 * A v4 manifest (v3 defaults plus a schedule). `playlists[0]` is the default playlist; an
 * event's `playlist` is an index into `playlists`. Media items get no windows.
 */
export function makeManifestV4(
  playlists: readonly TestPlaylist[],
  events: readonly ManifestScheduleEvent[],
  overrides: Partial<ManifestV4> = {},
): ManifestV4 {
  return {
    ...makeManifestV3(playlists.flatMap((playlist) => playlist.items)),
    schemaVersion: 4,
    transition: playlists[0]?.transition ?? 'cut',
    shuffle: playlists[0]?.shuffle ?? false,
    schedule: {
      playlists: playlists.map((playlist) => ({
        count: playlist.items.length,
        transition: playlist.transition ?? 'cut',
        shuffle: playlist.shuffle ?? false,
      })),
      events: events.map((event) => ({ ...event, days: [...event.days] })),
    },
    ...overrides,
  };
}

/** One zone of a v5 test manifest: its rectangle in canvas pixels and its playlist. */
export interface TestZone extends TestPlaylist {
  readonly rect: Rect;
}

/** A v5 manifest (v3 defaults plus zones); `zones[0]` is the main zone. Media items get no windows. */
export function makeManifestV5(
  zones: readonly TestZone[],
  overrides: Partial<ManifestV5> = {},
): ManifestV5 {
  return {
    ...makeManifestV3(zones.flatMap((zone) => zone.items)),
    schemaVersion: 5,
    transition: zones[0]?.transition ?? 'cut',
    shuffle: zones[0]?.shuffle ?? false,
    zones: zones.map((zone) => ({
      rect: zone.rect,
      count: zone.items.length,
      transition: zone.transition ?? 'cut',
      shuffle: zone.shuffle ?? false,
    })),
    ...overrides,
  };
}

export function makeRegistration(overrides: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return {
    registrationId: REGISTRATION_ID,
    orgId: ORG_ID,
    deviceToken: 'A'.repeat(43),
    display: {
      id: DISPLAY_ID,
      name: 'Test display',
      canvas: { width: 1920, height: 1080 },
      contentRect: null,
    },
    pairedAt: '2026-11-14T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

type StoreMethod = keyof StateStore;

export class MemoryStateStore implements StateStore {
  registration: RegistrationRecord | null = makeRegistration();
  active: ActiveVersion | null = null;
  staging: StagingRecord | null = null;
  seq = 0;
  errors: PlayerError[] = [];
  pairing: PairingRecord | null = null;
  /** Methods that throw when called. */
  readonly failing = new Set<StoreMethod>();
  /** Number of putStaging calls allowed before it starts failing; null = never fails by count. */
  failPutStagingAfter: number | null = null;
  putStagingCalls = 0;

  #guard(method: StoreMethod): void {
    if (this.failing.has(method)) throw new Error(`injected failure: ${method}`);
  }

  async getRegistration(): Promise<RegistrationRecord | null> {
    this.#guard('getRegistration');
    return this.registration;
  }
  async replaceRegistration(registration: RegistrationRecord): Promise<void> {
    this.#guard('replaceRegistration');
    this.registration = registration;
    this.active = null;
    this.staging = null;
    this.pairing = null;
    this.errors = [];
    this.seq = 0;
  }
  async markRevoked(at: string): Promise<void> {
    this.#guard('markRevoked');
    if (this.registration !== null) {
      this.registration = { ...this.registration, deviceToken: null, revokedAt: at };
    }
    this.active = null;
    this.staging = null;
  }
  async getActive(): Promise<ActiveVersion | null> {
    this.#guard('getActive');
    return this.active;
  }
  async getStaging(): Promise<StagingRecord | null> {
    this.#guard('getStaging');
    return this.staging;
  }
  async putStaging(record: StagingRecord): Promise<void> {
    this.#guard('putStaging');
    this.putStagingCalls += 1;
    if (this.failPutStagingAfter !== null && this.putStagingCalls > this.failPutStagingAfter) {
      throw new Error('injected failure: putStaging');
    }
    this.staging = record;
  }
  async clearStaging(): Promise<void> {
    this.#guard('clearStaging');
    this.staging = null;
  }
  async activate(registrationId: string, manifest: Manifest, at: string): Promise<boolean> {
    this.#guard('activate');
    if (
      this.registration === null ||
      this.registration.registrationId !== registrationId ||
      this.registration.revokedAt !== null
    ) {
      return false;
    }
    this.active = { manifest, activatedAt: at };
    this.staging = null;
    return true;
  }
  async nextHeartbeatSeq(nowMs: number): Promise<number> {
    this.#guard('nextHeartbeatSeq');
    this.seq = Math.max(this.seq + 1, Math.floor(nowMs));
    return this.seq;
  }
  async getErrors(): Promise<PlayerError[]> {
    return this.errors;
  }
  async putErrors(errors: readonly PlayerError[]): Promise<void> {
    this.errors = [...errors];
  }
  async getPairing(): Promise<PairingRecord | null> {
    return this.pairing;
  }
  async putPairing(record: PairingRecord): Promise<void> {
    this.pairing = record;
  }
  async clearPairing(): Promise<void> {
    this.pairing = null;
  }
}

export class MemoryAssetStore implements AssetStore {
  readonly blobs = new Map<string, Blob>();
  quota: number | null = null;
  /** `quota` makes put() fail like a browser out of space; `error` like a broken disk. */
  putFailure: 'quota' | 'error' | null = null;
  deleted: string[] = [];

  seed(asset: TestAsset): void {
    this.blobs.set(asset.asset.sha256, new Blob([asset.data], { type: asset.asset.mediaType }));
  }
  async has(sha256: string, bytes: number): Promise<boolean> {
    return this.blobs.get(sha256)?.size === bytes;
  }
  async put(sha256: string, _mediaType: string, blob: Blob): Promise<void> {
    if (this.putFailure === 'quota')
      throw new PlayerFault('quota_exceeded', 'injected: quota reached');
    if (this.putFailure === 'error')
      throw new PlayerFault('storage_error', 'injected: write failed');
    this.blobs.set(sha256, blob);
  }
  async getBlob(sha256: string): Promise<Blob | null> {
    return this.blobs.get(sha256) ?? null;
  }
  async list(): Promise<string[]> {
    return [...this.blobs.keys()];
  }
  async delete(sha256: string): Promise<void> {
    this.deleted.push(sha256);
    this.blobs.delete(sha256);
  }
  async estimate(): Promise<StorageEstimate | null> {
    if (this.quota === null) return null;
    let usage = 0;
    for (const blob of this.blobs.values()) usage += blob.size;
    return { usage, quota: this.quota };
  }
}

async function* chunked(
  data: Uint8Array<ArrayBuffer>,
  size: number,
  breakAfter: number | null,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  let sent = 0;
  for (let offset = 0; offset < data.byteLength; offset += size) {
    if (breakAfter !== null && sent >= breakAfter) throw new Error('connection reset');
    const chunk = data.slice(offset, Math.min(offset + size, data.byteLength));
    sent += chunk.byteLength;
    yield chunk;
  }
  if (breakAfter !== null && sent >= breakAfter && breakAfter < data.byteLength) {
    throw new Error('connection reset');
  }
}

export type MediaBehaviour =
  /** Serve the right bytes, honouring Range. */
  | { readonly kind: 'ok' }
  /** Serve the right bytes but always from the start with 200, ignoring Range. */
  | { readonly kind: 'ignore_range' }
  /** Answer with this status and no body. */
  | { readonly kind: 'status'; readonly status: number }
  /** Start correctly, then break the connection after `after` bytes of this response. */
  | { readonly kind: 'break'; readonly after: number }
  /** Serve these bytes instead of the right ones (corruption, truncation, excess). */
  | { readonly kind: 'bytes'; readonly data: Uint8Array<ArrayBuffer> }
  /** Reject the request (no connection). */
  | { readonly kind: 'unreachable' };

export class FakeDeviceApi implements DeviceApi {
  readonly media = new Map<string, Uint8Array<ArrayBuffer>>();
  /** Per asset: behaviours consumed one per request; when empty, `ok`. */
  readonly script = new Map<string, MediaBehaviour[]>();
  manifestResults: (ManifestFetchResult | Error)[] = [];
  /** Used when `manifestResults` is empty. */
  defaultManifestResult: ManifestFetchResult = { kind: 'not_modified' };
  mediaUrlsFailure: Error | null = null;
  urlOrigin = API_ORIGIN;
  urlLifetimeMs = 300_000;
  now: () => number = () => Date.now();
  /** URLs issued before the last invalidate() answer 401. */
  #generation = 0;
  readonly calls = {
    fetchManifest: [] as (string | null)[],
    requestMediaUrls: [] as string[][],
    fetchMedia: [] as { assetId: string; rangeStart: number | null }[],
  };

  serve(asset: TestAsset): void {
    this.media.set(asset.asset.assetId, asset.data);
  }

  /** Makes every URL issued so far unusable, as if it had expired. */
  invalidateUrls(): void {
    this.#generation += 1;
  }

  async fetchManifest(ifNoneMatchPublicationId: string | null): Promise<ManifestFetchResult> {
    this.calls.fetchManifest.push(ifNoneMatchPublicationId);
    const next = this.manifestResults.shift() ?? this.defaultManifestResult;
    if (next instanceof Error) throw next;
    return next;
  }

  async requestMediaUrls(
    publicationId: string,
    assetIds: readonly string[],
  ): Promise<MediaUrlsResponse> {
    this.calls.requestMediaUrls.push([...assetIds]);
    if (this.mediaUrlsFailure !== null) throw this.mediaUrlsFailure;
    return {
      publicationId,
      urls: assetIds.map((assetId) => ({
        assetId,
        url: `${this.urlOrigin}/player/media/${assetId}?gen=${this.#generation}`,
        expiresAt: new Date(this.now() + this.urlLifetimeMs).toISOString(),
      })),
    };
  }

  async fetchMedia(
    url: string,
    rangeStart: number | null,
    signal: AbortSignal,
  ): Promise<MediaResponse> {
    if (signal.aborted) throw new AbortedError();
    const parsed = new URL(url);
    const assetId = parsed.pathname.split('/').pop() ?? '';
    this.calls.fetchMedia.push({ assetId, rangeStart });
    const respond = (
      status: number,
      data: Uint8Array<ArrayBuffer>,
      start: number | null,
      breakAfter: number | null = null,
    ): MediaResponse => ({
      status,
      rangeStart: start,
      retryAfterMs: null,
      chunks: chunked(data, 16, breakAfter),
      cancel: () => undefined,
    });
    if (Number(parsed.searchParams.get('gen')) !== this.#generation) {
      return respond(401, new Uint8Array(0), null);
    }
    const behaviour = this.script.get(assetId)?.shift() ?? { kind: 'ok' };
    const full = this.media.get(assetId);
    if (behaviour.kind === 'unreachable')
      throw new PlayerFault('network_error', 'injected: unreachable');
    if (behaviour.kind === 'status') return respond(behaviour.status, new Uint8Array(0), null);
    if (behaviour.kind === 'bytes') return respond(200, behaviour.data, null);
    if (full === undefined) return respond(404, new Uint8Array(0), null);
    if (behaviour.kind === 'ignore_range' || rangeStart === null) {
      return respond(200, full, null, behaviour.kind === 'break' ? behaviour.after : null);
    }
    return respond(
      206,
      full.slice(rangeStart),
      rangeStart,
      behaviour.kind === 'break' ? behaviour.after : null,
    );
  }
}

export function revoked(): RevokedError {
  return new RevokedError();
}

/** A sleep that returns at once and records what was asked for. */
export function instantSleep(): Sleep & { readonly delays: number[] } {
  const delays: number[] = [];
  const fn: Sleep = async (ms, signal) => {
    if (signal?.aborted === true) throw new AbortedError();
    delays.push(ms);
  };
  return Object.assign(fn, { delays });
}
