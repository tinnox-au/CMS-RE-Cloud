import type { Manifest } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  makeAppItem,
  makeAsset,
  makeManifest,
  makeManifestV2,
  makeManifestV3,
  makeManifestV4,
  makeManifestV5,
} from './fakes.test-support.ts';
import { ZoneSet } from './zones.ts';

const MAIN = { x: 0, y: 0, width: 1920, height: 918 };
const BAND = { x: 0, y: 918, width: 1920, height: 162 };
/** A main zone over two bands, for the changes between two and three zones. */
const THREE = [
  { x: 0, y: 0, width: 1920, height: 756 },
  { x: 0, y: 756, width: 1920, height: 162 },
  BAND,
];

function twoZones() {
  return makeManifestV5([
    { rect: MAIN, items: [makeAppItem()] },
    { rect: BAND, items: [makeAppItem()], transition: 'fade', shuffle: true },
  ]);
}

function threeZones() {
  return makeManifestV5(THREE.map((rect) => ({ rect, items: [makeAppItem()] })));
}

/** A zone set with fake presenters and loops that write every call to one shared log. */
function world() {
  const log: string[] = [];
  const session = new AbortController();
  const loops = new Map<
    number,
    { readonly signal: AbortSignal; readonly loadActive: () => Promise<Manifest | null> }
  >();
  const zones = new ZoneSet({
    createPresenter: (zone) => {
      log.push(`create ${zone}`);
      return {
        show: () => Promise.reject(new Error('not used')),
        clear: () => {
          log.push(`clear ${zone}`);
        },
        inUse: () => new Set([`sha-${zone}`]),
        remove: () => {
          log.push(`remove ${zone}`);
        },
      };
    },
    createLoop: (zone, _presenter, loadActive, signal) => {
      loops.set(zone, { signal, loadActive });
      signal.addEventListener('abort', () => {
        log.push(`abort ${zone}`);
      });
      return {
        start: () => {
          log.push(`start ${zone}`);
        },
        wake: () => {
          log.push(`wake ${zone}`);
        },
      };
    },
    signal: session.signal,
  });
  const viewOf = (zone: number): Promise<Manifest | null> => {
    const loop = loops.get(zone);
    if (loop === undefined) throw new Error(`zone ${zone} has no loop`);
    return loop.loadActive();
  };
  return { log, session, loops, zones, viewOf };
}

describe('ZoneSet', () => {
  it.each([
    ['v1', makeManifest([])],
    ['v2', makeManifestV2([])],
    ['v3', makeManifestV3([makeAppItem()])],
    ['v4', makeManifestV4([{ items: [makeAppItem()] }, { items: [makeAppItem()] }], [])],
  ])('hands a %s manifest to the main zone as it is and starts no zone', (_name, manifest) => {
    const w = world();
    expect(w.zones.adopt(manifest)).toBe(manifest);
    expect(w.log).toEqual([]);
  });

  it('gives the main zone its view of a v5 manifest and starts zone 1 with the other', async () => {
    const w = world();
    const manifest = twoZones();
    const main = w.zones.adopt(manifest);
    expect(main).toMatchObject({
      schemaVersion: 3,
      publicationId: manifest.publicationId,
      contentRect: MAIN,
      assets: [manifest.assets[0]],
    });
    expect(w.log).toEqual(['create 1', 'start 1']);
    expect(await w.viewOf(1)).toMatchObject({
      schemaVersion: 3,
      publicationId: manifest.publicationId,
      contentRect: BAND,
      assets: [manifest.assets[1]],
      transition: 'fade',
      shuffle: true,
    });

    // The same publication again, also as a fresh copy read from storage: nothing happens.
    expect(w.zones.adopt(manifest)).toBe(main);
    expect(w.zones.adopt(structuredClone(manifest))).toBe(main);
    expect(w.log).toEqual(['create 1', 'start 1']);
  });

  it('keeps zone 1 for a new publication with as many zones, and wakes it once', async () => {
    const w = world();
    w.zones.adopt(twoZones());
    const next = twoZones();
    w.zones.adopt(next);
    expect(w.log).toEqual(['create 1', 'start 1', 'wake 1']);
    expect(await w.viewOf(1)).toMatchObject({
      publicationId: next.publicationId,
      assets: [next.assets[1]],
    });
  });

  it('stops gone zones, aborting each before it is removed, before any zone is created', async () => {
    const w = world();
    w.zones.adopt(threeZones());
    expect(w.log).toEqual(['create 1', 'start 1', 'create 2', 'start 2']);
    const zone2 = w.loops.get(2)?.signal;

    // From three zones to two: zone 2 goes, zone 1 is kept.
    w.log.length = 0;
    w.zones.adopt(twoZones());
    expect(w.log).toEqual(['abort 2', 'remove 2', 'wake 1']);
    expect(zone2?.aborted).toBe(true);

    // From v5 to v1: every secondary zone goes, and the main zone gets the manifest itself.
    w.log.length = 0;
    const v1 = makeManifest([]);
    expect(w.zones.adopt(v1)).toBe(v1);
    expect(w.log).toEqual(['abort 1', 'remove 1']);

    // Back to v5: zone 1 is a new zone with a new signal.
    w.log.length = 0;
    w.zones.adopt(twoZones());
    expect(w.log).toEqual(['create 1', 'start 1']);
    expect(w.loops.get(1)?.signal.aborted).toBe(false);
  });

  it('adds zone 2 when a publication has three zones', async () => {
    const w = world();
    w.zones.adopt(twoZones());
    const next = threeZones();
    w.zones.adopt(next);
    expect(w.log).toEqual(['create 1', 'start 1', 'wake 1', 'create 2', 'start 2']);
    expect(await w.viewOf(2)).toMatchObject({ contentRect: THREE[2], assets: [next.assets[2]] });
  });

  it('stops every secondary zone on adopt(null) and on stopAll', () => {
    const w = world();
    w.zones.adopt(threeZones());
    w.log.length = 0;
    expect(w.zones.adopt(null)).toBeNull();
    expect(w.log).toEqual(['abort 1', 'remove 1', 'abort 2', 'remove 2']);

    w.zones.adopt(twoZones());
    w.log.length = 0;
    w.zones.stopAll();
    expect(w.log).toEqual(['abort 1', 'remove 1']);
    expect(w.zones.inUse()).toEqual(new Set());
  });

  it("stops every zone with the session's signal, and starts none after it", () => {
    const w = world();
    w.zones.adopt(threeZones());
    w.log.length = 0;
    w.session.abort();
    expect(w.log).toEqual(['abort 1', 'abort 2']);

    // A read that was in flight when the session stopped: its zones go, nothing new starts.
    w.log.length = 0;
    expect(w.zones.adopt(twoZones())).toBeNull();
    expect(w.log).toEqual(['remove 1', 'remove 2']);
  });

  it('reports the hashes in use by every secondary zone', () => {
    const w = world();
    w.zones.adopt(threeZones());
    expect(w.zones.inUse()).toEqual(new Set(['sha-1', 'sha-2']));
  });

  it('keeps the media of the adopted views of secondary zones until the next publication is adopted', async () => {
    const [main, bandA, bandB] = await Promise.all([makeAsset(1), makeAsset(2), makeAsset(3)]);
    const publication = (band: typeof bandA, id: string) =>
      makeManifestV5(
        [
          { rect: MAIN, items: [main.asset] },
          { rect: BAND, items: [band.asset, makeAppItem()] },
        ],
        { publicationId: id },
      );
    const w = world();
    w.zones.adopt(publication(bandA, '11111111-1111-4111-8111-111111111111'));
    // The main zone's media is the main presenter's business; the band's item may be picked next.
    expect(w.zones.inUse()).toEqual(new Set(['sha-1', bandA.asset.sha256]));

    // Activated but not adopted yet (the main zone is inside a video): nothing changes here.
    w.zones.adopt(publication(bandB, '22222222-2222-4222-8222-222222222222'));
    expect(w.zones.inUse()).toEqual(new Set(['sha-1', bandB.asset.sha256]));
  });
});
