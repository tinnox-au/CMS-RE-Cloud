import type { HeartbeatV1 } from '@tinnox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadAsset } from './download.ts';
import { PlayerFault } from './errors.ts';
import { MAX_RETRY_AFTER_MS, parseRetryAfter } from './retry-after.ts';
import {
  DISPLAY_ID,
  makeAsset,
  MemoryAssetStore,
  MemoryStateStore,
  REGISTRATION_ID,
  type TestAsset,
} from './fakes.test-support.ts';
import { HeartbeatLoop, type HeartbeatSnapshot } from './heartbeat.ts';
import { SyncLoop, type SyncDeps } from './sync.ts';
import { sleep } from './timing.ts';
import { PlayerHttpApi } from '../platform/api.ts';

const ORIGIN = 'http://api.test';
const TOKEN = 'T'.repeat(43);
const NOW = '2026-11-14T03:00:00.000Z';

const HEARTBEAT_OK = {
  accepted: true,
  ignoredReason: null,
  desiredPublicationId: null,
  serverTime: NOW,
  nextHeartbeatInMs: 15_000,
};

function httpDateIn(ms: number): string {
  return new Date(Date.now() + ms).toUTCString();
}

/**
 * Runs `start` (one request is in flight or just finished) and checks the next
 * request waits out a 30 s Retry-After. `poke` is a wake that must not shorten it.
 */
async function expectHeldFor30s(
  start: () => { calls: () => number; poke?: () => void },
): Promise<void> {
  const handle = start();
  await vi.advanceTimersByTimeAsync(0);
  expect(handle.calls()).toBe(1);
  for (let second = 0; second < 29; second += 1) {
    handle.poke?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handle.calls(), `retried after ${second + 1} s`).toBe(1);
  }
  handle.poke?.();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(handle.calls()).toBe(2);
}

describe('parseRetryAfter', () => {
  const now = Date.parse(NOW);
  it('reads delay-seconds and an HTTP-date, and caps a huge delay', () => {
    expect(parseRetryAfter('0', now)).toBe(0);
    expect(parseRetryAfter(' 12 ', now)).toBe(12_000);
    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter(new Date(now + 30_000).toUTCString(), now)).toBe(30_000);
    expect(parseRetryAfter(new Date(now - 3_600_000).toUTCString(), now)).toBe(0);
    expect(parseRetryAfter('99999999', now)).toBe(MAX_RETRY_AFTER_MS);
    for (const bad of [null, '', '-3', '1.5', 'soon', '12abc']) {
      expect(parseRetryAfter(bad, now), String(bad)).toBeNull();
    }
  });
});

describe('Retry-After on 429 (FCX-06)', () => {
  let abort: AbortController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    abort = new AbortController();
  });
  afterEach(() => {
    abort.abort();
    vi.useRealTimers();
  });

  function throttledFetch(
    header: string,
    ok: () => Response,
  ): {
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
    calls: () => number;
  } {
    let calls = 0;
    return {
      calls: () => calls,
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response('{}', { status: 429, headers: { 'retry-after': header } });
        }
        return ok();
      },
    };
  }

  function heartbeat(header: string): { calls: () => number; poke: () => void } {
    const transport = throttledFetch(
      header,
      () => new Response(JSON.stringify(HEARTBEAT_OK), { status: 200 }),
    );
    const device = new PlayerHttpApi(ORIGIN, transport.fetch).forDevice(TOKEN);
    const snapshot: HeartbeatSnapshot = {
      displayId: DISPLAY_ID,
      downloadedPublicationId: null,
      rendering: null,
      playerState: 'idle',
      staging: null,
      errors: [],
      version: 'player-web/test',
      storagePersisted: false,
      online: true,
    };
    const loop = new HeartbeatLoop({
      state: new MemoryStateStore(),
      snapshot: async () => snapshot,
      send: (body: HeartbeatV1) => device.heartbeat(body),
      clock: { now: () => Date.now() },
      sleep,
      // Upper edge of the jitter: ordinary backoff is 5 s, still under 30 s.
      random: () => 1,
      signal: abort.signal,
      onRevoked: () => undefined,
    });
    loop.start();
    return { calls: transport.calls, poke: () => loop.notifyChange() };
  }

  function sync(header: string): { calls: () => number; poke: () => void } {
    const transport = throttledFetch(header, () => new Response(null, { status: 204 }));
    const device = new PlayerHttpApi(ORIGIN, transport.fetch).forDevice(TOKEN);
    const deps: SyncDeps = {
      registrationId: REGISTRATION_ID,
      displayId: DISPLAY_ID,
      apiOrigin: ORIGIN,
      state: new MemoryStateStore(),
      assets: new MemoryAssetStore(),
      api: device,
      digest: async () => 'ab',
      probe: async () => undefined,
      inUse: () => new Set(),
      clock: { now: () => Date.now() },
      sleep,
      random: () => 1,
      signal: abort.signal,
      report: () => undefined,
    };
    const loop = new SyncLoop(deps, { onRevoked: () => undefined, onActivated: () => undefined });
    loop.start();
    return { calls: transport.calls, poke: () => loop.wake() };
  }

  it('does not retry a heartbeat 429 before Retry-After: 30, even when woken', async () => {
    await expectHeldFor30s(() => heartbeat('30'));
  });

  it('does not retry a heartbeat 429 before an HTTP-date Retry-After', async () => {
    await expectHeldFor30s(() => heartbeat(httpDateIn(30_000)));
  });

  it('does not retry a manifest 429 before Retry-After: 30, even when woken', async () => {
    await expectHeldFor30s(() => sync('30'));
  });

  it('does not retry a manifest 429 before an HTTP-date Retry-After', async () => {
    await expectHeldFor30s(() => sync(httpDateIn(30_000)));
  });

  it('caps a huge Retry-After at 10 minutes', async () => {
    const handle = heartbeat('99999999');
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(MAX_RETRY_AFTER_MS - 1);
    expect(handle.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(handle.calls()).toBe(2);
  });

  async function asset(): Promise<TestAsset> {
    return makeAsset(1, { length: 4 });
  }

  it('does not ask for media URLs again before Retry-After: 30', async () => {
    const item = await asset();
    const publicationId = crypto.randomUUID();
    let calls = 0;
    const device = new PlayerHttpApi(ORIGIN, async (url) => {
      if (url.endsWith('/player/media-urls')) {
        calls += 1;
        if (calls === 1) {
          return new Response('{}', { status: 429, headers: { 'retry-after': '30' } });
        }
        return new Response(
          JSON.stringify({
            publicationId,
            urls: [
              {
                assetId: item.asset.assetId,
                url: `${ORIGIN}/player/media/${item.asset.assetId}`,
                expiresAt: '2026-11-14T03:05:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(item.data, { status: 200 });
    }).forDevice(TOKEN);
    const pending = downloadAsset(item.asset, {
      getUrl: async () => {
        const response = await device.requestMediaUrls(publicationId, [item.asset.assetId]);
        const url = response.urls[0]?.url;
        if (url === undefined) throw new PlayerFault('download_failed', 'no url');
        return url;
      },
      fetchMedia: (url, range, signal) => device.fetchMedia(url, range, signal),
      sleep,
      random: () => 1,
      signal: abort.signal,
    });
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(calls).toBe(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(calls).toBe(2);
    expect(settled).toBe(true);
  });

  it('does not repeat a media download before an HTTP-date Retry-After', async () => {
    const item = await asset();
    const publicationId = crypto.randomUUID();
    let downloads = 0;
    const device = new PlayerHttpApi(ORIGIN, async (url) => {
      if (url.endsWith('/player/media-urls')) {
        return new Response(
          JSON.stringify({
            publicationId,
            urls: [
              {
                assetId: item.asset.assetId,
                url: `${ORIGIN}/player/media/${item.asset.assetId}`,
                expiresAt: '2026-11-14T03:05:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }
      downloads += 1;
      if (downloads === 1) {
        return new Response(null, {
          status: 429,
          headers: { 'retry-after': httpDateIn(30_000) },
        });
      }
      return new Response(item.data, { status: 200 });
    }).forDevice(TOKEN);
    const pending = downloadAsset(item.asset, {
      getUrl: async () => {
        const response = await device.requestMediaUrls(publicationId, [item.asset.assetId]);
        const url = response.urls[0]?.url;
        if (url === undefined) throw new PlayerFault('download_failed', 'no url');
        return url;
      },
      fetchMedia: (url, range, signal) => device.fetchMedia(url, range, signal),
      sleep,
      random: () => 1,
      signal: abort.signal,
    });
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(downloads).toBe(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(downloads).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(downloads).toBe(2);
    expect(settled).toBe(true);
  });
});
