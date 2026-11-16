import type { FolderDto } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  findFolderByName,
  folderLabel,
  folderNameProblem,
  itemsToMove,
  LIBRARY_ROOT_LABEL,
  searchFolders,
  sortFolders,
} from './folderChoice.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function folder(n: number, name: string): FolderDto {
  return { id: ID(n), name, itemCount: n };
}

const PROMO = folder(1, 'Promotions');
const MENU = folder(2, 'menu boards');
const WEEK = folder(3, 'Week 10');
const WEEK2 = folder(4, 'Week 2');
const ALL = [PROMO, MENU, WEEK, WEEK2];

describe('folders', () => {
  it('orders by name without case and with digits as numbers', () => {
    expect(sortFolders(ALL).map((f) => f.name)).toEqual([
      'menu boards',
      'Promotions',
      'Week 2',
      'Week 10',
    ]);
    expect(ALL[0]).toBe(PROMO);
  });

  it('names the place an item is in', () => {
    const byId = new Map(ALL.map((f) => [f.id, f]));
    expect(folderLabel(null, byId)).toBe(LIBRARY_ROOT_LABEL);
    expect(folderLabel(MENU.id, byId)).toBe('menu boards');
    expect(folderLabel(ID(99), byId)).toBe('Folder not found');
  });

  it('finds a folder by its exact name the way the API compares names', () => {
    expect(findFolderByName(ALL, ' MENU BOARDS ')).toBe(MENU);
    expect(findFolderByName(ALL, 'menu')).toBeUndefined();
    expect(findFolderByName(ALL, '')).toBeUndefined();
  });

  it('searches names by every word', () => {
    expect(searchFolders(ALL, '')).toEqual(ALL);
    expect(searchFolders(ALL, 'week 1')).toEqual([WEEK]);
    expect(searchFolders(ALL, 'zz')).toEqual([]);
  });
});

describe('folder name check', () => {
  it('accepts a new name the API accepts', () => {
    expect(folderNameProblem('Spring 2027', ALL)).toBeNull();
    expect(folderNameProblem('x'.repeat(80))).toBeNull();
  });

  it('refuses an empty, an over-long, a control-character and a taken name', () => {
    expect(folderNameProblem('  ')).toBe('Enter a name for the folder.');
    expect(folderNameProblem('x'.repeat(81))).toBe('Use 80 characters or fewer.');
    expect(folderNameProblem('a\u0000b')).toBe('The name contains characters that cannot be used.');
    expect(folderNameProblem(' promotions ', ALL)).toBe('A folder with this name already exists.');
  });
});

describe('moving items', () => {
  const items = [
    { id: 'a', folderId: null },
    { id: 'b', folderId: PROMO.id },
    { id: 'c', folderId: MENU.id },
  ];

  it('moves only the items that are not already in the target', () => {
    expect(itemsToMove(items, PROMO.id).map((i) => i.id)).toEqual(['a', 'c']);
    expect(itemsToMove(items, null).map((i) => i.id)).toEqual(['b', 'c']);
    expect(itemsToMove([items[0]!], null)).toEqual([]);
  });
});
