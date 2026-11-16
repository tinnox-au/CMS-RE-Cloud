/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = [
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  "setAttribute('style'",
  'cssText',
  'fetch(',
  'XMLHttpRequest',
  'import(',
];

describe('app-render build checks', () => {
  it('draws without HTML strings, style attributes or network', () => {
    const dir = new URL('./', import.meta.url);
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources).toContain('render.ts');
    for (const file of sources) {
      const text = readFileSync(new URL(file, dir), 'utf8');
      for (const word of FORBIDDEN) expect(text.includes(word), `${file} uses ${word}`).toBe(false);
    }
  });
});
