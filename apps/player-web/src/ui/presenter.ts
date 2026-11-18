import { renderApp, type AppView } from '@tinnox/app-render';
import {
  isMediaItem,
  type ManifestAppItem,
  type ManifestAssetV1,
  type Manifest,
  type ManifestItem,
  type Transition,
} from '@tinnox/contracts';
import { PlayerFault, throwIfAborted } from '../core/errors.ts';
import type { Presenter, ShownItem } from '../core/playback.ts';
import { releaseVideo } from '../platform/media.ts';
import { el } from './dom.ts';
import type { DomStage } from './stage.ts';

/** Longest wait for an item to become displayable before it is skipped. */
const READY_TIMEOUT_MS = 15_000;
/** Matches the fade animations in styles.css. */
export const FADE_MS = 500;

interface Layer {
  /** Null for an app: it has no cached bytes. */
  readonly sha256: string | null;
  readonly kind: ManifestItem['kind'];
  readonly holder: HTMLElement;
  dispose(): void;
}

type NewLayer = Layer & { reveal(fade: boolean): void };

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(onTimeout());
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('media failed to load'));
      },
    );
  });
}

/**
 * Draws one zone: its items appear only inside the zone's box on the stage (for zone 0 of a
 * manifest without zones, the content rectangle). Two stacked layers give a cut without a black
 * frame: the next item is prepared hidden on top, revealed when it can be displayed, and only
 * then is the old one released (after a 500 ms fade, for image to image when the item's
 * playlist asks for it).
 *
 * Every object URL made here is revoked when its layer is disposed, and elements
 * are removed from the document, so nothing accumulates however long the loop runs.
 */
export class DomPresenter implements Presenter {
  readonly #stage: DomStage;
  readonly #zone: number;
  readonly #getBlob: (sha256: string) => Promise<Blob | null>;
  readonly #contentEl: HTMLDivElement;
  /** The view this zone's box was last placed from. */
  #view: Manifest | null = null;
  /** Set by `remove`: a show that was still preparing must not touch a new zone with this number. */
  #removed = false;
  #current: Layer | null = null;
  /** The previous image while it fades out under the current one. */
  #leaving: Layer | null = null;
  #leavingTimer: ReturnType<typeof setTimeout> | undefined;
  #pendingSha: string | null = null;
  /** The server-corrected clock, for Clock, Date and Countdown apps. */
  readonly #now: () => number;

  constructor(
    stage: DomStage,
    zone: number,
    getBlob: (sha256: string) => Promise<Blob | null>,
    now: () => number,
  ) {
    this.#stage = stage;
    this.#zone = zone;
    this.#getBlob = getBlob;
    this.#now = now;
    this.#contentEl = stage.box(zone);
  }

  /** Hashes of the assets on screen or being prepared; these must not be garbage-collected. */
  inUse(): ReadonlySet<string> {
    const set = new Set<string>();
    for (const sha of [this.#current?.sha256, this.#leaving?.sha256, this.#pendingSha]) {
      if (sha !== null && sha !== undefined) set.add(sha);
    }
    return set;
  }

  /** Geometry only changes with a new publication. */
  #applyGeometry(view: Manifest): void {
    if (this.#removed) return;
    this.#view = view;
    this.#stage.place(this.#zone, view);
  }

  async show(
    asset: ManifestItem,
    manifest: Manifest,
    signal: AbortSignal,
    transition: Transition,
  ): Promise<ShownItem> {
    this.#dropLeaving();
    let layer: NewLayer | null = null;
    // The view the item on screen was laid out with; an app changes it before it is ready.
    const shownView = this.#view;
    try {
      let built: { layer: NewLayer; ready: Promise<void>; finished: Promise<void> | null };
      if (isMediaItem(asset)) {
        this.#pendingSha = asset.sha256;
        const blob = await this.#getBlob(asset.sha256);
        throwIfAborted(signal);
        if (blob === null) {
          throw new PlayerFault(
            'storage_error',
            'asset is missing from the local cache (evicted by the browser?)',
            {
              assetId: asset.assetId,
            },
          );
        }
        built = asset.kind === 'image' ? this.#image(asset, blob) : this.#video(asset, blob);
      } else {
        // An app sizes itself from its box, and a hidden canvas has none: its `ready`
        // would never resolve. Lay the stage out and show it before mounting.
        this.#applyGeometry(manifest);
        built = this.#app(asset, manifest);
      }
      layer = built.layer;
      await built.ready;
      throwIfAborted(signal);

      // Swap: geometry first, then reveal, then release.
      this.#applyGeometry(manifest);
      const previous = this.#current;
      // Only image to image fades; the first item and anything with video cut. On a change of
      // playlist the incoming playlist's transition decides, as on a publication switch.
      const fade = transition === 'fade' && asset.kind === 'image' && previous?.kind === 'image';
      layer.reveal(fade);
      this.#current = layer;
      layer = null;
      if (fade && previous !== null) {
        previous.holder.removeAttribute('data-testid');
        previous.holder.classList.add('fade-out');
        this.#leaving = previous;
        this.#leavingTimer = setTimeout(() => {
          this.#dropLeaving();
        }, FADE_MS);
      } else {
        previous?.dispose();
      }
      return { finished: built.finished };
    } catch (err) {
      layer?.dispose();
      // An app lays out and shows the canvas before it is ready: put back what was on screen.
      if (this.#removed) {
        // The box is gone, and the zone number may belong to a new presenter.
      } else if (this.#current === null) {
        this.#stage.release(this.#zone);
      } else if (this.#view !== shownView && shownView !== null) {
        this.#view = shownView;
        this.#stage.place(this.#zone, shownView);
      }
      throw err;
    } finally {
      this.#pendingSha = null;
    }
  }

  clear(): void {
    this.#dropLeaving();
    this.#current?.dispose();
    this.#current = null;
    this.#stage.release(this.#zone);
  }

  /** Clears the zone and takes its box off the stage (zones 1 and up). */
  remove(): void {
    this.clear();
    this.#stage.remove(this.#zone);
    this.#removed = true;
  }

  #dropLeaving(): void {
    clearTimeout(this.#leavingTimer);
    this.#leaving?.dispose();
    this.#leaving = null;
  }

  #mountMedia(media: HTMLElement, asset: ManifestAssetV1, onDispose: () => void): NewLayer {
    media.classList.add(asset.fit === 'cover' ? 'fit-cover' : 'fit-contain');
    const holder = el('div', { className: 'layer pending' }, [media]);
    holder.dataset.assetId = asset.assetId;
    holder.dataset.fit = asset.fit;
    return this.#mount(holder, asset.sha256, asset.kind, onDispose);
  }

  #mount(
    holder: HTMLElement,
    sha256: string | null,
    kind: ManifestItem['kind'],
    onDispose: () => void,
  ): NewLayer {
    holder.dataset.kind = kind;
    this.#contentEl.append(holder);
    let disposed = false;
    return {
      sha256,
      kind,
      holder,
      // Not at mount: the layer stays hidden until decoded, and the fade starts when it shows.
      reveal: (fade) => {
        holder.classList.remove('pending');
        if (fade) holder.classList.add('fade-in');
        holder.setAttribute(
          'data-testid',
          this.#zone === 0 ? 'active-layer' : `zone-${this.#zone}-active-layer`,
        );
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        onDispose();
        holder.remove();
      },
    };
  }

  #image(
    asset: ManifestAssetV1,
    blob: Blob,
  ): { layer: NewLayer; ready: Promise<void>; finished: null } {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    const layer = this.#mountMedia(img, asset, () => {
      img.removeAttribute('src');
      URL.revokeObjectURL(url);
    });
    img.src = url;
    const ready = withTimeout(
      img.decode(),
      READY_TIMEOUT_MS,
      () => new Error('image took too long to decode'),
    ).catch((err: unknown) => {
      throw new PlayerFault('decode_failed', 'image could not be displayed', {
        assetId: asset.assetId,
        cause: err,
      });
    });
    return { layer, ready, finished: null };
  }

  #video(
    asset: ManifestAssetV1,
    blob: Blob,
  ): {
    layer: NewLayer;
    ready: Promise<void>;
    finished: Promise<void>;
  } {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    // Muted, inline, no controls: the conditions under which browsers allow unattended autoplay.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.controls = false;
    video.loop = false;
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    let disposed = false;
    const layer = this.#mountMedia(video, asset, () => {
      disposed = true;
      releaseVideo(video);
      URL.revokeObjectURL(url);
    });

    const finished = new Promise<void>((resolve, reject) => {
      video.addEventListener(
        'ended',
        () => {
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        'error',
        () => {
          if (disposed) return;
          reject(
            new PlayerFault(
              'playback_error',
              `video playback stopped with media error ${video.error?.code ?? 0}`,
              {
                assetId: asset.assetId,
              },
            ),
          );
        },
        { once: true },
      );
    });
    // The loop may not be listening yet (the item is still being prepared).
    finished.catch(() => undefined);

    const canPlay = new Promise<void>((resolve, reject) => {
      video.addEventListener(
        'canplay',
        () => {
          resolve();
        },
        { once: true },
      );
      finished.catch((err: unknown) => {
        reject(err instanceof Error ? err : new Error('video error'));
      });
    });
    video.src = url;
    video.load();

    const ready = withTimeout(
      canPlay,
      READY_TIMEOUT_MS,
      () => new Error('video took too long to start'),
    )
      .catch((err: unknown) => {
        throw new PlayerFault('decode_failed', 'video could not be prepared for playback', {
          assetId: asset.assetId,
          cause: err,
        });
      })
      .then(async () => {
        try {
          await video.play();
        } catch (err) {
          const blocked = err instanceof DOMException && err.name === 'NotAllowedError';
          throw new PlayerFault(
            'playback_error',
            blocked
              ? 'the browser blocked autoplay of the video'
              : 'the video could not be started',
            { assetId: asset.assetId, cause: err },
          );
        }
      });
    return { layer, ready, finished };
  }

  #app(
    item: ManifestAppItem,
    manifest: Manifest,
  ): { layer: NewLayer; ready: Promise<void>; finished: null } {
    const fault = (cause: unknown): PlayerFault =>
      new PlayerFault('playback_error', 'app could not be drawn', { cause });
    let view: AppView;
    try {
      view = renderApp(item.content, {
        now: this.#now,
        timeZone: manifest.schemaVersion === 1 ? null : manifest.timeZone,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    } catch (err) {
      throw fault(err);
    }
    const holder = el('div', { className: 'layer pending' }, [view.element]);
    holder.dataset.appType = item.content.type;
    // Disposing the view stops its timers, animations and observers.
    const layer = this.#mount(holder, null, 'app', () => {
      view.dispose();
    });
    const ready = withTimeout(
      view.ready,
      READY_TIMEOUT_MS,
      () => new Error('app took too long to draw'),
    ).catch((err: unknown) => {
      throw fault(err);
    });
    return { layer, ready, finished: null };
  }
}
