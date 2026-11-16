/**
 * WCAG 2.x contrast maths and a small reader for `styles/tokens.css`.
 * Pure functions, no DOM. Used by the token test so a palette change that breaks
 * a text or boundary pair fails the unit suite instead of reaching a screen.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Rgba extends Rgb {
  /** 0 (transparent) to 1 (opaque). */
  readonly a: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/i;

function channel(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const percent = trimmed.endsWith('%');
  const value = Number(percent ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(value)) return null;
  const scaled = percent ? (value / 100) * 255 : value;
  return Math.min(255, Math.max(0, scaled));
}

function alpha(text: string | undefined): number | null {
  if (text === undefined) return 1;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const percent = trimmed.endsWith('%');
  const value = Number(percent ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, percent ? value / 100 : value));
}

/**
 * Reads `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r g b)`, `rgb(r g b / a)` and the
 * comma form. Anything else (named colours, `color-mix`, `var()`) answers null.
 */
export function parseColour(text: string): Rgba | null {
  const value = text.trim();
  const hex = HEX.exec(value);
  if (hex !== null) {
    const digits = hex[1] ?? '';
    const wide =
      digits.length <= 4
        ? Array.from(digits)
            .map((digit) => digit + digit)
            .join('')
        : digits;
    const read = (start: number): number => Number.parseInt(wide.slice(start, start + 2), 16);
    return { r: read(0), g: read(2), b: read(4), a: wide.length === 8 ? read(6) / 255 : 1 };
  }
  const fn = RGB_FUNCTION.exec(value);
  if (fn === null) return null;
  const [colourPart = '', alphaPart] = (fn[1] ?? '').split('/');
  const parts = colourPart.includes(',') ? colourPart.split(',') : colourPart.trim().split(/\s+/);
  // The comma form may carry alpha as a fourth value.
  const alphaText = alphaPart ?? (parts.length === 4 ? parts[3] : undefined);
  if (parts.length !== 3 && !(parts.length === 4 && alphaPart === undefined)) return null;
  const r = channel(parts[0] ?? '');
  const g = channel(parts[1] ?? '');
  const b = channel(parts[2] ?? '');
  const a = alpha(alphaText);
  if (r === null || g === null || b === null || a === null) return null;
  return { r, g, b, a };
}

function linear(value: number): number {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance as defined by WCAG 2.x (sRGB). */
export function relativeLuminance(colour: Rgb): number {
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
}

/** Contrast ratio between two opaque colours, from 1 to 21. */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Flattens a translucent colour over an opaque background. */
export function composite(foreground: Rgba, background: Rgb): Rgb {
  const mix = (top: number, bottom: number): number =>
    top * foreground.a + bottom * (1 - foreground.a);
  return {
    r: mix(foreground.r, background.r),
    g: mix(foreground.g, background.g),
    b: mix(foreground.b, background.b),
  };
}

/** Returns the text between the brace that opens at or after `from` and its matching close. */
function blockAfter(css: string, from: number): string | null {
  const open = css.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return null;
}

function customProperties(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) found.set(name, value.trim());
  }
  return found;
}

export interface TokenSets {
  /** Custom properties of the first `:root` block. */
  readonly light: ReadonlyMap<string, string>;
  /** The light set with the `prefers-color-scheme: dark` overrides applied. */
  readonly dark: ReadonlyMap<string, string>;
}

/**
 * Reads the two colour sets out of a token stylesheet shaped like `styles/tokens.css`:
 * one `:root` block, then `@media (prefers-color-scheme: dark) { :root { ... } }`.
 */
export function readTokenSets(css: string): TokenSets {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rootAt = withoutComments.indexOf(':root');
  if (rootAt === -1) throw new Error('The token stylesheet has no :root block');
  const light = customProperties(blockAfter(withoutComments, rootAt) ?? '');

  const mediaAt = withoutComments.search(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/);
  if (mediaAt === -1) throw new Error('The token stylesheet has no dark colour-scheme block');
  const media = blockAfter(withoutComments, mediaAt) ?? '';
  const darkRootAt = media.indexOf(':root');
  if (darkRootAt === -1) throw new Error('The dark colour-scheme block has no :root rule');
  const dark = new Map(light);
  for (const [name, value] of customProperties(blockAfter(media, darkRootAt) ?? '')) {
    dark.set(name, value);
  }
  return { light, dark };
}

/**
 * Resolves a token to an opaque colour, following one level of `var(--other)` and
 * flattening translucent values over `over` (or white when none is given).
 */
export function resolveToken(
  tokens: ReadonlyMap<string, string>,
  name: string,
  over?: Rgb,
): Rgb | null {
  let value = tokens.get(name);
  for (let hops = 0; hops < 4 && value !== undefined; hops += 1) {
    const reference = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(value);
    if (reference === null) break;
    value = tokens.get(reference[1] ?? '');
  }
  if (value === undefined) return null;
  const colour = parseColour(value);
  if (colour === null) return null;
  return composite(colour, over ?? { r: 255, g: 255, b: 255 });
}
