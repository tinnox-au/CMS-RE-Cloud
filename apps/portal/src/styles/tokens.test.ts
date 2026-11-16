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

type Pair = readonly [foreground: string, background: string];

/** Text: at least 4.5:1. */
const TEXT_PAIRS: readonly Pair[] = [
  // Primary text on every surface it is set on, including the tinted status surfaces.
  ['--ink', '--bg'],
  ['--ink', '--surface'],
  ['--ink', '--surface-2'],
  ['--ink', '--surface-3'],
  ['--ink', '--neutral-bg'],
  ['--ink', '--glass'],
  ['--ink', '--ok-bg'],
  ['--ink', '--warn-bg'],
  ['--ink', '--danger-bg'],
  // Secondary text, table headers, placeholders, the neutral status pill.
  ['--ink-2', '--bg'],
  ['--ink-2', '--surface'],
  ['--ink-2', '--surface-2'],
  ['--ink-2', '--neutral-bg'],
  ['--ink-2', '--glass'],
  // Secondary text inside a banner.
  ['--ink-2', '--ok-bg'],
  ['--ink-2', '--warn-bg'],
  ['--ink-2', '--danger-bg'],
  // Links, the active navigation item, the selected tab.
  ['--brand', '--bg'],
  ['--brand', '--surface'],
  ['--brand', '--surface-2'],
  ['--brand', '--surface-3'],
  ['--brand-hover', '--surface'],
  ['--brand-hover', '--bg'],
  ['--brand-hover', '--surface-2'],
  // Links inside a banner (an error summary links to its fields).
  ['--brand', '--ok-bg'],
  ['--brand', '--warn-bg'],
  ['--brand', '--danger-bg'],
  // Filled buttons and badges.
  ['--on-brand', '--brand'],
  ['--on-brand', '--brand-hover'],
  ['--on-brand', '--danger'],
  ['--brand', '--on-brand'],
  // Status text on its own tint and on plain surfaces.
  ['--ok', '--ok-bg'],
  ['--ok', '--surface'],
  ['--warn', '--warn-bg'],
  ['--warn', '--surface'],
  ['--danger', '--danger-bg'],
  ['--danger', '--surface'],
  ['--danger', '--bg'],
  // Status text on a hovered or selected row.
  ['--ok', '--surface-2'],
  ['--warn', '--surface-2'],
  ['--danger', '--surface-2'],
  // The tooltip is inverted.
  ['--surface', '--ink'],
];

/** Boundaries and indicators: at least 3:1. */
const BOUNDARY_PAIRS: readonly Pair[] = [
  // The focus ring against everything a focused control can sit on.
  ['--focus', '--bg'],
  ['--focus', '--surface'],
  ['--focus', '--surface-2'],
  ['--focus', '--surface-3'],
  ['--focus', '--neutral-bg'],
  ['--focus', '--ok-bg'],
  ['--focus', '--warn-bg'],
  ['--focus', '--danger-bg'],
  // Input, checkbox and switch-track boundaries; the segmented thumb.
  ['--line-control', '--surface'],
  ['--line-control', '--bg'],
  ['--line-control', '--surface-2'],
  // Checked boxes, the switch that is on, meter fills.
  ['--brand', '--neutral-bg'],
  ['--warn', '--neutral-bg'],
  ['--danger', '--neutral-bg'],
  // Tag dots.
  ...['teal', 'sky', 'slate', 'green', 'amber', 'red', 'violet', 'pink'].flatMap((name): Pair[] => [
    [`--tag-${name}`, '--surface'],
    [`--tag-${name}`, '--surface-2'],
  ]),
];

function colour(tokens: ReadonlyMap<string, string>, name: string, over?: Rgb): Rgb {
  const resolved = resolveToken(tokens, name, over);
  if (resolved === null) throw new Error(`${name} is missing or is not a plain colour`);
  return resolved;
}

function ratio(tokens: ReadonlyMap<string, string>, [foreground, background]: Pair): number {
  // A translucent surface (glass) is measured as it appears over the page background.
  const page = colour(tokens, '--bg');
  const back = colour(tokens, background, page);
  return contrastRatio(colour(tokens, foreground, back), back);
}

describe.each([
  ['light', themes.light],
  ['dark', themes.dark],
] as const)('%s theme contrast', (_name, tokens) => {
  it.each(TEXT_PAIRS)('%s on %s reaches 4.5:1', (foreground, background) => {
    expect(ratio(tokens, [foreground, background])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BOUNDARY_PAIRS)('%s against %s reaches 3:1', (foreground, background) => {
    expect(ratio(tokens, [foreground, background])).toBeGreaterThanOrEqual(3);
  });
});

describe('token sheet', () => {
  it('keeps the specification values for the palette', () => {
    const expected: Record<string, readonly [light: string, dark: string]> = {
      '--bg': ['#f6f8f8', '#0c161c'],
      '--surface': ['#ffffff', '#12212a'],
      '--surface-2': ['#eff5f7', '#182c38'],
      '--surface-3': ['#dce9ed', '#21404f'],
      '--line': ['#dce7ea', '#24404d'],
      '--line-strong': ['#b7d3dc', '#35606f'],
      '--ink': ['#12212a', '#f1f6f7'],
      '--ink-2': ['#5d6b73', '#a9bcc4'],
      '--ink-3': ['#93a1a7', '#7a8f98'],
      '--brand': ['#0f4761', '#72afc2'],
      '--brand-hover': ['#0d384d', '#8fc2d2'],
      '--on-brand': ['#ffffff', '#0c161c'],
      '--ok': ['#1b6e45', '#6fd3a0'],
      '--ok-bg': ['#e6f4ec', '#143526'],
      '--warn': ['#8a5a00', '#f0c267'],
      '--warn-bg': ['#fbf1dc', '#3a2c0d'],
      '--danger': ['#a4262c', '#ff8f95'],
      '--danger-bg': ['#fbe9ea', '#42181b'],
      '--neutral-bg': ['#eaf0f1', '#21343e'],
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
      expect(themes.dark.get(name), name).not.toBe(themes.light.get(name));
    }
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
