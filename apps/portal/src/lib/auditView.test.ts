import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_RESULTS,
  type AuditEventDto,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_CATEGORY_LABELS,
  AUDIT_CATEGORY_OPTIONS,
  AUDIT_RESULT_OPTIONS,
  appendOlderAuditPage,
  auditActionLabel,
  auditAllTargets,
  auditSubject,
  auditActorIdLabel,
  auditActorLabel,
  auditCountLabel,
  auditDetailJson,
  auditDetailPairs,
  auditDetailsButtonLabel,
  auditDetailSummary,
  auditDetailSummaryParts,
  auditFilterKey,
  auditObjectText,
  auditObjectTypeLabel,
  auditSearchCountLabel,
  auditSearchTexts,
  auditReasonCodes,
  auditTagScope,
  auditTargetLabel,
  auditTargetPath,
  auditTargets,
  auditTime,
  isAuditFiltered,
  MAX_DETAIL_TEXT,
  NO_AUDIT_FILTER,
  NO_AUDIT_NAMES,
  parseAuditCategory,
  parseAuditResult,
  presentAuditResult,
  resolveAuditTarget,
  shortAuditId,
  type AuditNames,
  type AuditOlderPages,
} from './auditView.ts';
import { matchesSearch } from './listView.ts';
import { describeActivity } from './activity.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function event(partial: Partial<AuditEventDto>): AuditEventDto {
  return {
    id: '1',
    occurredAt: '2026-11-16T03:31:14.250Z',
    actorType: 'operator',
    actorId: ID(900),
    action: 'display.update',
    objectType: 'display',
    objectId: ID(1),
    result: 'success',
    detail: null,
    ...partial,
  };
}

describe('audit filters', () => {
  it('accepts only the categories and results the API accepts', () => {
    expect(parseAuditCategory('media')).toBe('media');
    expect(parseAuditCategory('publication')).toBe('publication');
    expect(parseAuditCategory('Media')).toBeNull();
    expect(parseAuditCategory('')).toBeNull();
    expect(parseAuditCategory(null)).toBeNull();
    expect(parseAuditCategory('toString')).toBeNull();
    expect(parseAuditResult('denied')).toBe('denied');
    expect(parseAuditResult('ok')).toBeNull();
    expect(parseAuditResult(undefined)).toBeNull();
  });

  it('offers every category and result once, with a label', () => {
    expect(AUDIT_CATEGORY_OPTIONS.map((option) => option.value).sort()).toEqual(
      [...AUDIT_CATEGORIES].sort(),
    );
    expect(AUDIT_RESULT_OPTIONS.map((option) => option.value)).toEqual([...AUDIT_RESULTS]);
    const labels = AUDIT_CATEGORY_OPTIONS.map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en-AU')));
  });

  it('names the screens category with the word an operator reads', () => {
    expect(AUDIT_CATEGORY_LABELS.display).toBe('Screens');
    expect(AUDIT_CATEGORY_LABELS.publication).toBe('Pushes to screens');
  });

  it('tells filters apart', () => {
    expect(isAuditFiltered(NO_AUDIT_FILTER)).toBe(false);
    expect(isAuditFiltered({ category: 'tag', result: null })).toBe(true);
    expect(isAuditFiltered({ category: null, result: 'failure' })).toBe(true);
    const keys = new Set([
      auditFilterKey(NO_AUDIT_FILTER),
      auditFilterKey({ category: 'tag', result: null }),
      auditFilterKey({ category: null, result: 'failure' }),
      auditFilterKey({ category: 'tag', result: 'failure' }),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe('audit result', () => {
  it('keeps success quiet and marks refusals and failures', () => {
    expect(presentAuditResult('success')).toEqual({ label: 'Succeeded', tone: 'neutral' });
    expect(presentAuditResult('failure')).toEqual({ label: 'Failed', tone: 'danger' });
    expect(presentAuditResult('denied')).toEqual({ label: 'Refused', tone: 'warn' });
  });
});

describe('audit action in plain words', () => {
  const label = (action: string, result: AuditEventDto['result'], extra = {}) =>
    auditActionLabel(event({ action, result, ...extra }));

  it('has words for every action the API records, for every result', () => {
    for (const action of AUDIT_ACTIONS) {
      for (const result of AUDIT_RESULTS) {
        const text = label(action, result);
        expect(text, `${action} ${result}`).not.toBe('');
        expect(text, `${action} ${result}`).not.toContain(action);
        expect(text.charAt(0), `${action} ${result}`).toBe(text.charAt(0).toUpperCase());
      }
    }
  });

  it('uses the same words as the recent-activity list for known actions', () => {
    for (const action of AUDIT_ACTIONS) {
      for (const result of AUDIT_RESULTS) {
        const one = event({ action, result });
        expect(auditActionLabel(one)).toBe(describeActivity(one).text);
      }
    }
  });

  it('says screen, never the code name, and never claims a connection state', () => {
    for (const action of [
      ...AUDIT_ACTIONS,
      'display.archive',
      'display',
      'display.status_changed',
      'media.display_resized',
    ]) {
      for (const result of AUDIT_RESULTS) {
        const text = label(action, result).toLowerCase();
        expect(text, `${action} ${result}`).not.toMatch(/\bdisplays?\b/);
        expect(text, `${action} ${result}`).not.toContain('online');
        expect(text, `${action} ${result}`).not.toContain('offline');
      }
    }
    const texts = [
      ...Object.values(AUDIT_CATEGORY_LABELS),
      ...AUDIT_RESULT_OPTIONS.map((option) => option.label),
      auditObjectTypeLabel('display') ?? '',
      auditTargetLabel('display'),
    ];
    for (const text of texts) expect(text.toLowerCase()).not.toMatch(/\bdisplays?\b|online/);
  });

  it('does not report a refused or failed attempt as done', () => {
    expect(label('media.upload', 'success')).toBe('Media uploaded');
    expect(label('media.upload', 'failure')).toBe('Upload failed');
    expect(label('media.upload', 'denied')).toBe('Upload refused');
    expect(label('publication.create', 'success')).toBe('Pushed to screen');
    expect(label('publication.create', 'failure')).toBe('Push to screen failed');
    expect(label('playlist.delete', 'failure')).toBe('Playlist deletion failed');
  });

  it('reads the detail where it changes the meaning', () => {
    expect(
      label('display.update', 'success', {
        detail: { fields: ['assignedPlaylistId'], assignedPlaylistId: ID(5) },
      }),
    ).toBe('Playlist assigned to screen');
    expect(label('tag.create', 'success', { detail: { scope: 'display' } })).toBe(
      'Screen tag created',
    );
  });

  it('makes readable words for an action it does not know', () => {
    expect(label('display.archive', 'success')).toBe('Screen: archive');
    expect(label('media.display_resized', 'success')).toBe('Media: screen resized');
    expect(label('billing.invoice_sent', 'success')).toBe('Billing: invoice sent');
    expect(label('billing.invoice_sent', 'denied')).toBe('Billing: invoice sent (refused)');
    expect(label('heartbeat', 'failure')).toBe('Heartbeat (failed)');
    expect(label('', 'success')).toBe('Unnamed action');
    // A name that is also a property of every object is not looked up as one.
    expect(label('constructor', 'success')).toBe('Constructor');
    expect(label('toString.call', 'success')).toBe('ToString: call');
  });

  it('lists the reason codes of a refusal', () => {
    expect(
      auditReasonCodes(
        event({
          action: 'publication.create',
          result: 'failure',
          detail: { reasons: ['playlist_empty'] },
        }),
      ),
    ).toEqual(['playlist_empty']);
    expect(auditReasonCodes(event({ detail: { reason: 'x' } }))).toEqual([]);
  });
});

describe('audit time', () => {
  it('gives the local date and time in Australian English and the exact UTC time', () => {
    const time = auditTime('2026-11-16T03:31:14.250Z', 'Australia/Sydney');
    expect(time.date).toBe('16 Nov 2026');
    expect(time.time).toBe('2:31:14 pm');
    expect(time.local).toMatch(/^16 Nov 2026, 2:31:14 pm (AEDT|GMT\+11)$/);
    expect(time.utc).toBe('2026-11-16 03:31:14.250 UTC');
    expect(time.iso).toBe('2026-11-16T03:31:14.250Z');
  });

  it('moves the date with the zone and keeps UTC fixed', () => {
    const sydney = auditTime('2026-11-15T20:05:00Z', 'Australia/Sydney');
    const perth = auditTime('2026-11-15T20:05:00Z', 'Australia/Perth');
    expect(sydney.date).toBe('16 Nov 2026');
    expect(sydney.time).toBe('7:05:00 am');
    expect(perth.time).toBe('4:05:00 am');
    expect(sydney.utc).toBe('2026-11-15 20:05:00.000 UTC');
    expect(perth.utc).toBe(sydney.utc);
  });

  it('works in the viewer zone without a zone argument', () => {
    const time = auditTime('2026-11-16T03:31:14Z');
    expect(time.date).toMatch(/^\d{1,2} \w{3} 2026$/);
    expect(time.utc).toBe('2026-11-16 03:31:14.000 UTC');
    expect(time.local.startsWith(`${time.date}, ${time.time}`)).toBe(true);
  });

  it('shows a text that is not a time as it is', () => {
    expect(auditTime('not a time')).toEqual({
      date: 'not a time',
      time: '',
      local: 'not a time',
      utc: 'not a time',
      iso: null,
    });
  });
});

describe('audit actor and object', () => {
  it('names the actor types', () => {
    expect(auditActorLabel('operator')).toBe('Operator');
    expect(auditActorLabel('player')).toBe('Player software');
    expect(auditActorLabel('system')).toBe('System');
    expect(auditActorLabel('anonymous')).toBe('Not signed in');
    expect(auditActorIdLabel('operator')).toBe('Membership ID');
    expect(auditActorIdLabel('player')).toBe('Player registration ID');
    expect(auditActorIdLabel('system')).toBe('Actor ID');
  });

  it('names object types, known or not', () => {
    expect(auditObjectTypeLabel('display')).toBe('Screen');
    expect(auditObjectTypeLabel('player_registration')).toBe('Player');
    expect(auditObjectTypeLabel('membership')).toBe('Operator account');
    expect(auditObjectTypeLabel('billing_account')).toBe('Billing account');
    expect(auditObjectTypeLabel('hasOwnProperty')).toBe('HasOwnProperty');
    expect(auditObjectTypeLabel(null)).toBeNull();
    expect(auditObjectTypeLabel(' ')).toBeNull();
  });

  it('shortens identifiers for the list', () => {
    expect(shortAuditId(ID(1))).toBe('00000000');
    expect(shortAuditId('abc')).toBe('abc');
    expect(shortAuditId('x'.repeat(40))).toBe(`${'x'.repeat(15)}…`);
  });

  it('finds the object of an event and the objects its detail names', () => {
    expect(auditTargets(event({}))).toEqual({
      primary: { kind: 'display', id: ID(1) },
      related: [],
    });
    expect(
      auditTargets(
        event({
          action: 'publication.create',
          objectType: 'publication',
          objectId: ID(5),
          detail: { via: 'push', items: 1, displayId: ID(1), playlistId: ID(2) },
        }),
      ),
    ).toEqual({
      primary: null,
      related: [
        { kind: 'display', id: ID(1) },
        { kind: 'playlist', id: ID(2) },
      ],
    });
  });

  it('does not repeat the object itself among the related ones', () => {
    const targets = auditTargets(
      event({
        action: 'player.revoke',
        detail: {
          reason: 'operator',
          displayId: ID(1),
          assignedPlaylistId: ID(2),
          playlistId: ID(2),
        },
      }),
    );
    expect(targets.primary).toEqual({ kind: 'display', id: ID(1) });
    expect(targets.related).toEqual([{ kind: 'playlist', id: ID(2) }]);
  });

  it('ignores identifiers that are not well formed', () => {
    expect(auditTargets(event({ objectId: '../../etc' })).primary).toBeNull();
    expect(auditTargets(event({ objectId: null })).primary).toBeNull();
    expect(
      auditTargets(event({ detail: { displayId: 'javascript:alert(1)', playlistId: 7 } })).related,
    ).toEqual([]);
    expect(
      auditTargets(event({ objectId: 'ABCDEF00-0000-4000-8000-000000000001' })).primary,
    ).toEqual({ kind: 'display', id: 'abcdef00-0000-4000-8000-000000000001' });
  });

  it('reads a tag scope only when it is one', () => {
    expect(auditTagScope({ scope: 'display' })).toBe('display');
    expect(auditTagScope({ scope: 'other' })).toBeNull();
    expect(auditTagScope({})).toBeNull();
    expect(auditTagScope(null)).toBeNull();
  });

  it('knows where each kind of object opens', () => {
    expect(auditTargetPath({ kind: 'display', id: ID(1) })).toBe(`/screens/${ID(1)}`);
    expect(auditTargetPath({ kind: 'media', id: ID(2) })).toBe(`/media/${ID(2)}`);
    expect(auditTargetPath({ kind: 'playlist', id: ID(3) })).toBe(`/playlists/${ID(3)}`);
    expect(auditTargetPath({ kind: 'tag', id: ID(4) })).toBe('/settings/tags');
    expect(auditTargetPath({ kind: 'tag', id: ID(4) }, 'display')).toBe(
      '/settings/tags?scope=display',
    );
    expect(auditTargetPath({ kind: 'folder', id: ID(5) })).toBe(`/media?folder=${ID(5)}`);
    expect(auditTargetPath({ kind: 'app', id: ID(6) })).toBe(`/apps/${ID(6)}`);
  });

  it('labels app events and points at the app', () => {
    const created = event({ action: 'app.create', objectType: 'app', objectId: ID(6) });
    expect(auditActionLabel(created)).toBe('App created');
    expect(auditTargets(created).primary).toEqual({ kind: 'app', id: ID(6) });
    expect(AUDIT_CATEGORY_LABELS.app).toBe('Apps');
  });

  it('labels schedule events and points at the schedule and its playlists', () => {
    const updated = event({
      action: 'schedule.update',
      objectType: 'schedule',
      objectId: ID(7),
      detail: { defaultPlaylistId: ID(3), eventCount: 2 },
    });
    expect(auditActionLabel(updated)).toBe('Schedule updated');
    expect(AUDIT_CATEGORY_LABELS.schedule).toBe('Schedules');
    expect(auditObjectTypeLabel('schedule')).toBe('Schedule');
    expect(auditTargetLabel('schedule')).toBe('Schedule');
    expect(auditTargetPath({ kind: 'schedule', id: ID(7) })).toBe(`/schedules/${ID(7)}`);
    // The default playlist of the detail is a related playlist, so it gets a name and a link.
    expect(auditTargets(updated)).toEqual({
      primary: { kind: 'schedule', id: ID(7) },
      related: [{ kind: 'playlist', id: ID(3) }],
    });
    expect(auditSubject(updated)).toEqual({ kind: 'schedule', id: ID(7) });

    // A screen given a schedule, and the push that followed.
    expect(
      auditTargets(event({ detail: { fields: ['assignedScheduleId'], assignedScheduleId: ID(7) } }))
        .related,
    ).toEqual([{ kind: 'schedule', id: ID(7) }]);
    expect(
      auditTargets(
        event({
          action: 'publication.create',
          objectType: 'publication',
          objectId: ID(8),
          detail: { displayId: ID(1), playlistId: ID(3), scheduleId: ID(7) },
        }),
      ).related,
    ).toEqual([
      { kind: 'display', id: ID(1) },
      { kind: 'playlist', id: ID(3) },
      { kind: 'schedule', id: ID(7) },
    ]);

    const names: AuditNames = { ...NO_AUDIT_NAMES, schedule: new Map([[ID(7), 'Opening hours']]) };
    expect(resolveAuditTarget({ kind: 'schedule', id: ID(7) }, names)).toEqual({
      state: 'found',
      name: 'Opening hours',
      path: `/schedules/${ID(7)}`,
    });
    expect(resolveAuditTarget({ kind: 'schedule', id: ID(9) }, names)).toEqual({ state: 'gone' });
    expect(auditObjectText(updated, names)).toBe('Opening hours');
  });

  it('resolves an object against the lists that were read', () => {
    const names: AuditNames = {
      ...NO_AUDIT_NAMES,
      display: new Map([[ID(1), 'Foyer']]),
      tag: new Map([[ID(4), 'Promo']]),
      tagScopes: new Map([[ID(4), 'display']]),
      folder: new Map([[ID(5), 'Menus']]),
    };
    expect(resolveAuditTarget({ kind: 'display', id: ID(1) }, names)).toEqual({
      state: 'found',
      name: 'Foyer',
      path: `/screens/${ID(1)}`,
    });
    expect(resolveAuditTarget({ kind: 'display', id: ID(9) }, names)).toEqual({ state: 'gone' });
    expect(resolveAuditTarget({ kind: 'playlist', id: ID(3) }, names)).toEqual({
      state: 'unknown',
      path: `/playlists/${ID(3)}`,
    });
    // The list knows the scope better than the event does.
    expect(resolveAuditTarget({ kind: 'tag', id: ID(4) }, names, 'media')).toEqual({
      state: 'found',
      name: 'Promo',
      path: '/settings/tags?scope=display',
    });
    expect(resolveAuditTarget({ kind: 'tag', id: ID(4) }, NO_AUDIT_NAMES, 'media')).toEqual({
      state: 'unknown',
      path: '/settings/tags?scope=media',
    });
    expect(resolveAuditTarget({ kind: 'folder', id: ID(5) }, names)).toEqual({
      state: 'found',
      name: 'Menus',
      path: `/media?folder=${ID(5)}`,
    });
  });
});

describe('audit detail', () => {
  it('writes the detail as indented JSON text', () => {
    expect(auditDetailJson(null)).toBe('');
    expect(auditDetailJson({ via: 'push', items: 1 })).toBe('{\n  "via": "push",\n  "items": 1\n}');
  });

  it('keeps markup in a detail as plain characters', () => {
    const text = auditDetailJson({ note: '<img src=x onerror=alert(1)>' });
    expect(text).toContain('<img src=x onerror=alert(1)>');
  });

  it('shortens a detail that is far too long and survives one that cannot be written', () => {
    const long = auditDetailJson({ text: 'a'.repeat(MAX_DETAIL_TEXT * 2) });
    expect(long.length).toBeLessThan(MAX_DETAIL_TEXT + 40);
    expect(long.endsWith('… (shortened)')).toBe(true);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(auditDetailJson(loop)).toBe('');
    expect(auditDetailSummary(loop)).toBe('self: ');
  });

  it('lists the entries as short texts', () => {
    expect(
      auditDetailPairs({
        via: 'push',
        items: 1,
        ok: false,
        nothing: null,
        fields: ['name', 'tagIds'],
        none: [],
        canvas: { width: 1920, height: 1080 },
      }),
    ).toEqual([
      { key: 'via', value: 'push' },
      { key: 'items', value: '1' },
      { key: 'ok', value: 'false' },
      { key: 'nothing', value: 'null' },
      { key: 'fields', value: 'name, tagIds' },
      { key: 'none', value: 'none' },
      { key: 'canvas', value: '{"width":1920,"height":1080}' },
    ]);
    expect(auditDetailPairs(null)).toEqual([]);
  });

  it('summarises on one line and shortens', () => {
    expect(auditDetailSummary(null)).toBe('');
    expect(auditDetailSummary({ via: 'push', items: 1 })).toBe('via: push · items: 1');
    const short = auditDetailSummary({ reason: 'x'.repeat(500) }, 40);
    expect(short).toHaveLength(40);
    expect(short.endsWith('…')).toBe(true);
  });

  it('keeps each entry whole, so the list never splits a key across lines', () => {
    const detail = { bytesRetainedForPublications: false, via: 'push' };
    expect(auditDetailSummaryParts(detail)).toEqual([
      'bytesRetainedForPublications: false',
      'via: push',
    ]);
    expect(auditDetailSummaryParts(null)).toEqual([]);
  });

  it('cuts the entry where the limit falls and leaves out the rest', () => {
    const detail = { via: 'push', reason: 'x'.repeat(50), items: 1 };
    const parts = auditDetailSummaryParts(detail, 30);
    expect(parts).toEqual(['via: push', `reason: ${'x'.repeat(9)}…`]);
    expect(parts.join(' · ')).toHaveLength(30);
    expect(auditDetailSummary(detail, 30)).toBe(parts.join(' · '));
    // The limit falls inside a separator: the last whole entry carries the "…".
    expect(auditDetailSummaryParts({ a: '1', b: '2' }, 6)).toEqual(['a: 1…']);
    expect(auditDetailSummaryParts({ reason: 'abc' }, 1)).toEqual(['…']);
  });

  it('never makes the parts longer than the limit', () => {
    const detail = { one: 'a'.repeat(7), two: 'b'.repeat(9), three: 'c'.repeat(11) };
    for (let limit = 1; limit <= 50; limit += 1) {
      const text = auditDetailSummaryParts(detail, limit).join(' · ');
      expect(text.length).toBeLessThanOrEqual(limit);
    }
  });
});

describe('audit count', () => {
  it('says when older events are still on the server', () => {
    expect(auditCountLabel(0, false)).toBe('No events');
    expect(auditCountLabel(1, false)).toBe('1 event');
    expect(auditCountLabel(50, true)).toBe('Newest 50 events');
    expect(auditCountLabel(73, false)).toBe('73 events');
  });
});

describe('audit subject', () => {
  it('names the screen of a push, then the playlist, each once', () => {
    const push = event({
      action: 'publication.create',
      objectType: 'publication',
      objectId: ID(40),
      detail: { displayId: ID(1).toUpperCase(), playlistId: ID(2) },
    });
    expect(auditSubject(push)).toEqual({ kind: 'display', id: ID(1) });
    expect(auditAllTargets(push)).toEqual([
      { kind: 'display', id: ID(1) },
      { kind: 'playlist', id: ID(2) },
    ]);
  });

  it('falls back to the event object and ignores malformed identifiers', () => {
    expect(
      auditSubject(event({ objectType: 'playlist', objectId: ID(3), action: 'playlist.update' })),
    ).toEqual({
      kind: 'playlist',
      id: ID(3),
    });
    expect(
      auditSubject(
        event({
          action: 'publication.create',
          objectType: 'publication',
          detail: { displayId: '../x' },
        }),
      ),
    ).toBeNull();
    expect(auditSubject(event({ objectType: 'membership', action: 'auth.login' }))).toBeNull();
  });
});

describe('audit search and row labels', () => {
  const names: AuditNames = {
    ...NO_AUDIT_NAMES,
    media: new Map([[ID(7), 'clip.mp4']]),
    display: new Map([[ID(1), 'Reception']]),
  };

  it('names the object of an event: its name, or its kind and short id', () => {
    const deleted = event({ action: 'media.delete', objectType: 'media', objectId: ID(7) });
    expect(auditObjectText(deleted, names)).toBe('clip.mp4');
    expect(auditObjectText(deleted, NO_AUDIT_NAMES)).toBe('media 00000000');
    const session = event({ action: 'session.create', objectType: 'session', objectId: 'abc' });
    expect(auditObjectText(session, names)).toBe('session abc');
    expect(auditObjectText(event({ objectType: null, objectId: null }), names)).toBeNull();
  });

  it('tells apart the details buttons of events recorded in the same second', () => {
    const first = event({ id: '1', action: 'media.delete', objectType: 'media', objectId: ID(7) });
    const second = event({ id: '2', action: 'media.delete', objectType: 'media', objectId: ID(8) });
    const one = auditDetailsButtonLabel(first, names, 'Australia/Sydney');
    const two = auditDetailsButtonLabel(second, names, 'Australia/Sydney');
    expect(one).toMatch(/^Details of “.+” for clip\.mp4, /);
    expect(two).toContain(' for media 00000000, ');
    expect(one).not.toBe(two);
  });

  it('finds an event by its words, raw action, object name, actor and detail', () => {
    const pushed = event({
      action: 'display.update',
      objectId: ID(1),
      detail: { fields: 'name' },
    });
    const texts = auditSearchTexts(pushed, names);
    expect(matchesSearch(texts, 'reception')).toBe(true);
    expect(matchesSearch(texts, 'display.update')).toBe(true);
    expect(matchesSearch(texts, 'operator')).toBe(true);
    expect(matchesSearch(texts, 'fields')).toBe(true);
    expect(matchesSearch(texts, auditActionLabel(pushed))).toBe(true);
    expect(matchesSearch(texts, 'clip')).toBe(false);
  });

  it('counts the matches among the events loaded', () => {
    expect(auditSearchCountLabel(3, 50, true)).toBe('3 of the newest 50 events');
    expect(auditSearchCountLabel(0, 12, false)).toBe('0 of 12 events');
    expect(auditSearchCountLabel(1, 1, false)).toBe('1 of 1 event');
  });
});

describe('load older events', () => {
  const page = (ids: readonly string[], nextBefore: string | null) => ({ items: ids, nextBefore });

  it('adds each older page after the ones already loaded', () => {
    const request = { key: 'all', generation: 0 };
    const one = appendOlderAuditPage<string>(null, request, 0, page(['a', 'b'], 'c1'));
    expect(one).toEqual({ key: 'all', generation: 0, items: ['a', 'b'], nextBefore: 'c1' });
    const two = appendOlderAuditPage(one, request, 0, page(['c'], null));
    expect(two).toEqual({ key: 'all', generation: 0, items: ['a', 'b', 'c'], nextBefore: null });
  });

  it('drops an answer read for an earlier first page (a Refresh came in between)', () => {
    const shown: AuditOlderPages<string> = {
      key: 'all',
      generation: 1,
      items: ['x'],
      nextBefore: 'c9',
    };
    const late = appendOlderAuditPage(shown, { key: 'all', generation: 0 }, 1, page(['old'], 'c2'));
    expect(late).toBe(shown);
    expect(appendOlderAuditPage(null, { key: 'all', generation: 0 }, 1, page(['old'], null))).toBe(
      null,
    );
  });

  it('drops it after a filter round trip back to the same filter', () => {
    // Filter A (generation 0) asked for older events, then B (1), then A again (2).
    const late = appendOlderAuditPage<string>(
      null,
      { key: 'category=media', generation: 0 },
      2,
      page(['stale'], null),
    );
    expect(late).toBeNull();
  });

  it('does not continue older events of another filter or first page', () => {
    const other: AuditOlderPages<string> = {
      key: 'category=media',
      generation: 3,
      items: ['m'],
      nextBefore: 'c',
    };
    expect(
      appendOlderAuditPage(other, { key: 'all', generation: 3 }, 3, page(['a'], null)),
    ).toEqual({ key: 'all', generation: 3, items: ['a'], nextBefore: null });
  });
});
