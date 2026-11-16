import { describe, expect, it } from 'vitest';
import {
  pruneSelection,
  selectedRows,
  selectRange,
  setMany,
  summariseSelection,
  toggleAll,
  toggleOne,
} from './selection.ts';

const PAGE = ['a', 'b', 'c', 'd'];
const sorted = (set: ReadonlySet<string>): string => [...set].sort().join('');

describe('selection', () => {
  it('summarises none, some and all for the header checkbox', () => {
    expect(summariseSelection(PAGE, new Set())).toBe('none');
    expect(summariseSelection(PAGE, new Set(['b']))).toBe('some');
    expect(summariseSelection(PAGE, new Set(PAGE))).toBe('all');
    expect(summariseSelection(PAGE, new Set(['x', 'y']))).toBe('none');
    expect(summariseSelection([], new Set(['a']))).toBe('none');
  });

  it('toggles one row without touching the input set', () => {
    const start: ReadonlySet<string> = new Set(['a']);
    expect(sorted(toggleOne(start, 'b'))).toBe('ab');
    expect(sorted(toggleOne(start, 'a'))).toBe('');
    expect(sorted(start)).toBe('a');
  });

  it('selects all from mixed, and clears only when everything is selected', () => {
    expect(sorted(toggleAll(PAGE, new Set(['b'])))).toBe('abcd');
    expect(sorted(toggleAll(PAGE, new Set(PAGE)))).toBe('');
  });

  it('leaves rows of other pages alone when toggling a page', () => {
    expect(sorted(toggleAll(PAGE, new Set(['z'])))).toBe('abcdz');
    expect(sorted(toggleAll(PAGE, new Set([...PAGE, 'z'])))).toBe('z');
  });

  it('adds and removes several at once', () => {
    expect(sorted(setMany(new Set(['a']), ['b', 'c'], true))).toBe('abc');
    expect(sorted(setMany(new Set(['a', 'b', 'c']), ['b', 'x'], false))).toBe('ac');
  });

  it('selects a range in either direction', () => {
    expect(sorted(selectRange(PAGE, new Set(['a']), 'a', 'c'))).toBe('abc');
    expect(sorted(selectRange(PAGE, new Set(['d']), 'd', 'b'))).toBe('bcd');
  });

  it('selects only the target when the anchor is unknown, and nothing for an unknown target', () => {
    expect(sorted(selectRange(PAGE, new Set(), null, 'c'))).toBe('c');
    expect(sorted(selectRange(PAGE, new Set(), 'gone', 'c'))).toBe('c');
    const start: ReadonlySet<string> = new Set(['a']);
    expect(selectRange(PAGE, start, 'a', 'gone')).toBe(start);
  });

  it('prunes ids that no longer exist and keeps the instance when nothing changed', () => {
    const start: ReadonlySet<string> = new Set(['a', 'x']);
    expect(sorted(pruneSelection(start, PAGE))).toBe('a');
    const same: ReadonlySet<string> = new Set(['a', 'b']);
    expect(pruneSelection(same, PAGE)).toBe(same);
    const empty: ReadonlySet<string> = new Set();
    expect(pruneSelection(empty, [])).toBe(empty);
  });

  it('lists the selected rows in display order', () => {
    const rows = PAGE.map((id) => ({ id }));
    expect(selectedRows(rows, new Set(['c', 'a']), (row) => row.id)).toEqual([
      { id: 'a' },
      { id: 'c' },
    ]);
  });
});
