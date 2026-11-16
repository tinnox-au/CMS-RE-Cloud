import { describe, expect, it } from 'vitest';
import { isTypeaheadKey, moveIndex, navActionForKey, typeaheadMatch } from './keyboardNav.ts';

describe('navActionForKey', () => {
  it('maps the keys of a vertical menu', () => {
    expect(navActionForKey('ArrowDown', 'vertical')).toBe('next');
    expect(navActionForKey('ArrowUp', 'vertical')).toBe('previous');
    expect(navActionForKey('Home', 'vertical')).toBe('first');
    expect(navActionForKey('End', 'vertical')).toBe('last');
    expect(navActionForKey('ArrowRight', 'vertical')).toBeNull();
  });

  it('maps the keys of a horizontal tab list', () => {
    expect(navActionForKey('ArrowRight', 'horizontal')).toBe('next');
    expect(navActionForKey('ArrowLeft', 'horizontal')).toBe('previous');
    expect(navActionForKey('ArrowDown', 'horizontal')).toBeNull();
    expect(navActionForKey('a', 'horizontal')).toBeNull();
  });
});

describe('moveIndex', () => {
  it('moves and wraps around both ends', () => {
    expect(moveIndex(0, 3, 'next')).toBe(1);
    expect(moveIndex(2, 3, 'next')).toBe(0);
    expect(moveIndex(0, 3, 'previous')).toBe(2);
    expect(moveIndex(1, 3, 'first')).toBe(0);
    expect(moveIndex(1, 3, 'last')).toBe(2);
  });

  it('enters the list from nothing focused', () => {
    expect(moveIndex(-1, 3, 'next')).toBe(0);
    expect(moveIndex(-1, 3, 'previous')).toBe(2);
  });

  it('steps over disabled items in the direction of travel', () => {
    const disabled = (index: number) => index === 1 || index === 3;
    expect(moveIndex(0, 4, 'next', disabled)).toBe(2);
    expect(moveIndex(2, 4, 'next', disabled)).toBe(0);
    expect(moveIndex(2, 4, 'previous', disabled)).toBe(0);
    expect(moveIndex(0, 4, 'last', disabled)).toBe(2);
    expect(moveIndex(2, 4, 'first', (index) => index === 0)).toBe(1);
  });

  it('answers -1 when there is nothing to land on', () => {
    expect(moveIndex(0, 0, 'next')).toBe(-1);
    expect(moveIndex(0, 2, 'next', () => true)).toBe(-1);
  });
});

describe('typeaheadMatch', () => {
  const LABELS = ['Open', 'Assign content', 'Add tags', 'Push now', 'Delete'];

  it('jumps to the next item starting with the letter, after the current one', () => {
    expect(typeaheadMatch(LABELS, 'a', -1)).toBe(1);
    expect(typeaheadMatch(LABELS, 'a', 1)).toBe(2);
    expect(typeaheadMatch(LABELS, 'a', 2)).toBe(1);
    expect(typeaheadMatch(LABELS, 'P', 0)).toBe(3);
  });

  it('treats a repeated letter as cycling', () => {
    expect(typeaheadMatch(LABELS, 'aa', 1)).toBe(2);
  });

  it('matches several letters as a prefix, starting at the current item', () => {
    expect(typeaheadMatch(LABELS, 'ad', 1)).toBe(2);
    expect(typeaheadMatch(LABELS, 'as', 1)).toBe(1);
    expect(typeaheadMatch(LABELS, 'de', 0)).toBe(4);
  });

  it('ignores disabled items and answers -1 for no match', () => {
    expect(typeaheadMatch(LABELS, 'a', -1, (index) => index === 1)).toBe(2);
    expect(typeaheadMatch(LABELS, 'z', 0)).toBe(-1);
    expect(typeaheadMatch(LABELS, '', 0)).toBe(-1);
    expect(typeaheadMatch([], 'a', 0)).toBe(-1);
  });

  it('folds accents and case', () => {
    expect(typeaheadMatch(['Écran', 'Zone'], 'e', -1)).toBe(0);
  });
});

describe('isTypeaheadKey', () => {
  const key = (
    value: string,
    modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {},
  ) => ({
    key: value,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers,
  });

  it('accepts single printable characters only', () => {
    expect(isTypeaheadKey(key('a'))).toBe(true);
    expect(isTypeaheadKey(key('É'))).toBe(true);
    expect(isTypeaheadKey(key('7'))).toBe(true);
    expect(isTypeaheadKey(key(' '))).toBe(false);
    expect(isTypeaheadKey(key('Enter'))).toBe(false);
    expect(isTypeaheadKey(key('ArrowDown'))).toBe(false);
  });

  it('leaves shortcuts alone', () => {
    expect(isTypeaheadKey(key('a', { ctrlKey: true }))).toBe(false);
    expect(isTypeaheadKey(key('a', { metaKey: true }))).toBe(false);
    expect(isTypeaheadKey(key('a', { altKey: true }))).toBe(false);
  });
});
