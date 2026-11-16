import { TAG_COLOURS, type TagColour, type TagDto } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyTagChanges,
  findTagByName,
  matchesTagFilter,
  MAX_TAGS_PER_ITEM,
  NO_TAG_CHANGES,
  resolveTags,
  searchTags,
  sortTags,
  suggestTagColour,
  summariseTags,
  TAG_COLOUR_LABELS,
  tagColourLabel,
  tagCoverage,
  tagNameProblem,
  tagsById,
  tagStateWithChanges,
  toggleTagChange,
  type TagChanges,
} from './tagColours.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function tag(n: number, name: string, colour: TagColour = 'teal'): TagDto {
  return { id: ID(n), scope: 'media', name, colour, usageCount: 0 };
}

const FOYER = tag(1, 'Foyer', 'teal');
const PROMO = tag(2, 'promo', 'amber');
const AISLE = tag(3, 'Aisle 10', 'sky');
const AISLE2 = tag(4, 'Aisle 2', 'sky');
const ALL = [FOYER, PROMO, AISLE, AISLE2];

describe('tag colours', () => {
  it('names every colour of the contract', () => {
    expect(Object.keys(TAG_COLOUR_LABELS).sort()).toEqual([...TAG_COLOURS].sort());
    expect(tagColourLabel('violet')).toBe('Violet');
  });

  it('proposes the default colour first and then the least used one', () => {
    expect(suggestTagColour([])).toBe('teal');
    expect(suggestTagColour([FOYER])).toBe('sky');
    expect(suggestTagColour(ALL)).toBe('slate');
    const oneOfEach = TAG_COLOURS.map((colour, index) => tag(index + 10, `t${index}`, colour));
    expect(suggestTagColour(oneOfEach)).toBe('teal');
    expect(suggestTagColour([...oneOfEach, tag(30, 'more', 'teal')])).toBe('sky');
  });
});

describe('tag lists', () => {
  it('orders by name without case and with digits as numbers', () => {
    expect(sortTags(ALL).map((t) => t.name)).toEqual(['Aisle 2', 'Aisle 10', 'Foyer', 'promo']);
    expect(ALL[0]).toBe(FOYER);
  });

  it('resolves ids to tags in name order, skipping unknown and repeated ids', () => {
    const byId = tagsById(ALL);
    expect(resolveTags([PROMO.id, ID(99), FOYER.id, PROMO.id], byId)).toEqual([FOYER, PROMO]);
    expect(resolveTags([], byId)).toEqual([]);
    expect(resolveTags([FOYER.id], new Map())).toEqual([]);
  });

  it('keeps a row to the limit and never spends a chip on "+1"', () => {
    const names = (max: number, count: number) => {
      const summary = summariseTags(ALL.slice(0, count), max);
      return [summary.shown.length, summary.hidden.length];
    };
    expect(names(2, 0)).toEqual([0, 0]);
    expect(names(2, 2)).toEqual([2, 0]);
    expect(names(2, 3)).toEqual([3, 0]);
    expect(names(2, 4)).toEqual([2, 2]);
    expect(names(0, 4)).toEqual([1, 3]);
    expect(summariseTags(ALL, 2).hidden).toEqual([AISLE, AISLE2]);
  });

  it('searches names by every word, ignoring case and accents', () => {
    expect(searchTags(ALL, '')).toEqual(ALL);
    expect(searchTags(ALL, 'ais 10')).toEqual([AISLE]);
    expect(searchTags(ALL, 'PROMO')).toEqual([PROMO]);
    expect(searchTags([tag(5, 'Café')], 'cafe')).toHaveLength(1);
    expect(searchTags(ALL, 'zz')).toEqual([]);
  });

  it('finds a tag by its exact name the way the API compares names', () => {
    expect(findTagByName(ALL, '  PROMO ')).toBe(PROMO);
    expect(findTagByName(ALL, 'prom')).toBeUndefined();
    expect(findTagByName(ALL, '   ')).toBeUndefined();
  });
});

describe('tag name check', () => {
  it('accepts a name the API accepts', () => {
    expect(tagNameProblem('Foyer')).toBeNull();
    expect(tagNameProblem('  Level 2 / north  ')).toBeNull();
    expect(tagNameProblem('x'.repeat(40))).toBeNull();
  });

  it('refuses an empty, an over-long and a control-character name', () => {
    expect(tagNameProblem('   ')).toBe('Enter a name for the tag.');
    expect(tagNameProblem('x'.repeat(41))).toBe('Use 40 characters or fewer.');
    expect(tagNameProblem('a\u0007b')).toBe('The name contains characters that cannot be used.');
    expect(tagNameProblem('a\nb')).toBe('The name contains characters that cannot be used.');
  });
});

describe('tag filter', () => {
  const selected = new Set([FOYER.id, PROMO.id]);

  it('lets everything through when nothing is selected', () => {
    expect(matchesTagFilter([], new Set())).toBe(true);
    expect(matchesTagFilter([AISLE.id], new Set(), 'all')).toBe(true);
  });

  it('needs one selected tag by default and every selected tag in "all" mode', () => {
    expect(matchesTagFilter([PROMO.id, AISLE.id], selected)).toBe(true);
    expect(matchesTagFilter([AISLE.id], selected)).toBe(false);
    expect(matchesTagFilter([], selected)).toBe(false);
    expect(matchesTagFilter([PROMO.id, AISLE.id], selected, 'all')).toBe(false);
    expect(matchesTagFilter([PROMO.id, FOYER.id, AISLE.id], selected, 'all')).toBe(true);
  });
});

describe('editing the tags of several items', () => {
  // Item one carries Foyer and promo, item two carries Foyer, item three nothing of ours.
  const lists = [[FOYER.id, PROMO.id], [FOYER.id], [AISLE.id]];

  it('reports how many of the items carry a tag', () => {
    expect(tagCoverage([[FOYER.id], [FOYER.id]], FOYER.id)).toBe('all');
    expect(tagCoverage(lists, FOYER.id)).toBe('some');
    expect(tagCoverage(lists, AISLE2.id)).toBe('none');
    expect(tagCoverage([], FOYER.id)).toBe('none');
  });

  it('turns a partly carried tag on for all, then off for all, then on again', () => {
    let changes: TagChanges = NO_TAG_CHANGES;
    expect(tagStateWithChanges('some', changes, FOYER.id)).toBe('some');
    changes = toggleTagChange('some', changes, FOYER.id);
    expect(tagStateWithChanges('some', changes, FOYER.id)).toBe('all');
    changes = toggleTagChange('some', changes, FOYER.id);
    expect(tagStateWithChanges('some', changes, FOYER.id)).toBe('none');
    changes = toggleTagChange('some', changes, FOYER.id);
    expect(tagStateWithChanges('some', changes, FOYER.id)).toBe('all');
  });

  it('drops a decision that restates how things are, so undoing leaves nothing to save', () => {
    let changes = toggleTagChange('all', NO_TAG_CHANGES, FOYER.id);
    expect([...changes.remove]).toEqual([FOYER.id]);
    changes = toggleTagChange('all', changes, FOYER.id);
    expect(changes.add.size + changes.remove.size).toBe(0);

    changes = toggleTagChange('none', NO_TAG_CHANGES, PROMO.id);
    expect([...changes.add]).toEqual([PROMO.id]);
    changes = toggleTagChange('none', changes, PROMO.id);
    expect(changes.add.size + changes.remove.size).toBe(0);
  });

  it('does not change the set it was given', () => {
    toggleTagChange('none', NO_TAG_CHANGES, PROMO.id);
    expect(NO_TAG_CHANGES.add.size).toBe(0);
    expect(NO_TAG_CHANGES.remove.size).toBe(0);
  });

  it('builds the complete new tag list of each item and leaves untouched tags alone', () => {
    const changes: TagChanges = { add: new Set([PROMO.id]), remove: new Set([FOYER.id]) };
    expect(lists.map((current) => applyTagChanges(current, changes))).toEqual([
      [PROMO.id],
      [PROMO.id],
      [AISLE.id, PROMO.id],
    ]);
  });

  it('answers null for an item the changes do not touch, so no request is sent for it', () => {
    const changes: TagChanges = { add: new Set([FOYER.id]), remove: new Set([AISLE2.id]) };
    expect(applyTagChanges([FOYER.id, PROMO.id], changes)).toBeNull();
    expect(applyTagChanges([FOYER.id], NO_TAG_CHANGES)).toBeNull();
    expect(applyTagChanges([], NO_TAG_CHANGES)).toBeNull();
  });

  it('knows the limit of tags on one item', () => {
    expect(MAX_TAGS_PER_ITEM).toBe(50);
  });
});
