import type {
  AppContent,
  ClockSettings,
  CountdownSettings,
  DateSettings,
  QrSettings,
  TickerSettings,
} from '@tinnox/contracts';
import { fitText } from './fit.ts';
import { qrPath } from './qr.ts';
import { clockText, countdownText, dateText } from './text.ts';
import { wallToEpoch } from './zone.ts';

export interface AppEnv {
  /** Player: the server-corrected clock; portal: Date.now. */
  now(): number;
  /** The manifest's site zone; null uses this device's zone (portal preview). */
  timeZone: string | null;
  reducedMotion: boolean;
  /** Called when the text starts or stops overflowing (portal preview warning). */
  onOverflow?(overflowing: boolean): void;
}

export interface AppView {
  /** Fills its container (position:absolute; inset:0); the container must be positioned. */
  readonly element: HTMLElement;
  /** Resolves after the first fit (the first ResizeObserver callback). */
  readonly ready: Promise<void>;
  /** Clears timers, cancels animations, disconnects observers. */
  dispose(): void;
}

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Character heights per second (stage-b.md section 14). */
const TICKER_FACTOR: Record<TickerSettings['speed'], number> = { slow: 2, medium: 3, fast: 4.5 };

type Styles = Record<string, string>;

/** The root's content box (inside its padding) and the sizes derived from its short side. */
interface Box {
  width: number;
  height: number;
  /** Readability floor for any font size. */
  min: number;
  /** The root padding, reused as the gap between a QR code and its caption. */
  gap: number;
}

interface Ctx {
  readonly env: AppEnv;
  /** Lays the app out again, for example after its text changed length. */
  refit(): void;
  /** Calls `tick` now and then at every whole second of `env.now()` while it returns true. */
  everySecond(tick: () => boolean): void;
}

/** A drawn app: `layout` sizes it for the box and returns true when text overflows. */
interface Drawn {
  layout(box: Box): boolean;
  dispose?(): void;
}

const px = (n: number): string => `${String(n)}px`;

function setStyles(el: HTMLElement | SVGElement, styles: Styles): void {
  for (const [name, value] of Object.entries(styles)) el.style.setProperty(name, value);
}

function div(styles: Styles, text?: string): HTMLDivElement {
  const el = document.createElement('div');
  setStyles(el, styles);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** A centred column filling the root's content box; the box text is fitted against. */
function stage(root: HTMLElement): HTMLDivElement {
  const el = div({
    width: '100%',
    height: '100%',
    'min-width': '0',
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    'justify-content': 'center',
  });
  root.append(el);
  return el;
}

/**
 * Fits `el` on one line when that is possible at a readable size, and wrapped otherwise (a long
 * date on a portrait screen). Returns true when it overflows even wrapped.
 */
function fitLines(el: HTMLElement, box: HTMLElement, sizes: { max: number; min: number }): boolean {
  el.style.setProperty('white-space', 'nowrap');
  if (!fitText(el, box, sizes)) return false;
  el.style.setProperty('white-space', 'normal');
  return fitText(el, box, sizes);
}

/** Rewrites text only when it changes; re-fits only when its length changes (tabular digits). */
function setText(el: HTMLElement, text: string, ctx: Ctx): void {
  const old = el.textContent;
  if (text === old) return;
  el.textContent = text;
  if (text.length !== old.length) ctx.refit();
}

/** Clock and Date: one line updated every second, fitted up to 0.8 of the height. */
function ticking(root: HTMLElement, ctx: Ctx, text: () => string): Drawn {
  const box = stage(root);
  const value = div({});
  box.append(value);
  ctx.everySecond(() => {
    setText(value, text(), ctx);
    return true;
  });
  return { layout: (b) => fitLines(value, box, { max: 0.8 * b.height, min: b.min }) };
}

function clock(root: HTMLElement, s: ClockSettings, ctx: Ctx): Drawn {
  return ticking(root, ctx, () => clockText(ctx.env.now(), ctx.env.timeZone, s));
}

function date(root: HTMLElement, s: DateSettings, ctx: Ctx): Drawn {
  return ticking(root, ctx, () => dateText(ctx.env.now(), ctx.env.timeZone, s.format));
}

function countdown(root: HTMLElement, s: CountdownSettings, ctx: Ctx): Drawn {
  const box = stage(root);
  // Label and value are fitted together: the value at most 0.6, the label 0.25 of the height.
  const block = div({ width: '100%' });
  const label = div({}, s.label);
  label.style.setProperty('font-size', `${String(0.25 / 0.6)}em`);
  const value = div({});
  if (s.label !== '') block.append(label);
  block.append(value);
  box.append(block);
  // DST is handled: the remaining time is the difference of two instants.
  const target = wallToEpoch(s.target, ctx.env.timeZone);
  ctx.everySecond(() => {
    const text = countdownText(target - ctx.env.now(), s.showSeconds);
    if (text !== null) {
      setText(value, text, ctx);
      return true;
    }
    // Finished for good: no count-up, the timer stops.
    label.remove();
    value.textContent = s.finishedText;
    ctx.refit();
    return false;
  });
  return { layout: (b) => fitLines(block, box, { max: 0.6 * b.height, min: b.min }) };
}

/**
 * Text, and a still ticker: a heading line over a wrapping body, fitted together. The heading
 * wraps only when it cannot fit on one line at a readable size (a 60-character heading on a
 * landscape screen cannot).
 */
function textBlock(root: HTMLElement, heading: string, body: string): Drawn {
  const box = stage(root);
  const block = div({ width: '100%' });
  const head = div({}, heading);
  if (heading !== '') {
    // The heading is at most 1.6 times the body size.
    if (body !== '') setStyles(head, { 'font-size': '1.6em', 'margin-bottom': '0.15em' });
    block.append(head);
  }
  if (body !== '') block.append(div({ 'white-space': 'pre-line' }, body));
  box.append(block);
  const share = body === '' ? 0.8 : 0.5;
  return {
    layout(b) {
      const sizes = { max: share * b.height, min: b.min };
      head.style.setProperty('white-space', 'nowrap');
      if (!fitText(block, box, sizes)) return false;
      head.style.setProperty('white-space', 'normal');
      return fitText(block, box, sizes);
    },
  };
}

function ticker(root: HTMLElement, s: TickerSettings, ctx: Ctx): Drawn {
  if (ctx.env.reducedMotion) return textBlock(root, '', s.text);
  // The band spans the whole root, so the text runs edge to edge, centred vertically.
  const band = div({
    position: 'absolute',
    inset: '0',
    display: 'flex',
    'align-items': 'center',
    overflow: 'hidden',
  });
  const track = div({ display: 'flex', flex: 'none' });
  band.append(track);
  root.append(band);
  let animation: Animation | null = null;
  const copy = (): HTMLDivElement =>
    div({ 'white-space': 'nowrap', flex: 'none', 'padding-right': '2em' }, s.text);
  return {
    layout(b) {
      animation?.cancel();
      const fontPx = Math.min(0.6 * b.height, 0.25 * b.width);
      track.style.setProperty('font-size', px(fontPx));
      const first = copy();
      track.replaceChildren(first);
      // Layout pixels: the player rotates the stage with a CSS transform, which
      // getBoundingClientRect would include (a 90° screen would give the copy's height).
      const copyWidth = first.offsetWidth;
      // Enough copies to cover the band plus the one scrolling out, so the loop is seamless.
      const count = Math.ceil(band.clientWidth / copyWidth) + 1;
      for (let i = 1; i < count; i++) {
        const next = copy();
        next.setAttribute('aria-hidden', 'true');
        track.append(next);
      }
      animation = track.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(${px(-copyWidth)})` }],
        {
          duration: (copyWidth / (TICKER_FACTOR[s.speed] * fontPx)) * 1000,
          iterations: Infinity,
          easing: 'linear',
        },
      );
      return false;
    },
    dispose: () => animation?.cancel(),
  };
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  return el;
}

function qr(root: HTMLElement, s: QrSettings): Drawn {
  const { size, d } = qrPath(s.content);
  const outer = String(size + 8);
  // Always black on white with a 4-module quiet zone, whatever the colours: inverted codes do not scan.
  // shortcut: no warning when a module is under 2 canvas pixels; add one if codes fail to scan.
  const code = svg('svg', {
    viewBox: `-4 -4 ${outer} ${outer}`,
    'shape-rendering': 'crispEdges',
    'aria-hidden': 'true',
  });
  code.append(
    svg('rect', { x: '-4', y: '-4', width: outer, height: outer, fill: '#ffffff' }),
    svg('path', { d, fill: '#000000' }),
  );
  setStyles(code, { flex: 'none', display: 'block' });
  const box = stage(root);
  box.append(code);
  if (s.caption === '') {
    return {
      layout(b) {
        const side = px(Math.min(b.width, b.height));
        setStyles(code, { width: side, height: side });
        return false;
      },
    };
  }
  const slot = div({ flex: 'none', display: 'flex', 'align-items': 'center' });
  const caption = div({ width: '100%' }, s.caption);
  slot.append(caption);
  box.append(slot);
  return {
    layout(b) {
      // A wide box puts the caption beside the code, any other below it.
      const beside = b.width / b.height >= 1.6;
      const side = beside ? 0.9 * b.height : Math.min(b.width, 0.8 * b.height);
      setStyles(code, { width: px(side), height: px(side) });
      box.style.setProperty('flex-direction', beside ? 'row' : 'column');
      setStyles(slot, {
        // At most twice the code's width, so on a very wide box code and caption stay together.
        width: px(beside ? Math.min(b.width - side - b.gap, 2 * side) : b.width),
        height: px(beside ? b.height : b.height - side - b.gap),
        'margin-left': beside ? px(b.gap) : '0',
        'margin-top': beside ? '0' : px(b.gap),
      });
      return fitLines(caption, slot, { max: 0.25 * b.height, min: b.min });
    },
  };
}

function build(root: HTMLElement, content: AppContent, ctx: Ctx): Drawn {
  switch (content.type) {
    case 'clock':
      return clock(root, content.settings, ctx);
    case 'date':
      return date(root, content.settings, ctx);
    case 'countdown':
      return countdown(root, content.settings, ctx);
    case 'ticker':
      return ticker(root, content.settings, ctx);
    case 'qr':
      return qr(root, content.settings);
    case 'text':
      return textBlock(root, content.settings.heading, content.settings.body);
  }
}

/** Draws `content` into a new root element sized entirely from its own box. */
export function renderApp(content: AppContent, env: AppEnv): AppView {
  const { textColour, backgroundColour } = content.settings;
  const root = div({
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'text-align': 'center',
    'box-sizing': 'border-box',
    'background-color': backgroundColour,
    color: textColour,
    'font-family': FONT,
    'font-weight': '700',
    'line-height': '1.15',
    'font-variant-numeric': 'tabular-nums',
  });
  let box: Box | null = null;
  let overflowing: boolean | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const ctx: Ctx = {
    env,
    refit() {
      // box is null until the first resize, so this never runs while `drawn` is being built.
      if (box === null || disposed) return;
      const now = drawn.layout(box);
      if (now !== overflowing) {
        overflowing = now;
        env.onOverflow?.(now);
      }
    },
    everySecond(tick) {
      const run = (): void => {
        timer = undefined;
        if (disposed || !tick()) return;
        // Self-correcting: aim at the next whole second of the (corrected) clock.
        timer = setTimeout(run, 1000 - (env.now() % 1000));
      };
      run();
    },
  };
  const drawn = build(root, content, ctx);

  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  // Border box: the padding set below does not trigger another callback.
  const observer = new ResizeObserver(() => {
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (width === 0 || height === 0) return;
    const short = Math.min(width, height);
    const gap = Math.round(0.04 * short);
    root.style.setProperty('padding', px(gap));
    // shortcut: the readability floor is 1/12 of the short side; tune per pixel pitch if reported.
    box = { width: width - 2 * gap, height: height - 2 * gap, min: short / 12, gap };
    ctx.refit();
    resolveReady();
  });
  observer.observe(root, { box: 'border-box' });

  return {
    element: root,
    ready,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      drawn.dispose?.();
    },
  };
}
