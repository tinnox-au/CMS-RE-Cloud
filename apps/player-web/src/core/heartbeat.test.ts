import { HeartbeatV1Schema, type HeartbeatResponse, type HeartbeatV1 } from '@tinnox/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorLog, PlayerFault, RevokedError, sanitiseMessage, toPlayerError } from './errors.ts';
import { DISPLAY_ID, makeAsset, makeManifest, MemoryStateStore } from './fakes.test-support.ts';
import { buildHeartbeat, HeartbeatLoop, type HeartbeatSnapshot } from './heartbeat.ts';
import { sleep } from './timing.ts';

const PUB = '3b1e0f8a-7c2d-4e5f-9a6b-1c2d3e4f5a6b';

function snapshot(overrides: Partial<HeartbeatSnapshot> = {}): HeartbeatSnapshot {
  return {
    displayId: DISPLAY_ID,
    downloadedPublicationId: PUB,
    rendering: { publicationId: PUB, itemIndex: 2 },
    playerState: 'playing',
    staging: null,
    errors: [],
    version: 'player-web/test',
    storagePersisted: false,
    online: true,
    ...overrides,
  };
}

describe('buildHeartbeat', () => {
  it('produces a report the shared schema accepts', () => {
    const hb = buildHeartbeat(snapshot(), 42, '2026-11-14T03:00:00.000Z');
    expect(HeartbeatV1Schema.safeParse(hb).success).toBe(true);
    expect(hb).toMatchObject({
      seq: 42,
      displayId: DISPLAY_ID,
      downloadedPublicationId: PUB,
      activePublicationId: PUB,
      activeItemIndex: 2,
      playerState: 'playing',
    });
  });

  it('never claims to be playing with nothing on screen', () => {
    const hb = buildHeartbeat(snapshot({ rendering: null }), 1, '2026-11-14T03:00:00.000Z');
    expect(hb.playerState).toBe('idle');
    expect(hb.activePublicationId).toBeNull();
    expect(hb.activeItemIndex).toBeNull();
    // Downloaded and on-screen are reported independently.
    expect(hb.downloadedPublicationId).toBe(PUB);
  });

  it('reports the error state and an update in progress', async () => {
    const manifest = makeManifest([(await makeAsset(1)).asset]);
    const hb = buildHeartbeat(
      snapshot({
        rendering: null,
        playerState: 'error',
        staging: { manifest, phase: 'downloading', assetsDone: 0, assetsTotal: 1 },
      }),
      1,
      '2026-11-14T03:00:00.000Z',
    );
    expect(hb.playerState).toBe('error');
    expect(hb.staging).toEqual({
      publicationId: manifest.publicationId,
      phase: 'downloading',
      assetsDone: 0,
      assetsTotal: 1,
    });
  });
});

describe('error list', () => {
  const at = '2026-11-14T03:00:00.000Z';
  it('is bounded, newest first', () => {
    const log = new ErrorLog();
    for (let i = 0; i < 40; i += 1) {
      log.add({
        code: i % 2 === 0 ? 'network_error' : 'download_failed',
        message: `n${i}`,
        at,
        publicationId: null,
        assetId: null,
      });
    }
    expect(log.list()).toHaveLength(10);
    expect(log.list()[0]?.message).toBe('n39');
    expect(
      HeartbeatV1Schema.safeParse(buildHeartbeat(snapshot({ errors: log.list() }), 1, at)).success,
    ).toBe(true);
  });

  it('collapses a repeating problem into one entry', () => {
    const log = new ErrorLog();
    for (let i = 0; i < 100; i += 1) {
      log.add({
        code: 'network_error',
        message: `attempt ${i}`,
        at,
        publicationId: null,
        assetId: null,
      });
    }
    expect(log.list()).toHaveLength(1);
    expect(log.list()[0]?.message).toBe('attempt 99');
  });

  it('never carries a URL, a signature or a token', () => {
    const token = 'k'.repeat(43);
    const text = sanitiseMessage(
      `GET http://localhost:4000/player/media/abc?exp=1&sig=${token} failed; bearer ${token}; blob:http://x/1`,
    );
    expect(text).not.toContain('http');
    expect(text).not.toContain('sig=');
    expect(text).not.toContain(token);
    expect(text).not.toContain('blob:');
    const error = toPlayerError(new Error(`fetch https://api.example/x?sig=${token}`), {
      at,
      publicationId: null,
    });
    expect(error.message).toBe('fetch [url]');
  });

  it('bounds the message length', () => {
    expect(sanitiseMessage('x '.repeat(1000)).length).toBeLessThanOrEqual(300);
  });

  it('maps faults and quota errors to protocol codes', () => {
    expect(
      toPlayerError(new PlayerFault('decode_failed', 'm', { assetId: 'a' }), {
        at,
        publicationId: 'p',
      }),
    ).toMatchObject({
      code: 'decode_failed',
      assetId: 'a',
      publicationId: 'p',
    });
    const quota = new Error('full');
    quota.name = 'QuotaExceededError';
    expect(toPlayerError(quota, { at, publicationId: null }).code).toBe('quota_exceeded');
    expect(toPlayerError('odd', { at, publicationId: null }).code).toBe('internal_error');
  });
});

describe('HeartbeatLoop', () => {
  let abort: AbortController;
  let state: MemoryStateStore;
  let sent: HeartbeatV1[];
  let failWith: Error | null;
  let current: HeartbeatSnapshot | null;
  let revoked: number;

  const response = (next = 15_000): HeartbeatResponse => ({
    accepted: true,
    ignoredReason: null,
    desiredPublicationId: PUB,
    serverTime: '2026-11-14T03:00:00.000Z',
    nextHeartbeatInMs: next,
  });

  function loop(): HeartbeatLoop {
    return new HeartbeatLoop({
      state,
      snapshot: async () => current,
      send: async (hb) => {
        if (failWith !== null) throw failWith;
        sent.push(hb);
        return response();
      },
      clock: { now: () => Date.now() },
      sleep,
      random: () => 0.5,
      signal: abort.signal,
      onRevoked: () => {
        revoked += 1;
      },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T03:00:00.000Z'));
    abort = new AbortController();
    state = new MemoryStateStore();
    sent = [];
    failWith = null;
    current = snapshot();
    revoked = 0;
  });
  afterEach(() => {
    abort.abort();
    vi.useRealTimers();
  });

  it('sends at once, then every interval, with strictly increasing seq', async () => {
    loop().start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sent).toHaveLength(3);
    const seqs = sent.map((h) => h.seq);
    expect(seqs[1]!).toBeGreaterThan(seqs[0]!);
    expect(seqs[2]!).toBeGreaterThan(seqs[1]!);
  });

  it('keeps seq increasing across a restart and when the clock steps back', async () => {
    const a = await state.nextHeartbeatSeq(Date.now());
    const b = await state.nextHeartbeatSeq(Date.now());
    const c = await state.nextHeartbeatSeq(Date.now() - 3_600_000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('reports a state change soon, but not more often than the minimum gap', async () => {
    const l = loop();
    l.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    for (let i = 0; i < 20; i += 1) l.notifyChange();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
  });

  it('queues nothing while offline and sends only the current state on reconnect', async () => {
    const l = loop();
    l.start();
    await vi.advanceTimersByTimeAsync(0);
    failWith = new PlayerFault('network_error', 'heartbeat: server unreachable');
    // Ten minutes offline with many state changes.
    for (let i = 0; i < 60; i += 1) {
      current = snapshot({ rendering: { publicationId: PUB, itemIndex: i % 3 } });
      l.notifyChange();
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(sent).toHaveLength(1);
    expect(l.status.consecutiveFailures).toBeGreaterThan(3);
    failWith = null;
    current = snapshot({ rendering: { publicationId: PUB, itemIndex: 7 } });
    await vi.advanceTimersByTimeAsync(60_000);
    // Exactly the reports made after reconnecting; each shows the state at send time.
    const afterReconnect = sent.slice(1);
    expect(afterReconnect.length).toBeGreaterThanOrEqual(1);
    expect(afterReconnect.length).toBeLessThanOrEqual(5);
    expect(afterReconnect.every((h) => h.activeItemIndex === 7)).toBe(true);
    expect(l.status.consecutiveFailures).toBe(0);
  });

  it('backs off while the server is unreachable instead of retrying every change', async () => {
    let attempts = 0;
    const l = new HeartbeatLoop({
      state,
      snapshot: async () => current,
      send: async () => {
        attempts += 1;
        throw new PlayerFault('network_error', 'down');
      },
      clock: { now: () => Date.now() },
      sleep,
      random: () => 1,
      signal: abort.signal,
      onRevoked: () => undefined,
    });
    l.start();
    for (let i = 0; i < 600; i += 1) {
      l.notifyChange();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    // Ten minutes: at most one attempt per 5 s even with a change every second.
    expect(attempts).toBeLessThanOrEqual(121);
    expect(attempts).toBeGreaterThanOrEqual(10);
  });

  it('stops and signals revocation on 401', async () => {
    failWith = new RevokedError();
    loop().start();
    await vi.advanceTimersByTimeAsync(0);
    expect(revoked).toBe(1);
    failWith = null;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sent).toHaveLength(0);
  });

  it('sends nothing when there is no registration to report for', async () => {
    current = null;
    loop().start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(0);
  });
});
