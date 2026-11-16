import { describe, expect, it } from 'vitest';
import {
  composite,
  contrastRatio,
  parseColour,
  readTokenSets,
  relativeLuminance,
  resolveToken,
} from './contrast.ts';

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

describe('parseColour', () => {
  it('reads the hex forms', () => {
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('#0071E3')).toEqual({ r: 0, g: 113, b: 227, a: 1 });
    expect(parseColour('#00000080')?.a).toBeCloseTo(0.502, 2);
    expect(parseColour('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 136 / 255 });
  });

  it('reads the rgb() forms, with and without alpha', () => {
    expect(parseColour('rgb(18 33 42)')).toEqual({ r: 18, g: 33, b: 42, a: 1 });
    expect(parseColour('rgb(18 33 42 / 0.36)')).toEqual({ r: 18, g: 33, b: 42, a: 0.36 });
    expect(parseColour('rgb(255 255 255 / 72%)')).toEqual({ r: 255, g: 255, b: 255, a: 0.72 });
    expect(parseColour('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColour('rgb(100%, 0%, 50%)')).toEqual({ r: 255, g: 0, b: 127.5, a: 1 });
  });

  it('answers null for what it does not understand', () => {
    for (const text of ['', 'teal', '#12', '#12345', 'rgb(1 2)', 'rgb(a b c)', 'var(--ink)']) {
      expect(parseColour(text), text).toBeNull();
    }
  });
});

describe('contrast maths', () => {
  it('gives the reference values for black and white', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5);
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
  });

  it('matches a published pair: #767676 on white is 4.54 to 1', () => {
    expect(contrastRatio({ r: 0x76, g: 0x76, b: 0x76 }, WHITE)).toBeCloseTo(4.54, 2);
  });

  it('flattens a translucent colour over its background', () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
    });
    expect(composite({ r: 10, g: 20, b: 30, a: 1 }, WHITE)).toEqual({ r: 10, g: 20, b: 30 });
  });
});

describe('readTokenSets', () => {
  const css = `
    /* --ignored: #000; */
    :root {
      color-scheme: light dark;
      --bg: #ffffff;
      --ink: #111111;
      --alias: var(--ink);
      --veil: rgb(0 0 0 / 0.5);
      --r: 6px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #000000;
        --ink: #eeeeee;
      }
    }
  `;

  it('reads the light set and overlays the dark overrides', () => {
    const { light, dark } = readTokenSets(css);
    expect(light.get('--bg')).toBe('#ffffff');
    expect(light.has('--ignored')).toBe(false);
    expect(dark.get('--bg')).toBe('#000000');
    expect(dark.get('--r')).toBe('6px');
  });

  it('resolves aliases and flattens translucent tokens', () => {
    const { light, dark } = readTokenSets(css);
    expect(resolveToken(light, '--alias')).toEqual({ r: 17, g: 17, b: 17 });
    expect(resolveToken(dark, '--alias')).toEqual({ r: 238, g: 238, b: 238 });
    expect(resolveToken(light, '--veil', WHITE)).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
    expect(resolveToken(light, '--r')).toBeNull();
    expect(resolveToken(light, '--missing')).toBeNull();
  });

  it('refuses a stylesheet without the two blocks', () => {
    expect(() => readTokenSets('body { color: red; }')).toThrow(/:root/);
    expect(() => readTokenSets(':root { --bg: #fff; }')).toThrow(/dark/);
  });
});
