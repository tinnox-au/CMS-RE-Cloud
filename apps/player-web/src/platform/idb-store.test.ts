import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EVERY_DAY,
  makeAsset,
  makeManifest,
  makeManifestV2,
  makeManifestV4,
  makeRegistration,
  REGISTRATION_ID,
} from '../core/fakes.test-support.ts';
import { openDB } from 'idb';
import { IdbStateStore, type ConnectionLoss } from './idb-store.ts';

let dbName: string;
let counter = 0;

async function open(): Promise<IdbStateStore> {
  return IdbStateStore.open(dbName);
}

describe('IdbStateStore (against fake-indexeddb)', () => {
  beforeEach(() => {
    counter += 1;
    dbName = `tinnox-player-test-${counter}`;
  });

  it('starts empty', async () => {
    const store = await open();
    expect(await store.getRegistration()).toBeNull();
    expect(await store.getActive()).toBeNull();
    expect(await store.getStaging()).toBeNull();
    expect(await store.getErrors()).toEqual([]);
    store.close();
  });

  it('keeps registration and active version across a reopen (reload)', async () => {
    const manifest = makeManifest([(await makeAsset(1)).asset]);
    let store = await open();
    await store.replaceRegistration(makeRegistration());
    expect(await store.activate(REGISTRATION_ID, manifest, '2026-11-14T03:00:00.000Z')).toBe(true);
    store.close();
    store = await open();
    expect((await store.getRegistration())?.registrationId).toBe(REGISTRATION_ID);
    expect((await store.getActive())?.manifest).toEqual(manifest);
    store.close();
  });

  it('activation swaps the active version and removes the staging record together', async () => {
    const store = await open();
    await store.replaceRegistration(makeRegistration());
    const first = makeManifest([(await makeAsset(1)).asset]);
    const second = makeManifest([(await makeAsset(2)).asset]);
    await store.activate(REGISTRATION_ID, first, '2026-11-14T03:00:00.000Z');
    await store.putStaging({
      manifest: second,
      phase: 'ready',
      assetsDone: 1,
      assetsTotal: 1,
      startedAt: '2026-11-14T03:01:00.000Z',
    });
    expect(await store.activate(REGISTRATION_ID, second, '2026-11-14T03:02:00.000Z')).toBe(true);
    expect((await store.getActive())?.manifest.publicationId).toBe(second.publicationId);
    expect(await store.getStaging()).toBeNull();
    store.close();
  });

  it('refuses activation for another registration, a revoked one, or another display, changing nothing', async () => {
    const store = await open();
    await store.replaceRegistration(makeRegistration());
    const first = makeManifest([(await makeAsset(1)).asset]);
    const second = makeManifest([(await makeAsset(2)).asset]);
    await store.activate(REGISTRATION_ID, first, '2026-11-14T03:00:00.000Z');
    const staging = {
      manifest: second,
      phase: 'ready',
      assetsDone: 1,
      assetsTotal: 1,
      startedAt: '2026-11-14T03:01:00.000Z',
    } as const;
    await store.putStaging(staging);

    expect(await store.activate(crypto.randomUUID(), second, '2026-11-14T03:02:00.000Z')).toBe(
      false,
    );
    const foreign = makeManifest([(await makeAsset(3)).asset], { displayId: crypto.randomUUID() });
    expect(await store.activate(REGISTRATION_ID, foreign, '2026-11-14T03:02:00.000Z')).toBe(false);
    expect((await store.getActive())?.manifest.publicationId).toBe(first.publicationId);
    expect((await store.getStaging())?.manifest.publicationId).toBe(second.publicationId);

    await store.markRevoked('2026-11-14T03:03:00.000Z');
    expect(await store.activate(REGISTRATION_ID, second, '2026-11-14T03:04:00.000Z')).toBe(false);
    expect(await store.getActive()).toBeNull();
    store.close();
  });

  it('a new registration removes every trace of the previous one', async () => {
    const store = await open();
    await store.replaceRegistration(makeRegistration());
    const manifest = makeManifest([(await makeAsset(1)).asset]);
    await store.activate(REGISTRATION_ID, manifest, '2026-11-14T03:00:00.000Z');
    await store.putStaging({
      manifest,
      phase: 'failed',
      assetsDone: 0,
      assetsTotal: 1,
      startedAt: '2026-11-14T03:01:00.000Z',
    });
    await store.putErrors([
      {
        code: 'network_error',
        message: 'x',
        at: '2026-11-14T03:00:00.000Z',
        publicationId: null,
        assetId: null,
      },
    ]);

    const other = makeRegistration({
      registrationId: crypto.randomUUID(),
      orgId: crypto.randomUUID(),
    });
    await store.replaceRegistration(other);
    expect((await store.getRegistration())?.orgId).toBe(other.orgId);
    expect(await store.getActive()).toBeNull();
    expect(await store.getStaging()).toBeNull();
    expect(await store.getErrors()).toEqual([]);
    store.close();
  });

  it('revocation drops the credential and both versions but remembers that it was revoked', async () => {
    const store = await open();
    await store.replaceRegistration(makeRegistration());
    const manifest = makeManifest([(await makeAsset(1)).asset]);
    await store.activate(REGISTRATION_ID, manifest, '2026-11-14T03:00:00.000Z');
    await store.markRevoked('2026-11-14T04:00:00.000Z');
    const registration = await store.getRegistration();
    expect(registration?.deviceToken).toBeNull();
    expect(registration?.revokedAt).toBe('2026-11-14T04:00:00.000Z');
    expect(await store.getActive()).toBeNull();
    store.close();
  });

  it('heartbeat seq increases across reopen and when the clock goes backwards', async () => {
    let store = await open();
    const a = await store.nextHeartbeatSeq(1_800_000_000_000);
    const b = await store.nextHeartbeatSeq(1_800_000_000_000);
    store.close();
    store = await open();
    const c = await store.nextHeartbeatSeq(1_700_000_000_000);
    const d = await store.nextHeartbeatSeq(1_800_000_050_000);
    expect([a, b, c, d]).toEqual([
      1_800_000_000_000, 1_800_000_000_001, 1_800_000_000_002, 1_800_000_050_000,
    ]);
    store.close();
  });

  it('treats a damaged record as absent instead of crashing', async () => {
    const store = await open();
    await store.replaceRegistration(makeRegistration());
    store.close();
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('open failed'));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = raw.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ registrationId: 'not-a-uuid' }, 'registration');
      tx.objectStore('kv').put({ manifest: { schemaVersion: 99 } }, 'activeVersion');
      tx.objectStore('kv').put('NaN', 'heartbeatSeq');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('write failed'));
    });
    raw.close();
    const reopened = await open();
    expect(await reopened.getRegistration()).toBeNull();
    expect(await reopened.getActive()).toBeNull();
    expect(await reopened.nextHeartbeatSeq(5)).toBe(5);
    reopened.close();
  });

  it('loads a v1 active version stored by player 0.1.0, and keeps a v2 one', async () => {
    const v1 = makeManifest([(await makeAsset(1)).asset]);
    const store = await open();
    await store.replaceRegistration(makeRegistration());
    store.close();
    const raw = await openDB(dbName);
    await raw.put('kv', { manifest: v1, activatedAt: '2026-11-14T03:00:00.000Z' }, 'activeVersion');
    raw.close();
    const reopened = await open();
    expect((await reopened.getActive())?.manifest).toEqual(v1);
    const v2 = makeManifestV2([(await makeAsset(2)).asset], { shuffle: true });
    expect(await reopened.activate(REGISTRATION_ID, v2, '2026-11-14T03:01:00.000Z')).toBe(true);
    expect((await reopened.getActive())?.manifest).toEqual(v2);
    reopened.close();
  });

  it('loads a stored v4 active version (a schedule) after a reopen', async () => {
    const v4 = makeManifestV4(
      [
        { items: [(await makeAsset(1)).asset] },
        { items: [(await makeAsset(2)).asset], transition: 'fade', shuffle: true },
      ],
      [{ playlist: 1, days: EVERY_DAY, start: '22:00', end: '02:00' }],
    );
    let store = await open();
    await store.replaceRegistration(makeRegistration());
    expect(await store.activate(REGISTRATION_ID, v4, '2026-11-14T03:00:00.000Z')).toBe(true);
    store.close();
    store = await open();
    expect((await store.getActive())?.manifest).toEqual(v4);
    store.close();
  });

  it('wipe and destroy remove everything (local reset)', async () => {
    let store = await open();
    await store.replaceRegistration(makeRegistration());
    await store.wipe();
    expect(await store.getRegistration()).toBeNull();
    await store.replaceRegistration(makeRegistration());
    await IdbStateStore.destroy(store, dbName);
    store = await open();
    expect(await store.getRegistration()).toBeNull();
    store.close();
  });

  it('reports a lost connection when another context needs a newer version, and lets it proceed', async () => {
    const lost: ConnectionLoss[] = [];
    const store = await IdbStateStore.open(dbName, { onConnectionLost: (r) => lost.push(r) });
    await store.replaceRegistration(makeRegistration());
    const newer = await openDB(dbName, 2, {
      upgrade(db) {
        db.createObjectStore('newer-build');
      },
    });
    expect(lost).toEqual(['blocking']);
    expect(newer.version).toBe(2);
    newer.close();
  });

  it('opens a database that a later build upgraded, keeping registration and content', async () => {
    const manifest = makeManifest([(await makeAsset(1)).asset]);
    const first = await open();
    await first.replaceRegistration(makeRegistration());
    await first.activate(REGISTRATION_ID, manifest, '2026-11-14T03:00:00.000Z');
    first.close();
    const newer = await openDB(dbName, 3);
    newer.close();
    // Before: VersionError ("requested version (1) is less than the existing version").
    const reopened = await open();
    expect((await reopened.getRegistration())?.registrationId).toBe(REGISTRATION_ID);
    expect((await reopened.getActive())?.manifest).toEqual(manifest);
    reopened.close();
  });

  it('creates its store in a newer database that lacks it', async () => {
    const foreign = await openDB(dbName, 4, {
      upgrade(db) {
        db.createObjectStore('something-else');
      },
    });
    foreign.close();
    const store = await open();
    expect(await store.getRegistration()).toBeNull();
    await store.replaceRegistration(makeRegistration());
    expect((await store.getRegistration())?.registrationId).toBe(REGISTRATION_ID);
    store.close();
  });
});
