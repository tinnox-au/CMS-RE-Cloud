import { describe, expect, it } from 'vitest';
import { rowFocusCandidates } from './rowFocus.ts';

const ORDER = ['a', 'b', 'c', 'd'];

describe('rowFocusCandidates', () => {
  it('prefers the row after a deleted row, then the rows before it, nearest first', () => {
    expect(rowFocusCandidates(ORDER, ['b'], 'row')).toEqual(['c', 'd', 'a']);
  });

  it('falls back to the row before when the last row was deleted', () => {
    expect(rowFocusCandidates(ORDER, ['d'], 'row')).toEqual(['c', 'b', 'a']);
  });

  it('starts with the second row when the first was deleted', () => {
    expect(rowFocusCandidates(ORDER, ['a'], 'row')).toEqual(['b', 'c', 'd']);
  });

  it('leaves nothing when the only row was deleted, so the page fallback applies', () => {
    expect(rowFocusCandidates(['a'], ['a'], 'row')).toEqual([]);
  });

  it('uses the remaining rows from the top when the deleted row was not on view', () => {
    expect(rowFocusCandidates(ORDER, ['x'], 'row')).toEqual(ORDER);
  });

  it('chooses the first remaining row after a bulk delete', () => {
    expect(rowFocusCandidates(ORDER, ['a', 'c'], 'bulk')).toEqual(['b', 'd']);
    expect(rowFocusCandidates(ORDER, ['b'], 'bulk')).toEqual(['a', 'c', 'd']);
  });

  it('leaves nothing when every row was deleted in bulk, so the select-all checkbox applies', () => {
    expect(rowFocusCandidates(ORDER, ORDER, 'bulk')).toEqual([]);
  });

  it('never offers a deleted row', () => {
    expect(rowFocusCandidates(ORDER, ['b', 'c'], 'row')).toEqual(['a', 'd']);
  });
});
