import { isMediaItem, manifestZones, type Manifest } from '@tinnox/contracts';
import type { Presenter } from './playback.ts';

/** A zone's presenter as the zone set uses it: DomPresenter, or a fake in tests. */
export interface ZonePresenter extends Presenter {
  inUse(): ReadonlySet<string>;
  /** Clears the zone and takes its box off the stage. */
  remove(): void;
}

export interface ZoneSetDeps {
  /** Builds the presenter (and the box) of zone `zone`, 1 or more. */
  createPresenter(zone: number): ZonePresenter;
  /** Builds the loop of zone `zone`, 1 or more; the zone set starts it. */
  createLoop(
    zone: number,
    presenter: Presenter,
    loadActive: () => Promise<Manifest | null>,
    signal: AbortSignal,
  ): { start(): void; wake(): void };
  /** The session's signal: every zone stops with it. */
  readonly signal: AbortSignal;
}

interface Zone {
  readonly presenter: ZonePresenter;
  readonly loop: { start(): void; wake(): void };
  readonly abort: AbortController;
}

/**
 * Zones 1 and up of the active publication, each with its own presenter and loop; zone 0 is the
 * session's main loop, which calls `adopt` from its `loadActive`. Every zone plays a version 3
 * view of its own run (`manifestZones`), so the playback code has no zone branches.
 */
// shortcut: zones adopt a new publication at their own next item; for up to one video old and new geometry share the screen (a later zone draws on top). Hand over atomically if operators notice.
// shortcut: removing a zone cuts a video playing in it.
export class ZoneSet {
  readonly #deps: ZoneSetDeps;
  #publicationId: string | null = null;
  /** The views of the adopted publication; [0] is the main zone's. */
  #views: Manifest[] = [];
  /** Zones 1 and up, by zone number. */
  readonly #zones = new Map<number, Zone>();

  constructor(deps: ZoneSetDeps) {
    this.#deps = deps;
  }

  /** The main zone's `loadActive` calls this with the active manifest; returns the main zone's view. */
  adopt(manifest: Manifest | null): Manifest | null {
    // Once the session has stopped nothing new may start (a read that was in flight then).
    const next = this.#deps.signal.aborted ? null : manifest;
    if ((next?.publicationId ?? null) === this.#publicationId) return this.#views[0] ?? null;
    this.#publicationId = next?.publicationId ?? null;
    this.#views = next === null ? [] : manifestZones(next);

    // Gone zones stop first, so their decoders are released before a new zone starts.
    for (const [n, zone] of this.#zones) {
      if (n < this.#views.length) continue;
      zone.abort.abort();
      zone.presenter.remove();
      this.#zones.delete(n);
    }
    for (let n = 1; n < this.#views.length; n += 1) {
      const kept = this.#zones.get(n);
      if (kept !== undefined) {
        // Its loadActive reads the new view at its next item; a still or an app ends now.
        kept.loop.wake();
        continue;
      }
      const abort = new AbortController();
      const presenter = this.#deps.createPresenter(n);
      const loop = this.#deps.createLoop(
        n,
        presenter,
        async () => this.#views[n] ?? null,
        AbortSignal.any([this.#deps.signal, abort.signal]),
      );
      this.#zones.set(n, { presenter, loop, abort });
      loop.start();
    }
    return this.#views[0] ?? null;
  }

  /**
   * Hashes zones 1 and up show or may still pick: what is on screen, and every media item of
   * their adopted views. A zone plays its adopted view until the main zone adopts the next
   * publication, which can be a whole video after that publication was activated.
   */
  inUse(): ReadonlySet<string> {
    const set = new Set<string>();
    for (const zone of this.#zones.values()) for (const sha of zone.presenter.inUse()) set.add(sha);
    for (const view of this.#views.slice(1)) {
      for (const item of view.assets) if (isMediaItem(item)) set.add(item.sha256);
    }
    return set;
  }

  /** Stops every zone but the main one (revocation, reset). */
  stopAll(): void {
    this.adopt(null);
  }
}
