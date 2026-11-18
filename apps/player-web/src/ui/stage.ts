import { manifestV2Facts, type Manifest } from '@tinnox/contracts';
import { canvasToViewport, effectiveContentRect, stageTransform } from '@tinnox/domain';
import { el } from './dom.ts';

/**
 * The publication canvas in the window: `.canvas` (test id `canvas`), scaled to fit, centred and
 * turned for the screen's rotation, with one box per zone. Zone 0's box is `.content` with test
 * id `content`; zone n's box is `.content` with test id `zone-{n}`. The canvas shows while at
 * least one zone shows something. One window resize listener, removed in `dispose`.
 */
export class DomStage {
  readonly #root: HTMLElement;
  readonly #canvasEl: HTMLDivElement;
  readonly #boxes = new Map<number, HTMLDivElement>();
  /** The view each showing zone's box was last placed from. */
  readonly #views = new Map<number, Manifest>();
  /** What the canvas follows: zone 0's last view, or a secondary zone's while zone 0 shows nothing. */
  #frame: { readonly zone: number; readonly view: Manifest } | null = null;
  readonly #onResize = (): void => {
    this.#layout();
  };

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#canvasEl = el('div', { className: 'canvas' });
    this.#canvasEl.setAttribute('data-testid', 'canvas');
    this.#canvasEl.hidden = true;
    root.replaceChildren(this.#canvasEl);
    addEventListener('resize', this.#onResize);
  }

  /** The box of a zone, created (and appended to the canvas) on first use. A presenter puts its layers in it. */
  box(zone: number): HTMLDivElement {
    let box = this.#boxes.get(zone);
    if (box === undefined) {
      box = el('div', { className: 'content' });
      box.setAttribute('data-testid', zone === 0 ? 'content' : `zone-${zone}`);
      // Appended in zone order, so during a change of layout a later zone draws on top.
      this.#canvasEl.append(box);
      this.#boxes.set(zone, box);
    }
    return box;
  }

  /**
   * Lays out the zone's box from `effectiveContentRect(view.canvas, view.contentRect)`, marks the
   * zone as showing and shows the canvas. The canvas itself (size, scale, rotation, `data-canvas`)
   * follows the view zone 0 last placed; a zone 1 or higher sets it only while zone 0 shows nothing.
   */
  place(zone: number, view: Manifest): void {
    // A zone that was removed while its item was being prepared stays off the canvas.
    if (!this.#boxes.has(zone)) return;
    this.#views.set(zone, view);
    if (zone === 0 || !this.#views.has(0)) this.#frame = { zone, view };
    this.#layout();
    this.#canvasEl.hidden = false;
  }

  /** The zone shows nothing; the canvas is hidden when no zone shows anything. */
  release(zone: number): void {
    this.#views.delete(zone);
    if (this.#views.size === 0) this.#canvasEl.hidden = true;
  }

  /** Takes a zone's box off the canvas (zones 1 and up). */
  remove(zone: number): void {
    this.release(zone);
    this.#boxes.get(zone)?.remove();
    this.#boxes.delete(zone);
  }

  /** Removes the resize listener and hides the canvas. */
  dispose(): void {
    removeEventListener('resize', this.#onResize);
    this.#canvasEl.hidden = true;
  }

  /**
   * One pass over the canvas and every showing box, each from its own last view. A secondary
   * zone never changes the canvas while zone 0 shows something, so it moves only its own box.
   */
  #layout(): void {
    const frame = this.#frame?.view;
    if (frame === undefined) return;
    const stage = { width: this.#root.clientWidth, height: this.#root.clientHeight };
    if (stage.width <= 0 || stage.height <= 0) return;
    const { rotation } = manifestV2Facts(frame);
    // A screen mounted on its side: lay the canvas out in the turned frame, then turn it.
    const { viewport, prefix } = stageTransform(rotation, stage);
    const { scale, offsetX, offsetY } = canvasToViewport(frame.canvas, viewport);
    const px = (value: number): string => `${Math.round(value * 1000) / 1000}px`;
    const canvasStyle = this.#canvasEl.style;
    if (rotation === 0) {
      canvasStyle.left = px(offsetX);
      canvasStyle.top = px(offsetY);
      canvasStyle.transform = '';
    } else {
      canvasStyle.left = '0px';
      canvasStyle.top = '0px';
      canvasStyle.transform = `${prefix} translate(${px(offsetX)},${px(offsetY)})`;
    }
    canvasStyle.width = px(frame.canvas.width * scale);
    canvasStyle.height = px(frame.canvas.height * scale);
    for (const [zone, view] of this.#views) {
      const style = this.#boxes.get(zone)?.style;
      if (style === undefined) continue;
      const rect = effectiveContentRect(view.canvas, view.contentRect);
      style.left = px(rect.x * scale);
      style.top = px(rect.y * scale);
      style.width = px(rect.width * scale);
      style.height = px(rect.height * scale);
    }
    this.#canvasEl.dataset.canvas = `${frame.canvas.width}x${frame.canvas.height}`;
  }
}
