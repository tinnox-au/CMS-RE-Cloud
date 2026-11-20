import { APP_TYPES, AppContentSchema, type AppContent, type AppDto } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  APP_TYPE_DESCRIPTIONS,
  APP_TYPE_LABELS,
  appDraftFromDto,
  appErrorsFromApi,
  appIsDirty,
  contrastWarning,
  countdownPassed,
  dateFormatLabel,
  defaultContent,
  filterAppList,
  inUsePlaylistNames,
  isTimeBased,
  previewShapes,
  previewZoneNote,
  usedInLabel,
  validateAppDraft,
  type AppDraft,
} from './apps.ts';
import { INCOMPLETE_DATE_TIME } from './mediaDetailDraft.ts';
import { app, ID } from './mediaLibrary.test-support.ts';

const NOW = new Date(2026, 10, 16, 14, 30).getTime();

function withContent(content: AppContent, change: Partial<AppDto> = {}): AppDto {
  return app(1, { content, ...change });
}

function edit(saved: AppDto, change: Partial<AppDraft>): AppDraft {
  return { ...appDraftFromDto(saved), ...change };
}

describe('app types', () => {
  it('has words and a valid starting content for every type', () => {
    for (const type of APP_TYPES) {
      expect(APP_TYPE_LABELS[type]).not.toBe('');
      expect(APP_TYPE_DESCRIPTIONS[type]).toMatch(/\.$/);
      const content = defaultContent(type, NOW);
      expect(content.type).toBe(type);
      expect(AppContentSchema.safeParse(content).success, type).toBe(true);
      expect(content.settings.textColour).toBe('#ffffff');
      expect(content.settings.backgroundColour).toBe('#000000');
    }
    expect(APP_TYPE_LABELS.qr).toBe('QR code');
    expect(isTimeBased('countdown')).toBe(true);
    expect(isTimeBased('ticker')).toBe(false);
    expect(previewZoneNote('Australia/Perth')).toBe(
      'Times in this preview use this computer’s time zone (Australia/Perth). Each screen uses its site’s time zone.',
    );
  });

  it('starts a countdown 7 days ahead at 09:00 local time', () => {
    const content = defaultContent('countdown', NOW);
    expect(content).toMatchObject({
      settings: { target: '2026-11-23T09:00', label: 'Opening in', finishedText: 'Now open' },
    });
    expect(countdownPassed('2026-11-23T09:00', NOW)).toBe(false);
    expect(countdownPassed('2026-11-16T14:30', NOW)).toBe(true);
    expect(countdownPassed(INCOMPLETE_DATE_TIME, NOW)).toBe(false);
  });

  it('labels each date format with today written that way', () => {
    expect(dateFormatLabel('long', NOW)).toMatch(/Monday.*16.*November.*2026/);
    expect(dateFormatLabel('numeric', NOW)).toBe('16/11/2026');
  });
});

describe('the app draft', () => {
  const saved = withContent(defaultContent('ticker', NOW), { description: 'Foyer' });

  it('is clean as loaded and ignores spaces at the ends', () => {
    expect(appIsDirty(appDraftFromDto(saved), saved)).toBe(false);
    expect(appIsDirty(edit(saved, { name: ` ${saved.name} ` }), saved)).toBe(false);
    expect(appIsDirty(edit(saved, { description: 'Foyer ' }), saved)).toBe(false);
    expect(validateAppDraft(appDraftFromDto(saved), saved)).toEqual({ ok: true, value: null });
  });

  it('sends only what changed', () => {
    const content: AppContent = {
      type: 'ticker',
      settings: { ...defaultContent('ticker', NOW).settings, speed: 'fast' },
    } as AppContent;
    expect(validateAppDraft(edit(saved, { content }), saved)).toEqual({
      ok: true,
      value: { content },
    });
    expect(validateAppDraft(edit(saved, { name: 'Lobby', description: '' }), saved)).toEqual({
      ok: true,
      value: { name: 'Lobby', description: null },
    });
  });

  it('says what to fix in plain words', () => {
    const ticker = edit(saved, {
      name: ' ',
      content: {
        type: 'ticker',
        settings: { ...defaultContent('ticker', NOW).settings, text: '' },
      },
    } as Partial<AppDraft>);
    expect(validateAppDraft(ticker, saved)).toEqual({
      ok: false,
      errors: { name: 'Enter a name.', text: 'Enter the text to scroll.' },
    });

    const qr = withContent(defaultContent('qr', NOW));
    const emptyQr = edit(qr, {
      content: { type: 'qr', settings: { ...defaultContent('qr', NOW).settings, content: ' ' } },
    } as Partial<AppDraft>);
    expect(validateAppDraft(emptyQr, qr)).toMatchObject({
      errors: { content: 'Enter what the code should hold, such as a web address.' },
    });

    const text = withContent(defaultContent('text', NOW));
    const blank = edit(text, {
      content: {
        type: 'text',
        settings: { ...defaultContent('text', NOW).settings, heading: '', body: '' },
      },
    });
    expect(validateAppDraft(blank, text)).toMatchObject({
      errors: { heading: 'Enter a heading or a message.' },
    });

    const countdown = withContent(defaultContent('countdown', NOW));
    const settings = defaultContent('countdown', NOW).settings;
    const broken = edit(countdown, {
      content: {
        type: 'countdown',
        settings: {
          ...settings,
          target: INCOMPLETE_DATE_TIME,
          finishedText: '',
          label: 'x'.repeat(61),
        },
      },
    } as Partial<AppDraft>);
    expect(validateAppDraft(broken, countdown)).toMatchObject({
      errors: {
        target: 'Enter a full date and time, year 1000 or later.',
        finishedText: 'Enter what to show when the countdown ends.',
        label: 'Use at most 60 characters.',
      },
    });

    const tab = edit(saved, {
      content: {
        type: 'ticker',
        settings: { ...defaultContent('ticker', NOW).settings, text: 'a\tb' },
      },
    } as Partial<AppDraft>);
    expect(validateAppDraft(tab, saved)).toMatchObject({
      errors: { text: 'Remove the tabs, line breaks or hidden direction characters.' },
    });
  });

  it('puts a server refusal at its field', () => {
    expect(
      appErrorsFromApi([
        { path: 'content.settings.text', message: 'too long' },
        { path: 'content.type', message: "An app's type cannot be changed." },
        { path: 'name', message: '' },
      ]),
    ).toEqual({
      text: 'The server refused this value: too long',
      form: "The server refused this value: An app's type cannot be changed.",
      name: 'The server refused this value.',
    });
    expect(
      inUsePlaylistNames([
        { path: 'playlist', message: 'Foyer loop' },
        { path: 'other', message: 'x' },
      ]),
    ).toEqual(['Foyer loop']);
  });
});

describe('style and preview', () => {
  it('warns below 4.5:1 and never rounds up to the threshold', () => {
    expect(contrastWarning('#ffffff', '#000000')).toBeNull();
    expect(contrastWarning('#777777', '#ffffff')).toBe(
      'The text and background colours are hard to tell apart (4.4:1). Choose colours with more contrast; 4.5:1 or more reads well from a distance.',
    );
    expect(contrastWarning('#ffffff', '#ffffff')).toContain('(1.0:1)');
    expect(contrastWarning('red', '#000000')).toBeNull();
  });

  it('gives a role that cannot change the colours the fact, not an instruction', () => {
    expect(contrastWarning('#777777', '#ffffff', true)).toBe(
      'The text and background colours are hard to tell apart (4.4:1). 4.5:1 or more reads well from a distance.',
    );
    expect(contrastWarning('#ffffff', '#000000', true)).toBeNull();
  });

  it('offers landscape, portrait and each screen with its content rectangle', () => {
    const shapes = previewShapes([
      {
        id: ID(3),
        name: 'Foyer',
        canvas: { width: 3840, height: 480 },
        contentRect: { x: 0, y: 0, width: 1920, height: 480 },
      },
    ]);
    expect(shapes.map((shape) => shape.label)).toEqual([
      'Landscape 1920 × 1080',
      'Portrait 1080 × 1920',
      'Foyer · 3840 × 480',
    ]);
    expect(shapes[2]?.shape.contentRect).toEqual({ x: 0, y: 0, width: 1920, height: 480 });
  });
});

describe('the list', () => {
  it('filters by search and type and says where an app is used', () => {
    const apps = [
      app(1, { name: 'Lobby clock' }),
      withContent(defaultContent('qr', NOW), {
        id: ID(2),
        name: 'Menu code',
        description: 'Lobby',
      }),
    ];
    expect(filterAppList(apps, 'lobby', null)).toHaveLength(2);
    expect(filterAppList(apps, 'lobby', 'qr').map((item) => item.id)).toEqual([ID(2)]);
    expect(usedInLabel(0)).toBe('Not used');
    expect(usedInLabel(1)).toBe('1 playlist');
    expect(usedInLabel(2)).toBe('2 playlists');
  });
});
