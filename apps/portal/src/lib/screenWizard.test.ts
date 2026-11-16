import {
  DEV_PORTS,
  PAIRING_CODE_ALPHABET,
  formatPairingCode,
  normalisePairingCode,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { EMPTY_DISPLAY_FORM, previewShape, type DisplayFormValues } from './displayForm.ts';
import {
  ASSIGNED_NOTE,
  assignedPushBlock,
  contentStepPlaylistMeta,
  contentStepPlaylists,
  EMPTY_PLAYLIST_META,
  CANVAS_PRESETS,
  PAIRING_CODE_FORMAT_PROBLEM,
  PLAYLIST_SEARCH_FROM,
  contentStepAction,
  WIZARD_PATH,
  WIZARD_STEPS,
  canvasShapeCaption,
  canvasShapeDescription,
  displayFormProblems,
  formatPairingCodeInput,
  localPlayerAddress,
  matchingPreset,
  minutesLabel,
  pairingCodeMinutes,
  pairingRefusalAdvice,
  parseWizardLocation,
  presetGlyph,
  presetSizeLabel,
  problemCountLabel,
  safeToLeaveNote,
  sameDisplayForm,
  wizardPath,
  wizardStepViews,
  type WizardProgress,
} from './screenWizard.ts';

const ID = '0b0e7a52-6f0c-4c1e-9d55-2f3a8c1d4e90';

function form(change: Partial<DisplayFormValues> = {}): DisplayFormValues {
  return { ...EMPTY_DISPLAY_FORM, name: 'Foyer', siteId: ID, ...change };
}

function progress(change: Partial<WizardProgress> = {}): WizardProgress {
  return {
    step: 'details',
    screenName: null,
    paired: false,
    assignedPlaylistName: null,
    detailsDirty: false,
    ...change,
  };
}

describe('wizard location', () => {
  it('starts on the first step when the address names no screen', () => {
    expect(parseWizardLocation('')).toEqual({ displayId: null, step: 'details' });
  });

  it('ignores a later step while no screen exists', () => {
    expect(parseWizardLocation('?step=content')).toEqual({ displayId: null, step: 'details' });
    expect(parseWizardLocation('?step=pair')).toEqual({ displayId: null, step: 'details' });
  });

  it('ignores a screen id that is not a UUID', () => {
    for (const bad of ['1', 'new', '../media', `${ID}0`, '%00', '<script>']) {
      const search = `?screen=${encodeURIComponent(bad)}&step=pair`;
      expect(parseWizardLocation(search), bad).toEqual({ displayId: null, step: 'details' });
    }
  });

  it('reads the screen and the step', () => {
    for (const step of WIZARD_STEPS) {
      expect(parseWizardLocation(`?screen=${ID}&step=${step}`)).toEqual({ displayId: ID, step });
    }
  });

  it('resumes at pairing when the step is missing or unknown', () => {
    expect(parseWizardLocation(`?screen=${ID}`)).toEqual({ displayId: ID, step: 'pair' });
    expect(parseWizardLocation(`?screen=${ID}&step=finish`)).toEqual({
      displayId: ID,
      step: 'pair',
    });
  });

  it('handles the id in lower case, as the API does', () => {
    expect(parseWizardLocation(`?screen=${ID.toUpperCase()}&step=content`).displayId).toBe(ID);
  });

  it('writes an address that reads back to the same place', () => {
    expect(wizardPath(null, 'details')).toBe(WIZARD_PATH);
    // No step can be addressed before the screen exists.
    expect(wizardPath(null, 'content')).toBe(WIZARD_PATH);
    for (const step of WIZARD_STEPS) {
      const path = wizardPath(ID, step);
      expect(path.startsWith(`${WIZARD_PATH}?`)).toBe(true);
      expect(parseWizardLocation(path.slice(WIZARD_PATH.length))).toEqual({ displayId: ID, step });
    }
  });
});

describe('step indicator', () => {
  it('lists Details, Pair, Content in order', () => {
    const views = wizardStepViews(progress());
    expect(views.map((view) => view.label)).toEqual(['Details', 'Pair', 'Content']);
    expect(views.map((view) => view.number)).toEqual([1, 2, 3]);
    expect(views.map((view) => view.id)).toEqual([...WIZARD_STEPS]);
  });

  it('lets no step be jumped to before the screen exists', () => {
    const views = wizardStepViews(progress());
    expect(views.map((view) => view.reachable)).toEqual([false, false, false]);
    expect(views.map((view) => view.current)).toEqual([true, false, false]);
    expect(views.map((view) => view.complete)).toEqual([false, false, false]);
  });

  it('opens the other steps once the screen exists, never the current one', () => {
    const views = wizardStepViews(progress({ step: 'pair', screenName: 'Foyer' }));
    expect(views.map((view) => view.reachable)).toEqual([true, false, true]);
    expect(views.map((view) => view.complete)).toEqual([true, false, false]);
  });

  it('holds the other steps while edited details are unsaved', () => {
    const views = wizardStepViews(
      progress({ step: 'details', screenName: 'Foyer', detailsDirty: true }),
    );
    expect(views.map((view) => view.reachable)).toEqual([false, false, false]);
  });

  it('marks a step complete from the facts, not from having been visited', () => {
    const skipped = wizardStepViews(progress({ step: 'content', screenName: 'Foyer' }));
    expect(skipped.map((view) => view.complete)).toEqual([true, false, false]);
    const done = wizardStepViews(
      progress({
        step: 'content',
        screenName: 'Foyer',
        paired: true,
        assignedPlaylistName: 'Reception loop',
      }),
    );
    expect(done.map((view) => view.complete)).toEqual([true, true, true]);
  });

  it('says what each step is for, then what it resulted in', () => {
    expect(wizardStepViews(progress()).map((view) => view.note)).toEqual([
      'Name and canvas',
      'Enter the player code',
      'Choose a playlist',
    ]);
    expect(
      wizardStepViews(progress({ step: 'content', screenName: 'Foyer' })).map((view) => view.note),
    ).toEqual(['Foyer', 'Skipped for now', 'Choose a playlist']);
    expect(
      wizardStepViews(
        progress({
          step: 'pair',
          screenName: 'Foyer',
          paired: true,
          assignedPlaylistName: 'Reception loop',
        }),
      ).map((view) => view.note),
    ).toEqual(['Foyer', 'Player paired', 'Reception loop']);
  });

  it('describes the position of every step for assistive technology', () => {
    const views = wizardStepViews(progress({ step: 'pair', screenName: 'Foyer' }));
    expect(views.map((view) => view.position)).toEqual([
      'Step 1 of 3, completed',
      'Step 2 of 3, current step',
      'Step 3 of 3, not completed',
    ]);
  });
});

describe('canvas presets', () => {
  it('keeps the four M0 presets', () => {
    expect(CANVAS_PRESETS.map((preset) => `${preset.name} ${presetSizeLabel(preset)}`)).toEqual([
      'Landscape 1920 × 1080',
      'Portrait 1080 × 1920',
      'Wide strip 3840 × 480',
      'Tall column 640 × 1344',
    ]);
  });

  it('starts the empty form on the landscape preset', () => {
    expect(matchingPreset(EMPTY_DISPLAY_FORM)?.id).toBe('landscape');
  });

  it('recognises a typed preset size and nothing else', () => {
    expect(matchingPreset({ width: ' 3840 ', height: '480' })?.id).toBe('wide-strip');
    expect(matchingPreset({ width: '1920', height: '1081' })).toBeNull();
    expect(matchingPreset({ width: '', height: '' })).toBeNull();
    expect(matchingPreset({ width: '1920px', height: '1080' })).toBeNull();
  });

  it('draws every preset inside the glyph box and never thinner than two units', () => {
    for (const preset of CANVAS_PRESETS) {
      const glyph = presetGlyph(preset, 28);
      expect(Math.max(glyph.width, glyph.height)).toBe(28);
      expect(Math.min(glyph.width, glyph.height)).toBeGreaterThanOrEqual(2);
    }
    expect(presetGlyph({ width: 10000, height: 16 }, 28)).toEqual({ width: 28, height: 2 });
  });
});

describe('details form', () => {
  it('treats the same answers as the same form', () => {
    expect(sameDisplayForm(form(), form())).toBe(true);
    expect(sameDisplayForm(form({ name: ' Foyer ' }), form())).toBe(true);
    expect(sameDisplayForm(form({ width: '1920 ' }), form())).toBe(true);
  });

  it('notices every field that is saved', () => {
    expect(sameDisplayForm(form({ name: 'Foyer 2' }), form())).toBe(false);
    expect(sameDisplayForm(form({ width: '1280' }), form())).toBe(false);
    expect(sameDisplayForm(form({ height: '720' }), form())).toBe(false);
    expect(sameDisplayForm(form({ defaultFit: 'cover' }), form())).toBe(false);
    expect(sameDisplayForm(form({ useContentRect: true }), form())).toBe(false);
  });

  it('counts the rectangle fields only while the rectangle is in use', () => {
    expect(sameDisplayForm(form({ rectWidth: '800' }), form())).toBe(true);
    const on = form({ useContentRect: true, rectWidth: '800', rectHeight: '600' });
    expect(sameDisplayForm(on, { ...on })).toBe(true);
    expect(sameDisplayForm(on, { ...on, rectWidth: '801' })).toBe(false);
    expect(sameDisplayForm(on, { ...on, rectX: '4' })).toBe(false);
    expect(sameDisplayForm(on, { ...on, rectY: '4' })).toBe(false);
    expect(sameDisplayForm(on, { ...on, rectHeight: '601' })).toBe(false);
  });

  it('lists the problems in the order of the form', () => {
    expect(
      displayFormProblems({
        form: 'Something else.',
        height: 'Height must be a whole number of pixels.',
        name: 'Enter a name.',
        contentRect: 'content rectangle must fit inside the canvas',
      }),
    ).toEqual([
      { field: 'name', message: 'Enter a name.' },
      { field: 'height', message: 'Height must be a whole number of pixels.' },
      { field: 'contentRect', message: 'content rectangle must fit inside the canvas' },
      { field: 'form', message: 'Something else.' },
    ]);
    expect(displayFormProblems({})).toEqual([]);
  });

  it('keeps the M0 heading of the error summary', () => {
    expect(problemCountLabel(1)).toBe('One field needs attention.');
    expect(problemCountLabel(3)).toBe('3 fields need attention.');
  });

  it('describes the canvas drawing', () => {
    const whole = previewShape(form({ width: '3840', height: '480' }));
    expect(whole).not.toBeNull();
    expect(canvasShapeDescription(whole!)).toBe(
      'Canvas 3840 by 480 pixels. Content fills the whole canvas.',
    );
    expect(canvasShapeCaption(whole!)).toBe('3840 × 480 px');

    const withRect = previewShape(
      form({ useContentRect: true, rectX: '10', rectY: '20', rectWidth: '800', rectHeight: '600' }),
    );
    expect(canvasShapeDescription(withRect!)).toBe(
      'Canvas 1920 by 1080 pixels with a content rectangle of 800 by 600 pixels at 10, 20.',
    );
    expect(canvasShapeCaption(withRect!)).toBe('1920 × 1080 px, content 800 × 600 at (10, 20)');
  });
});

describe('pairing code field', () => {
  it('formats a typed code as two groups of four', () => {
    expect(formatPairingCodeInput('abcd').text).toBe('ABCD');
    expect(formatPairingCodeInput('abcde').text).toBe('ABCD-E');
    expect(formatPairingCodeInput('abcdefgh').text).toBe('ABCD-EFGH');
  });

  it('tidies a pasted code', () => {
    expect(formatPairingCodeInput(' ab cd - ef gh ').text).toBe('ABCD-EFGH');
    expect(formatPairingCodeInput('abcd-efgh').text).toBe('ABCD-EFGH');
    expect(formatPairingCodeInput('ABCD–EFGH').text).toBe('ABCD-EFGH');
  });

  it('never holds more than eight symbols', () => {
    expect(formatPairingCodeInput('abcdefghjk').text).toBe('ABCD-EFGH');
    expect(formatPairingCodeInput('x'.repeat(5000)).text).toBe('XXXX-XXXX');
  });

  it('keeps symbols a code never contains, so the check can name them', () => {
    const edit = formatPairingCodeInput('o0il-u1ab');
    expect(edit.text).toBe('O0IL-U1AB');
    expect(normalisePairingCode(edit.text)).toBeNull();
  });

  it('agrees with the shared format for every well-formed code', () => {
    const code = PAIRING_CODE_ALPHABET.slice(0, 8);
    const edit = formatPairingCodeInput(code.toLowerCase());
    expect(edit.text).toBe(formatPairingCode(code));
    expect(normalisePairingCode(edit.text)).toBe(code);
  });

  it('puts the caret at the end while typing forwards', () => {
    expect(formatPairingCodeInput('ABCD')).toEqual({ text: 'ABCD', caret: 4 });
    expect(formatPairingCodeInput('ABCDE')).toEqual({ text: 'ABCD-E', caret: 6 });
    expect(formatPairingCodeInput('ABCD-EFGH')).toEqual({ text: 'ABCD-EFGH', caret: 9 });
  });

  it('keeps the caret in place when a symbol is typed in the middle', () => {
    // "AB|CD-EFG" with X typed at the bar: the browser reports "ABXCD-EFG", caret 3.
    expect(formatPairingCodeInput('ABXCD-EFG', 3)).toEqual({ text: 'ABXC-DEFG', caret: 3 });
    // Typed as the fifth symbol, the caret lands after the dash and the new symbol.
    expect(formatPairingCodeInput('ABCDX-EFG', 5)).toEqual({ text: 'ABCD-XEFG', caret: 6 });
  });

  it('keeps the caret in place when a symbol is deleted', () => {
    // Backspace after E in "ABCD-E": the browser reports "ABCD-", caret 5.
    expect(formatPairingCodeInput('ABCD-', 5)).toEqual({ text: 'ABCD', caret: 4 });
    // Deleting the dash alone changes nothing but moves the caret before it.
    expect(formatPairingCodeInput('ABCDEFGH', 4)).toEqual({ text: 'ABCD-EFGH', caret: 4 });
  });

  it('never places the caret outside the text', () => {
    for (const [raw, caret] of [
      ['', 0],
      ['ABCDEFGHJK', 10],
      ['ABCD', 99],
      ['ABCD', -3],
      ['  a  ', 5],
    ] as const) {
      const edit = formatPairingCodeInput(raw, caret);
      expect(edit.caret, raw).toBeGreaterThanOrEqual(0);
      expect(edit.caret, raw).toBeLessThanOrEqual(edit.text.length);
    }
  });

  it('keeps the M0 explanation of a malformed code', () => {
    expect(PAIRING_CODE_FORMAT_PROBLEM).toContain('8 letters or digits');
    expect(PAIRING_CODE_FORMAT_PROBLEM).toContain('ABCD-2345');
    expect(normalisePairingCode('ABCD-2345')).toBe('ABCD2345');
  });
});

describe('pairing refusals', () => {
  it('advises on the refusals the server documents', () => {
    expect(pairingRefusalAdvice('pairing_code_invalid', 10)).toContain('codes last 10 minutes');
    expect(pairingRefusalAdvice('not_found', 10)).toContain('already used');
    expect(pairingRefusalAdvice('pairing_expired', 10)).toContain('has expired');
    expect(pairingRefusalAdvice('pairing_locked', 10)).toContain('Too many wrong codes');
    expect(pairingRefusalAdvice('rate_limited', 10)).toContain('Wait a few minutes');
  });

  it('adds nothing to any other error', () => {
    for (const code of ['conflict', 'network_error', 'validation_failed', '']) {
      expect(pairingRefusalAdvice(code, 10), code).toBeNull();
    }
  });

  it('states the lifetime of a code in whole minutes', () => {
    expect(pairingCodeMinutes(600)).toBe(10);
    expect(pairingCodeMinutes(90)).toBe(2);
    expect(pairingCodeMinutes(10)).toBe(1);
    expect(minutesLabel(1)).toBe('1 minute');
    expect(minutesLabel(10)).toBe('10 minutes');
    expect(pairingRefusalAdvice('pairing_code_invalid', 1)).toContain('codes last 1 minute)');
  });
});

describe('player address', () => {
  it('names the local player on a development machine', () => {
    const address = `http://localhost:${DEV_PORTS.player}`;
    expect(localPlayerAddress('localhost')).toBe(address);
    expect(localPlayerAddress('LOCALHOST')).toBe(address);
    expect(localPlayerAddress('127.0.0.1')).toBe(address);
    expect(localPlayerAddress('[::1]')).toBe(address);
    expect(localPlayerAddress('portal.localhost')).toBe(address);
  });

  it('claims no address for a hosted portal', () => {
    for (const host of ['cms.example.com', 'localhost.example.com', 'staging.tinnox.test', '']) {
      expect(localPlayerAddress(host), host).toBeNull();
    }
  });
});

describe('content step', () => {
  it('assigns only a playlist the screen does not have yet', () => {
    expect(contentStepAction(null, null)).toBe('finish');
    expect(contentStepAction('a', null)).toBe('assign');
    expect(contentStepAction('a', 'a')).toBe('finish');
    expect(contentStepAction('b', 'a')).toBe('assign');
    expect(contentStepAction(null, 'a')).toBe('finish');
  });

  it('offers a search only for a longer list', () => {
    expect(PLAYLIST_SEARCH_FROM).toBeGreaterThan(3);
  });

  it('says that an assignment waits for a push', () => {
    expect(ASSIGNED_NOTE).toContain('until you push');
  });
});

describe('wording', () => {
  it('says that leaving after creation loses nothing', () => {
    const note = safeToLeaveNote('Foyer');
    expect(note).toContain('“Foyer” is created');
    expect(note).toContain('leave now');
  });

  it('never calls a screen a display and has no word for a screen being reachable', () => {
    const texts: string[] = [
      PAIRING_CODE_FORMAT_PROBLEM,
      ASSIGNED_NOTE,
      safeToLeaveNote('Foyer'),
      problemCountLabel(1),
      problemCountLabel(2),
      minutesLabel(1),
      ...CANVAS_PRESETS.map((preset) => preset.name),
    ];
    for (const code of ['pairing_code_invalid', 'pairing_expired', 'pairing_locked']) {
      texts.push(pairingRefusalAdvice(code, 10) ?? '');
    }
    for (const step of WIZARD_STEPS) {
      for (const paired of [true, false]) {
        for (const view of wizardStepViews(progress({ step, paired }))) {
          texts.push(view.label, view.note, view.position);
        }
      }
    }
    const shape = previewShape(form());
    texts.push(canvasShapeDescription(shape!), canvasShapeCaption(shape!));
    for (const text of texts) {
      expect(text.toLowerCase(), text).not.toMatch(/online|offline|display/);
    }
  });
});

describe('empty playlists in the content step', () => {
  const full = { id: 'a', itemCount: 2 };
  const empty = { id: 'b', itemCount: 0 };
  const other = { id: 'c', itemCount: 1 };

  it('offers playlists with items first and keeps the API order within each group', () => {
    expect(contentStepPlaylists([empty, full, other]).map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });

  it('says on the row that an empty playlist cannot be pushed yet', () => {
    expect(contentStepPlaylistMeta(empty, 'No items', null)).toBe(EMPTY_PLAYLIST_META);
    expect(contentStepPlaylistMeta(empty, 'No items', 'b')).toBe(
      `${EMPTY_PLAYLIST_META} · Assigned`,
    );
    expect(contentStepPlaylistMeta(full, '2 items · 0:20', 'b')).toBe('2 items · 0:20');
    expect(contentStepPlaylistMeta(full, '2 items · 0:20', 'a')).toBe('2 items · 0:20 · Assigned');
  });

  it('explains why the assigned playlist cannot be pushed instead of offering Push now', () => {
    const message = 'The playlist has no items.';
    expect(
      assignedPushBlock(
        { state: 'blocked', issues: [{ path: 'playlist', message, code: 'playlist_empty' }] },
        full,
      ),
    ).toBe(`It cannot be pushed yet. ${message}`);
    expect(assignedPushBlock(null, empty)).toContain('has no items');
    expect(assignedPushBlock({ state: 'never_pushed', issues: [] }, empty)).toBeNull();
    expect(assignedPushBlock(null, full)).toBeNull();
    expect(assignedPushBlock(null, null)).toBeNull();
  });
});
