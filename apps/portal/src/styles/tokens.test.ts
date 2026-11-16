import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, readTokenSets, resolveToken, type Rgb } from '../lib/contrast.ts';

/**
 * Reads tokens.css and checks the colour pairs the components actually use against
 * WCAG 2.2 AA: 4.5:1 for text, 3:1 for the boundaries and indicators a control is
 * recognised by. A palette change that breaks a pair fails here.
 */
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const themes = readTokenSets(css);

/**
 * A foreground on a background. A translucent background (glass, the fills) is measured as
 * it appears over `base`, which is the page (`--bg`) unless a third token is given.
 */
type Pair = readonly [foreground: string, background: string, base?: string];

const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-3'] as const;
const TINTS = ['--ok-bg', '--warn-bg', '--danger-bg'] as const;

/** Text: at least 4.5:1. */
const TEXT_PAIRS: readonly Pair[] = [
  // Primary and secondary text on every surface and fill, including the tinted banners. The
  // fills (secondary button, capsule, selected sidebar row) sit on cards and on the page.
  ...(['--ink', '--ink-2'] as const).flatMap((text): Pair[] => [
    ...SURFACES.map((back): Pair => [text, back]),
    ...TINTS.map((back): Pair => [text, back]),
    [text, '--neutral-bg'],
    [text, '--glass'],
    [text, '--fill'],
    [text, '--fill', '--surface'],
  ]),
  // A hovered secondary button keeps ink text.
  ['--ink', '--fill-hover'],
  ['--ink', '--fill-hover', '--surface'],
  // Links and text buttons on every surface they appear on, banners included (an error
  // summary links to its fields).
  ...(['--bg', '--surface', '--surface-2', ...TINTS] as const).map((back): Pair => [
    '--link',
    back,
  ]),
  ['--link-hover', '--bg'],
  ['--link-hover', '--surface'],
  ['--link-hover', '--surface-2'],
  // A hovered or pressed text button: the hover blue on the fill, on the page and on a card.
  ['--link-hover', '--fill'],
  ['--link-hover', '--fill', '--surface'],
  // Filled controls and badges, and the inverted badge on a filled button.
  ['--on-accent', '--accent'],
  ['--on-accent', '--accent-hover'],
  ['--accent', '--on-accent'],
  // The confirming button of a destructive dialog and the danger badge, also when hovered.
  ['--on-danger', '--danger'],
  ['--on-danger', '--danger-solid-hover'],
  // The destructive text button, hovered: the deeper red on its tint.
  ['--danger-text-hover', '--danger-bg'],
  // A pressed chip is inverted (surface text on ink, as the tooltip below), and stays
  // readable when hovered.
  ['--surface', '--chip-pressed-hover'],
  // Status text on plain surfaces, on a hovered or selected row and on its own tint.
  ...(['--ok', '--warn', '--danger'] as const).flatMap((status): Pair[] => [
    [status, '--bg'],
    [status, '--surface'],
    [status, '--surface-2'],
    [status, `${status}-bg`],
  ]),
  // Text in a chosen table row that is also hovered.
  ...(['--ink', '--ink-2', '--link', '--ok', '--warn', '--danger'] as const).map((text): Pair => [
    text,
    '--row-selected-hover',
  ]),
  // The destructive text button sits on a red tint: the danger text on its own fill.
  ['--danger', '--danger-bg', '--surface'],
  // An API code (`.tx-code`) is ink on the fill, inside a card, an inset and a red banner (the
  // push dialog's blocked reason).
  ['--ink', '--fill', '--surface-2'],
  ['--ink', '--fill', '--danger-bg'],
  ['--ink', '--fill', '--warn-bg'],
  // The neutral capsule ("Prototype", "Planned") is --ink-2 on the opaque --surface-3 (listed
  // with the surfaces above), so it keeps 4.5:1 on the page, a card and an inset alike: --ink-2
  // on --fill laid over --surface-2 reaches only 4.05:1 in dark, so that pairing is not used.
  // The hovered options of a picker list (the tag checklist) are --surface-3 too.
  // The tooltip is inverted.
  ['--surface', '--ink'],
];

/** Boundaries, indicators and icons: at least 3:1. */
const BOUNDARY_PAIRS: readonly Pair[] = [
  // The focus ring against everything a focused control can sit on.
  ...([...SURFACES, ...TINTS, '--neutral-bg'] as const).map((back): Pair => ['--focus', back]),
  ['--focus', '--fill'],
  ['--focus', '--fill', '--surface'],
  // Input, checkbox and switch-track boundaries.
  ['--line-control', '--surface'],
  ['--line-control', '--bg'],
  ['--line-control', '--surface-2'],
  // The checkbox and its focus ring in a chosen row that is hovered.
  ['--line-control', '--row-selected-hover'],
  ['--focus', '--row-selected-hover'],
  // Filled controls against the page and the card they sit on: the checked box, the switch
  // that is on. (On a hovered row in dark the white tick, 4.7:1 on the fill, carries the state.)
  ['--accent', '--bg'],
  ['--accent', '--surface'],
  // Meter and progress fills on their track.
  ['--accent', '--neutral-bg'],
  ['--warn', '--neutral-bg'],
  ['--danger', '--neutral-bg'],
  // Icons in the link colour that mark an active or selected item on a pressed fill (a
  // selected chip's tick, a settings icon in its tile, the dropzone while dragging).
  ['--link', '--surface-3'],
  // The search field's clear disc (--ink-2) on the field, its hover (--ink), and the cross
  // drawn on it in the surface colour.
  ['--ink-2', '--surface-3'],
  ['--ink', '--surface-3'],
  ['--surface', '--ink-2'],
  ['--surface', '--ink'],
  // The switch that is on, hovered, against the card and the page.
  ['--ok-hover', '--surface'],
  ['--ok-hover', '--bg'],
  // Something drawn in the surface colour on a filled --ok mark (a tick on a green fill).
  ['--surface', '--ok'],
  // The sidebar's section icons: on the page, on a hovered row and on the current row's fill.
  ['--nav-icon', '--bg'],
  ['--nav-icon', '--fill'],
  ['--nav-icon', '--fill-hover'],
  // Status dots.
  ...(['--ok', '--warn', '--danger', '--ink-3'] as const).flatMap((status): Pair[] => [
    [status, '--surface'],
    [status, '--bg'],
  ]),
  // Tag dots, and the tick drawn in the surface colour on the chosen colour swatch.
  ...['teal', 'sky', 'slate', 'green', 'amber', 'red', 'violet', 'pink'].flatMap((name): Pair[] => [
    [`--tag-${name}`, '--surface'],
    [`--tag-${name}`, '--surface-2'],
    ['--surface', `--tag-${name}`],
  ]),
];

/** Colour tokens that keep one value in both themes on purpose. */
const SAME_IN_BOTH_THEMES = new Set(['--accent', '--accent-hover', '--on-accent']);

function colour(tokens: ReadonlyMap<string, string>, name: string, over?: Rgb): Rgb {
  const resolved = resolveToken(tokens, name, over);
  if (resolved === null) throw new Error(`${name} is missing or is not a plain colour`);
  return resolved;
}

function ratio(tokens: ReadonlyMap<string, string>, [foreground, background, base]: Pair): number {
  // A translucent background is measured as it appears over its base (the page by default).
  const under = colour(tokens, base ?? '--bg');
  const back = colour(tokens, background, under);
  return contrastRatio(colour(tokens, foreground, back), back);
}

function label([foreground, background, base]: Pair): string {
  return base === undefined
    ? `${foreground} on ${background}`
    : `${foreground} on ${background} over ${base}`;
}

describe.each([
  ['light', themes.light],
  ['dark', themes.dark],
] as const)('%s theme contrast', (_name, tokens) => {
  it.each(TEXT_PAIRS.map((pair) => [label(pair), pair] as const))(
    '%s reaches 4.5:1',
    (_label, pair) => {
      expect(ratio(tokens, pair)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(BOUNDARY_PAIRS.map((pair) => [label(pair), pair] as const))(
    '%s reaches 3:1',
    (_label, pair) => {
      expect(ratio(tokens, pair)).toBeGreaterThanOrEqual(3);
    },
  );
});

describe('token sheet', () => {
  it('keeps the specification values for the palette', () => {
    const expected: Record<string, readonly [light: string, dark: string]> = {
      '--bg': ['#f5f5f7', '#000000'],
      '--surface': ['#ffffff', '#1c1c1e'],
      '--surface-2': ['#f5f5f7', '#2c2c2e'],
      '--surface-3': ['#e8e8ed', '#3a3a3c'],
      '--fill': ['rgb(0 0 0 / 0.06)', 'rgb(255 255 255 / 0.1)'],
      '--line': ['rgb(0 0 0 / 0.08)', 'rgb(255 255 255 / 0.12)'],
      '--line-control': ['#86868b', '#8e8e93'],
      '--ink': ['#1d1d1f', '#f5f5f7'],
      '--ink-2': ['#67676c', '#a3a3a8'],
      '--ink-3': ['#86868b', '#6e6e73'],
      '--accent': ['#0071e3', '#0071e3'],
      '--on-accent': ['#ffffff', '#ffffff'],
      '--link': ['#0066cc', '#2997ff'],
      '--focus': ['#0071e3', '#2997ff'],
      '--ok': ['#1d7a36', '#30d158'],
      '--warn': ['#b25000', '#ff9f0a'],
      '--danger': ['#d70015', '#ff5d53'],
    };
    for (const [name, [light, dark]] of Object.entries(expected)) {
      expect(themes.light.get(name), `${name} (light)`).toBe(light);
      expect(themes.dark.get(name), `${name} (dark)`).toBe(dark);
    }
  });

  it('defines every colour token in both themes', () => {
    // Everything that resolves to a colour; shadows, sizes and font stacks do not.
    const colourTokens = [...themes.light.keys()].filter(
      (name) => resolveToken(themes.light, name) !== null,
    );
    expect(colourTokens.length).toBeGreaterThan(30);
    for (const name of colourTokens) {
      if (SAME_IN_BOTH_THEMES.has(name)) continue;
      expect(themes.dark.get(name), name).not.toBe(themes.light.get(name));
    }
  });

  it('keeps the old brand tokens and the heading web font out', () => {
    for (const name of ['--brand', '--brand-hover', '--on-brand']) {
      expect(themes.light.has(name), name).toBe(false);
    }
    expect(css).not.toMatch(/manrope/i);
    expect(themes.light.get('--font-body')).toMatch(/^-apple-system/);
  });

  it('stops all motion tokens under reduced motion', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(
      css,
    );
    expect(reduced?.[1]).toMatch(/--t-fast:\s*0ms/);
    expect(reduced?.[1]).toMatch(/--t:\s*0ms/);
    expect(reduced?.[1]).toMatch(/--t-slow:\s*0ms/);
  });
});
