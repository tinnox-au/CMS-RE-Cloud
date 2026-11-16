import {
  manifestV2Facts,
  type Canvas,
  type ManifestAssetV1,
  type Manifest,
  type Rect,
  type Rotation,
} from '@tinnox/contracts';
import { canvasToViewport, effectiveContentRect, stageTransform } from '@tinnox/domain';
import { PlayerFault, throwIfAborted } from '../core/errors.ts';
import type { Presenter, ShownItem } from '../core/playback.ts';
import { releaseVideo } from '../platform/media.ts';
import { el } from './dom.ts';

/** Longest wait for an item to become displayable before it is skipped. */
const READY_TIMEOUT_MS = 15_000;
/** Matches the fade animations in styles.css. */
export const FADE_MS = 500;

interface Layer {
  readonly sha256: string;
  readonly kind: ManifestAssetV1['kind'];
  readonly holder: HTMLElement;
  dispose(): void;
}

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
 * Draws the publication canvas in the window: scaled to fit, centred, black
 * around it. Content appears only inside the content rectangle. Two stacked
 * layers give a cut without a black frame: the next item is prepared hidden on
 * top, revealed when it can be displayed, and only then is the old one released
 * (after a 500 ms fade, for image to image when the publication asks for it).
 *
 * Every object URL made here is revoked when its layer is disposed, and elements
 * are removed from the document, so nothing accumulates however long the loop runs.
 */
export class DomPresenter implements Presenter {
  readonly #stage: HTMLElement;
  readonly #getBlob: (sha256: string) => Promise<Blob | null>;
  readonly #canvasEl: HTMLDivElement;
  readonly #contentEl: HTMLDivElement;
  #geometry: { canvas: Canvas; contentRect: Rect | null; rotation: Rotation } | null = null;
  #current: Layer | null = null;
  /** The previous image while it fades out under the current one. */
  #leaving: Layer | null = null;
  #leavingTimer: ReturnType<typeof setTimeout> | undefined;
  #pendingSha: string | null = null;

  constructor(stage: HTMLElement, getBlob: (sha256: string) => Promise<Blob | null>) {
    this.#stage = stage;
    this.#getBlob = getBlob;
    this.#contentEl = el('div', { className: 'content' });
    this.#canvasEl = el('div', { className: 'canvas' }, [this.#contentEl]);
    this.#canvasEl.setAttribute('data-testid', 'canvas');
    this.#contentEl.setAttribute('data-testid', 'content');
    this.#canvasEl.hidden = true;
    stage.replaceChildren(this.#canvasEl);
    addEventListener('resize', () => {
      this.#layout();
    });
  }

  /** Hashes of the assets on screen or being prepared; these must not be garbage-collected. */
  inUse(): ReadonlySet<string> {
    const set = new Set<string>();
    if (this.#current !== null) set.add(this.#current.sha256);
    if (this.#leaving !== null) set.add(this.#leaving.sha256);
    if (this.#pendingSha !== null) set.add(this.#pendingSha);
    return set;
  }

  #layout(): void {
    const geometry = this.#geometry;
    if (geometry === null) return;
    const stage = { width: this.#stage.clientWidth, height: this.#stage.clientHeight };
    if (stage.width <= 0 || stage.height <= 0) return;
    // A screen mounted on its side: lay the canvas out in the turned frame, then turn it.
    const { viewport, prefix } = stageTransform(geometry.rotation, stage);
    const { scale, offsetX, offsetY } = canvasToViewport(geometry.canvas, viewport);
    const rect = effectiveContentRect(geometry.canvas, geometry.contentRect);
    const px = (value: number): string => `${Math.round(value * 1000) / 1000}px`;
    const canvasStyle = this.#canvasEl.style;
    if (geometry.rotation === 0) {
      canvasStyle.left = px(offsetX);
      canvasStyle.top = px(offsetY);
      canvasStyle.transform = '';
    } else {
      canvasStyle.left = '0px';
      canvasStyle.top = '0px';
      canvasStyle.transform = `${prefix} translate(${px(offsetX)},${px(offsetY)})`;
    }
    canvasStyle.width = px(geometry.canvas.width * scale);
    canvasStyle.height = px(geometry.canvas.height * scale);
    const contentStyle = this.#contentEl.style;
    contentStyle.left = px(rect.x * scale);
    contentStyle.top = px(rect.y * scale);
    contentStyle.width = px(rect.width * scale);
    contentStyle.height = px(rect.height * scale);
    this.#canvasEl.dataset.canvas = `${geometry.canvas.width}x${geometry.canvas.height}`;
  }

  async show(asset: ManifestAssetV1, manifest: Manifest, signal: AbortSignal): Promise<ShownItem> {
    this.#dropLeaving();
    this.#pendingSha = asset.sha256;
    let layer: (Layer & { reveal(fade: boolean): void }) | null = null;
    try {
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
      const built = asset.kind === 'image' ? this.#image(asset, blob) : this.#video(asset, blob);
      layer = built.layer;
      await built.ready;
      throwIfAborted(signal);

      // Swap: geometry first (it only changes with a new publication), then reveal, then release.
      const facts = manifestV2Facts(manifest);
      this.#geometry = {
        canvas: manifest.canvas,
        contentRect: manifest.contentRect,
        rotation: facts.rotation,
      };
      this.#layout();
      this.#canvasEl.hidden = false;
      const previous = this.#current;
      // Only image to image fades; the first item and anything with video cut.
      const fade =
        facts.transition === 'fade' && asset.kind === 'image' && previous?.kind === 'image';
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
      throw err;
    } finally {
      this.#pendingSha = null;
    }
  }

  clear(): void {
    this.#dropLeaving();
    this.#current?.dispose();
    this.#current = null;
    this.#canvasEl.hidden = true;
  }

  #dropLeaving(): void {
    clearTimeout(this.#leavingTimer);
    this.#leaving?.dispose();
    this.#leaving = null;
  }

  #mount(
    media: HTMLElement,
    asset: ManifestAssetV1,
    onDispose: () => void,
  ): Layer & { reveal(fade: boolean): void } {
    media.classList.add(asset.fit === 'cover' ? 'fit-cover' : 'fit-contain');
    const holder = el('div', { className: 'layer pending' }, [media]);
    holder.dataset.assetId = asset.assetId;
    holder.dataset.kind = asset.kind;
    holder.dataset.fit = asset.fit;
    this.#contentEl.append(holder);
    let disposed = false;
    return {
      sha256: asset.sha256,
      kind: asset.kind,
      holder,
      // Not at mount: the layer stays hidden until decoded, and the fade starts when it shows.
      reveal: (fade) => {
        holder.classList.remove('pending');
        if (fade) holder.classList.add('fade-in');
        holder.setAttribute('data-testid', 'active-layer');
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
  ): { layer: Layer & { reveal(fade: boolean): void }; ready: Promise<void>; finished: null } {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    const layer = this.#mount(img, asset, () => {
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
    layer: Layer & { reveal(fade: boolean): void };
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
    const layer = this.#mount(video, asset, () => {
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
}
