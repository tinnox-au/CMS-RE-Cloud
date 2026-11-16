import { ABSOLUTE, type TagDto, type TagScope } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  folderCountLabel,
  folderPath,
  folderItemsLabel,
  parseTagScope,
  PLANNED_SETTINGS,
  plannedStageLabel,
  tagCountLabel,
  tagDeleteConsequence,
  tagFormNameProblem,
  tagItemsPath,
  tagRefusalNameProblem,
  tagPatchFor,
  tagSavedMessage,
  tagScopeWords,
  tagsOfScope,
  tagsPath,
  tagUsageLabel,
} from './settingsView.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function tag(n: number, name: string, scope: TagScope = 'media', usageCount = 0): TagDto {
  return { id: ID(n), scope, name, colour: 'teal', usageCount };
}

const PROMO = tag(1, 'Promo');
const MENU = tag(2, 'Menu boards');
const FOYER = tag(3, 'Foyer', 'display');

describe('tag scopes', () => {
  it('reads the scope from the address and falls back to media tags', () => {
    expect(parseTagScope('display')).toBe('display');
    expect(parseTagScope('media')).toBe('media');
    expect(parseTagScope('screen')).toBe('media');
    expect(parseTagScope('')).toBe('media');
    expect(parseTagScope(null)).toBe('media');
    expect(parseTagScope(undefined)).toBe('media');
  });

  it('links to the tags of a scope', () => {
    expect(tagsPath('media')).toBe('/settings/tags?scope=media');
    expect(tagsPath('display')).toBe('/settings/tags?scope=display');
    expect(parseTagScope(new URLSearchParams(tagsPath('display').split('?')[1]).get('scope'))).toBe(
      'display',
    );
  });

  it('says screen for the scope the API calls display', () => {
    const words = tagScopeWords('display');
    expect(words.title).toBe('Screen tags');
    expect(words.item).toBe('screen');
    const texts = [
      ...(['display', 'media'] as const).flatMap((scope) => {
        const w = tagScopeWords(scope);
        return [w.title, w.tag, w.item, w.items, w.description];
      }),
      tagUsageLabel('display', 2),
      tagDeleteConsequence('display', 0),
      tagDeleteConsequence('display', 1),
      tagDeleteConsequence('display', 4),
      tagFormNameProblem('Foyer', 'display', [FOYER]) ?? '',
      ...PLANNED_SETTINGS.flatMap((row) => [row.title, row.description]),
    ];
    for (const text of texts) {
      expect(text.toLowerCase()).not.toMatch(/\bdisplays?\b/);
      expect(text.toLowerCase()).not.toContain('online');
      expect(text.toLowerCase()).not.toContain('offline');
    }
  });

  it('separates the tags of one scope', () => {
    expect(tagsOfScope([PROMO, FOYER, MENU], 'media')).toEqual([PROMO, MENU]);
    expect(tagsOfScope([PROMO, FOYER, MENU], 'display')).toEqual([FOYER]);
  });
});

describe('counts', () => {
  it('counts tags and folders', () => {
    expect(tagCountLabel(0)).toBe('No tags');
    expect(tagCountLabel(1)).toBe('1 tag');
    expect(tagCountLabel(12)).toBe('12 tags');
    expect(folderCountLabel(0)).toBe('No folders');
    expect(folderCountLabel(1)).toBe('1 folder');
    expect(folderCountLabel(3)).toBe('3 folders');
    expect(folderItemsLabel(0)).toBe('Empty');
    expect(folderItemsLabel(1)).toBe('1 file');
    expect(folderItemsLabel(8)).toBe('8 files');
  });

  it('says what carries a tag', () => {
    expect(tagUsageLabel('media', 0)).toBe('Not used');
    expect(tagUsageLabel('media', 1)).toBe('1 file');
    expect(tagUsageLabel('media', 4)).toBe('4 files');
    expect(tagUsageLabel('display', 1)).toBe('1 screen');
    expect(tagUsageLabel('display', 4)).toBe('4 screens');
  });
});

describe('tag form', () => {
  it('applies the rules of the API to the name', () => {
    expect(tagFormNameProblem('', 'media', [])).toBe('Enter a name for the tag.');
    expect(tagFormNameProblem('   ', 'media', [])).toBe('Enter a name for the tag.');
    expect(tagFormNameProblem('x'.repeat(41), 'media', [])).toBe('Use 40 characters or fewer.');
    expect(tagFormNameProblem('x'.repeat(40), 'media', [])).toBeNull();
    expect(tagFormNameProblem('Week 10', 'media', [PROMO])).toBeNull();
  });

  it('refuses a name another tag of the scope has, ignoring case and outer spaces', () => {
    expect(tagFormNameProblem('promo', 'media', [PROMO, MENU])).toBe(
      'Another media tag already has this name.',
    );
    expect(tagFormNameProblem('  PROMO ', 'media', [PROMO, MENU])).toBe(
      'Another media tag already has this name.',
    );
    expect(tagFormNameProblem('foyer', 'display', [FOYER])).toBe(
      'Another screen tag already has this name.',
    );
  });

  it('lets an edited tag keep its name or change only its letter case', () => {
    expect(tagFormNameProblem('Promo', 'media', [PROMO, MENU], PROMO.id)).toBeNull();
    expect(tagFormNameProblem('PROMO', 'media', [PROMO, MENU], PROMO.id)).toBeNull();
    expect(tagFormNameProblem('menu boards', 'media', [PROMO, MENU], PROMO.id)).toBe(
      'Another media tag already has this name.',
    );
  });

  it('sends only what changed', () => {
    expect(tagPatchFor(PROMO, { name: 'Promo', colour: 'teal' })).toBeNull();
    expect(tagPatchFor(PROMO, { name: '  Promo  ', colour: 'teal' })).toBeNull();
    expect(tagPatchFor(PROMO, { name: ' Promotions ', colour: 'teal' })).toEqual({
      name: 'Promotions',
    });
    expect(tagPatchFor(PROMO, { name: 'Promo', colour: 'red' })).toEqual({ colour: 'red' });
    expect(tagPatchFor(PROMO, { name: 'PROMO', colour: 'pink' })).toEqual({
      name: 'PROMO',
      colour: 'pink',
    });
  });

  it('reports what an edit changed', () => {
    expect(tagSavedMessage({ name: 'A' })).toBe('Tag renamed');
    expect(tagSavedMessage({ colour: 'red' })).toBe('Tag colour changed');
    expect(tagSavedMessage({ name: 'A', colour: 'red' })).toBe('Tag renamed and recoloured');
  });
});

describe('deleting a tag', () => {
  it('says how many items lose the tag', () => {
    expect(tagDeleteConsequence('media', 0)).toBe(
      'No file carries this tag, so nothing else changes.',
    );
    expect(tagDeleteConsequence('media', 1)).toBe(
      '1 file will lose this tag. The file itself is not changed.',
    );
    expect(tagDeleteConsequence('media', 12)).toBe(
      '12 files will lose this tag. The files themselves are not changed.',
    );
    expect(tagDeleteConsequence('display', 3)).toBe(
      '3 screens will lose this tag. The screens themselves are not changed.',
    );
  });
});

describe('planned settings', () => {
  it('lists the four planned rows with their stage', () => {
    expect(PLANNED_SETTINGS.map((row) => [row.title, row.stage])).toEqual([
      ['Users and roles', 'C'],
      ['Working hours', 'B'],
      ['Alerts', 'C'],
      ['API tokens', null],
    ]);
    expect(new Set(PLANNED_SETTINGS.map((row) => row.id)).size).toBe(PLANNED_SETTINGS.length);
  });

  it('points working hours to the tab of each screen', () => {
    expect(PLANNED_SETTINGS.find((row) => row.id === 'working-hours')?.description).toBe(
      'Default hours for new screens. Set hours per screen on its Working hours tab.',
    );
  });

  it('names the stage', () => {
    expect(plannedStageLabel('B')).toBe('Planned for stage B');
    expect(plannedStageLabel('C')).toBe('Planned for stage C');
    expect(plannedStageLabel(null)).toBe('Planned for a later stage');
  });
});

describe('refusals of the tag form', () => {
  it('puts a name already in use at the name field', () => {
    expect(tagRefusalNameProblem('media', { code: 'conflict' }, 3)).toBe(
      'Another media tag already has this name. Choose a different name.',
    );
    expect(tagRefusalNameProblem('display', { code: 'conflict' }, 3)).toContain('screen tag');
  });

  it('does not blame the name when the organisation has the most tags it may have', () => {
    expect(tagRefusalNameProblem('media', { code: 'conflict' }, ABSOLUTE.maxListItems)).toBeNull();
  });

  it('puts a refused name at the field and leaves every other refusal to the alert', () => {
    expect(
      tagRefusalNameProblem('media', { code: 'validation_failed', details: [{ path: 'name' }] }, 0),
    ).not.toBeNull();
    expect(
      tagRefusalNameProblem(
        'media',
        { code: 'validation_failed', details: [{ path: 'colour' }] },
        0,
      ),
    ).toBeNull();
    expect(tagRefusalNameProblem('media', { code: 'not_found' }, 0)).toBeNull();
    expect(tagRefusalNameProblem('media', { code: 'network_error' }, 0)).toBeNull();
  });
});

describe('links from the tags page', () => {
  it('lists the files of a media tag and of a folder in the library', () => {
    expect(tagItemsPath(PROMO)).toBe(`/media?tag=${PROMO.id}`);
    expect(tagItemsPath(FOYER)).toBeNull();
    expect(folderPath(ID(7))).toBe(`/media?folder=${ID(7)}`);
  });
});
