import {
  AUDIT_ACTIONS,
  AUDIT_ACTOR_TYPES,
  AUDIT_RESULTS,
  type AuditEventDto,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  activityActorLabel,
  activityHref,
  activityKindsToLoad,
  activityRefs,
  activitySentence,
  activityTimeLabel,
  describeActivity,
  presentActivity,
  type ActivityNames,
} from './activity.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SCREEN = ID(1);
const PLAYLIST = ID(2);
const MEDIA = ID(3);
const TAG = ID(4);
const FOLDER = ID(5);

function event(change: Partial<AuditEventDto> = {}): AuditEventDto {
  return {
    id: '10',
    occurredAt: '2026-11-14T03:00:00.000Z',
    actorType: 'operator',
    actorId: ID(9),
    action: 'playlist.update',
    objectType: 'playlist',
    objectId: PLAYLIST,
    result: 'success',
    detail: null,
    ...change,
  };
}

const NAMES: ActivityNames = {
  display: new Map([[SCREEN, 'Foyer']]),
  playlist: new Map([[PLAYLIST, 'Reception loop']]),
  media: new Map([[MEDIA, 'welcome.jpg']]),
  tag: new Map([[TAG, 'Promotions']]),
  folder: new Map([[FOLDER, 'Spring']]),
};

describe('describeActivity', () => {
  it('has its own words for every action of the contract, for every result', () => {
    for (const action of AUDIT_ACTIONS) {
      for (const result of AUDIT_RESULTS) {
        const description = describeActivity(event({ action, result, objectType: null }));
        expect(description.known, action).toBe(true);
        expect(description.text.length, action).toBeGreaterThan(3);
        // Plain words: never the raw action, never a code name.
        expect(description.text, action).not.toContain(action);
        expect(description.text, action).not.toMatch(/[._]/);
        expect(description.text.charAt(0), action).toMatch(/[A-Z]/);
      }
    }
  });

  it('gives each action wording of its own', () => {
    const texts = AUDIT_ACTIONS.map((action) => describeActivity(event({ action })).text);
    expect(new Set(texts).size).toBe(AUDIT_ACTIONS.length);
  });

  it('never says display, online or offline to an operator', () => {
    const details: AuditEventDto['detail'][] = [
      null,
      { fields: ['assignedPlaylistId'], assignedPlaylistId: PLAYLIST },
      { fields: ['assignedPlaylistId'], assignedPlaylistId: null },
      { reason: 'replaced', displayId: SCREEN },
      { reason: 'player_reset', displayId: SCREEN },
      { scope: 'display' },
      { scope: 'media' },
      { duplicatedFrom: PLAYLIST },
    ];
    for (const action of [...AUDIT_ACTIONS, 'display.archive', 'display.display_moved']) {
      for (const result of AUDIT_RESULTS) {
        for (const detail of details) {
          const item = presentActivity(event({ action, result, detail }), NAMES);
          const text = `${item.text} ${item.resultLabel ?? ''} ${item.actor}`.toLowerCase();
          expect(text, action).not.toMatch(/online|offline|display/);
        }
      }
    }
  });

  it('says what failed or was refused instead of what was done', () => {
    expect(describeActivity(event({ action: 'media.upload', result: 'denied' })).text).toBe(
      'Upload refused',
    );
    expect(describeActivity(event({ action: 'media.upload', result: 'failure' })).text).toBe(
      'Upload failed',
    );
    expect(describeActivity(event({ action: 'auth.login', result: 'denied' })).text).toBe(
      'Sign-in refused',
    );
    expect(describeActivity(event({ action: 'media.validate', result: 'failure' })).text).toBe(
      'Media check failed',
    );
    expect(describeActivity(event({ action: 'playlist.update', result: 'failure' })).text).toBe(
      'Playlist update failed',
    );
  });

  it('names the object of a plain event', () => {
    const description = describeActivity(event());
    expect(description).toMatchObject({
      text: 'Playlist updated',
      subject: { kind: 'playlist', id: PLAYLIST },
      related: null,
      icon: 'playlist',
      removesSubject: false,
    });
  });

  it('reads identifiers in lower case', () => {
    const upper = PLAYLIST.toUpperCase();
    expect(describeActivity(event({ objectId: upper })).subject?.id).toBe(PLAYLIST);
  });

  it('describes a push by its screen and names the playlist as related', () => {
    const pushed = describeActivity(
      event({
        action: 'publication.create',
        objectType: 'publication',
        objectId: ID(7),
        detail: {
          displayId: SCREEN,
          playlistId: PLAYLIST,
          items: 2,
          route: 'browser',
          via: 'push',
        },
      }),
    );
    expect(pushed.text).toBe('Pushed to screen');
    expect(pushed.subject).toEqual({ kind: 'display', id: SCREEN });
    expect(pushed.related).toEqual({ kind: 'playlist', id: PLAYLIST });
    expect(pushed.relatedLabel).toBe('Playlist');
    expect(pushed.icon).toBe('push');

    const refused = describeActivity(
      event({
        action: 'publication.create',
        result: 'failure',
        detail: { displayId: SCREEN, reasons: ['playlist_empty', 'playlist_empty'], via: 'push' },
      }),
    );
    expect(refused.text).toBe('Push to screen failed');
    expect(refused.subject).toEqual({ kind: 'display', id: SCREEN });
    expect(refused.related).toEqual({ kind: 'playlist', id: PLAYLIST });
    expect(refused.reasonCodes).toEqual(['playlist_empty']);
  });

  it('tells an assignment from another change of a screen', () => {
    const base = { action: 'display.update', objectType: 'display', objectId: SCREEN };
    const assigned = describeActivity(
      event({ ...base, detail: { fields: ['assignedPlaylistId'], assignedPlaylistId: PLAYLIST } }),
    );
    expect(assigned.text).toBe('Playlist assigned to screen');
    expect(assigned.related).toEqual({ kind: 'playlist', id: PLAYLIST });

    const removed = describeActivity(
      event({ ...base, detail: { fields: ['assignedPlaylistId'], assignedPlaylistId: null } }),
    );
    expect(removed.text).toBe('Playlist removed from screen');
    expect(removed.related).toBeNull();

    const mixed = describeActivity(
      event({
        ...base,
        detail: { fields: ['assignedPlaylistId', 'name'], assignedPlaylistId: PLAYLIST },
      }),
    );
    expect(mixed.text).toBe('Screen updated');
    expect(describeActivity(event({ ...base, detail: { fields: ['canvas'] } })).text).toBe(
      'Screen updated',
    );
  });

  it('finds the screen of a pairing or revocation in the detail', () => {
    const paired = describeActivity(
      event({
        action: 'pairing.complete',
        actorType: 'player',
        objectType: 'player_registration',
        objectId: ID(8),
        detail: { displayId: SCREEN, pairingId: ID(6) },
      }),
    );
    expect(paired.subject).toEqual({ kind: 'display', id: SCREEN });

    const revoke = { action: 'player.revoke', objectType: 'player_registration', objectId: ID(8) };
    expect(
      describeActivity(event({ ...revoke, detail: { reason: 'operator', displayId: SCREEN } })),
    ).toMatchObject({ text: 'Player revoked on screen', subject: { kind: 'display', id: SCREEN } });
    expect(
      describeActivity(event({ ...revoke, detail: { reason: 'replaced', displayId: SCREEN } }))
        .text,
    ).toBe('Player replaced on screen');
    expect(
      describeActivity(event({ ...revoke, detail: { reason: 'player_reset', displayId: SCREEN } }))
        .text,
    ).toBe('Player unpaired itself from screen');
    // Revoking a screen without a player names the screen itself as the object.
    expect(
      describeActivity(
        event({ action: 'player.revoke', objectType: 'display', objectId: SCREEN, detail: null }),
      ).subject,
    ).toEqual({ kind: 'display', id: SCREEN });
  });

  it('says which kind of tag was created or deleted', () => {
    const tag = { objectType: 'tag', objectId: TAG };
    expect(
      describeActivity(event({ ...tag, action: 'tag.create', detail: { scope: 'display' } })).text,
    ).toBe('Screen tag created');
    expect(
      describeActivity(event({ ...tag, action: 'tag.delete', detail: { scope: 'media' } })).text,
    ).toBe('Media tag deleted');
    expect(describeActivity(event({ ...tag, action: 'tag.update', detail: null })).text).toBe(
      'Tag updated',
    );
    expect(describeActivity(event({ ...tag, action: 'tag.create', detail: null })).text).toBe(
      'Tag created',
    );
  });

  it('tells a duplicate from a new playlist', () => {
    const copy = describeActivity(
      event({ action: 'playlist.create', detail: { duplicatedFrom: ID(20), itemCount: 3 } }),
    );
    expect(copy.text).toBe('Playlist duplicated');
    expect(copy.related).toEqual({ kind: 'playlist', id: ID(20) });
    expect(copy.relatedLabel).toBe('Copied from');
    expect(describeActivity(event({ action: 'playlist.create' })).relatedLabel).toBeNull();
    expect(describeActivity(event({ action: 'playlist.create' })).text).toBe('Playlist created');
  });

  it('marks deletions, whose object can never be named', () => {
    for (const action of ['media.delete', 'tag.delete', 'folder.delete', 'playlist.delete']) {
      expect(describeActivity(event({ action })).removesSubject, action).toBe(true);
      expect(describeActivity(event({ action, result: 'failure' })).removesSubject).toBe(false);
    }
    expect(describeActivity(event({ action: 'playlist.update' })).removesSubject).toBe(false);
  });

  it('collects reason codes only for events that did not succeed', () => {
    expect(
      describeActivity(
        event({ action: 'media.upload', result: 'denied', detail: { reason: 'quota_exceeded' } }),
      ).reasonCodes,
    ).toEqual(['quota_exceeded']);
    expect(
      describeActivity(
        event({
          action: 'media.validate',
          result: 'failure',
          detail: { errorCode: 'unsupported_codec' },
        }),
      ).reasonCodes,
    ).toEqual(['unsupported_codec']);
    expect(
      describeActivity(event({ action: 'player.revoke', detail: { reason: 'operator' } }))
        .reasonCodes,
    ).toEqual([]);
    // Free text is not a code and is not shown.
    expect(
      describeActivity(event({ result: 'failure', detail: { reason: 'Something went wrong!' } }))
        .reasonCodes,
    ).toEqual([]);
    expect(
      describeActivity(
        event({ result: 'failure', detail: { reasons: ['a', 'b', 'c', 'd', 7, null] } }),
      ).reasonCodes,
    ).toEqual(['a', 'b', 'c']);
  });

  it('falls back to readable words for an action it does not know', () => {
    const unknown = describeActivity(
      event({ action: 'media.transcode_started', objectType: 'media', objectId: MEDIA }),
    );
    expect(unknown).toMatchObject({
      text: 'Media: transcode started',
      known: false,
      icon: 'media',
      subject: { kind: 'media', id: MEDIA },
    });
    expect(
      describeActivity(event({ action: 'billing.invoice_sent', objectType: null })),
    ).toMatchObject({ text: 'Billing: invoice sent', known: false, icon: 'other', subject: null });
    expect(describeActivity(event({ action: 'maintenance', objectType: null })).text).toBe(
      'Maintenance',
    );
    expect(describeActivity(event({ action: '', objectType: null })).text).toBe('Activity');
    expect(
      describeActivity(event({ action: 'display.archive', result: 'denied', objectType: null }))
        .text,
    ).toBe('Screen: archive (refused)');
    expect(
      describeActivity(event({ action: 'schedule.run', result: 'failure', objectType: null })).text,
    ).toBe('Schedule: run (failed)');
    // A category named like a property of every object is still just words.
    expect(describeActivity(event({ action: 'constructor.run', objectType: null })).text).toBe(
      'Constructor: run',
    );
    expect(describeActivity(event({ action: 'toString', objectType: null })).text).toBe('ToString');
  });
});

describe('presentActivity', () => {
  it('adds the name and the page of the object', () => {
    const item = presentActivity(event(), NAMES);
    expect(item.subject).toEqual({
      kind: 'playlist',
      id: PLAYLIST,
      name: 'Reception loop',
      href: `/playlists/${PLAYLIST}`,
    });
    expect(activitySentence(item)).toBe('Playlist updated: Reception loop');
    expect(item).toMatchObject({
      resultLabel: null,
      tone: 'neutral',
      actor: 'Operator',
      subjectGone: false,
    });
  });

  it('shows a push with its screen and its playlist', () => {
    const item = presentActivity(
      event({
        action: 'publication.create',
        objectType: 'publication',
        objectId: ID(7),
        detail: { displayId: SCREEN, playlistId: PLAYLIST },
      }),
      NAMES,
    );
    expect(activitySentence(item)).toBe('Pushed to screen: Foyer');
    expect(item.subject?.href).toBe(`/screens/${SCREEN}`);
    expect(item.related?.name).toBe('Reception loop');
  });

  it('leaves out the name and the link of an object that has been deleted since', () => {
    const item = presentActivity(event({ objectId: ID(77) }), NAMES);
    expect(item.subject).toBeNull();
    expect(item.subjectGone).toBe(true);
    expect(activitySentence(item)).toBe('Playlist updated');
  });

  it('does not call an object deleted while its list is not loaded', () => {
    const item = presentActivity(event(), {});
    expect(item.subject).toBeNull();
    expect(item.subjectGone).toBe(false);
  });

  it('never names or links the object of a deletion', () => {
    // Even when a list read before the deletion still holds the name.
    const item = presentActivity(event({ action: 'playlist.delete' }), NAMES);
    expect(item.subject).toBeNull();
    expect(item.subjectGone).toBe(false);
    expect(activitySentence(item)).toBe('Playlist deleted');
    const gone = presentActivity(event({ action: 'playlist.delete', objectId: ID(78) }), NAMES);
    expect(gone.subject).toBeNull();
    expect(gone.subjectGone).toBe(false);
  });

  it('labels what failed and what was refused', () => {
    expect(presentActivity(event({ result: 'failure' }), NAMES)).toMatchObject({
      resultLabel: 'Failed',
      tone: 'danger',
    });
    expect(presentActivity(event({ result: 'denied' }), NAMES)).toMatchObject({
      resultLabel: 'Refused',
      tone: 'warn',
    });
  });

  it('names every kind of actor', () => {
    const labels = AUDIT_ACTOR_TYPES.map(activityActorLabel);
    expect(new Set(labels).size).toBe(AUDIT_ACTOR_TYPES.length);
    for (const label of labels) expect(label.length).toBeGreaterThan(3);
  });

  it('keeps the raw action for an event it does not know', () => {
    const item = presentActivity(event({ action: 'media.transcode_started' }), NAMES);
    expect(item.known).toBe(false);
    expect(item.action).toBe('media.transcode_started');
  });
});

describe('activityHref', () => {
  it('links to the page of the object where one exists', () => {
    expect(activityHref({ kind: 'display', id: SCREEN })).toBe(`/screens/${SCREEN}`);
    expect(activityHref({ kind: 'playlist', id: PLAYLIST })).toBe(`/playlists/${PLAYLIST}`);
    expect(activityHref({ kind: 'media', id: MEDIA })).toBe(`/media/${MEDIA}`);
    expect(activityHref({ kind: 'tag', id: TAG })).toBe('/settings/tags');
    expect(activityHref({ kind: 'folder', id: FOLDER })).toBeNull();
  });

  it('never links to the M0 address of a screen', () => {
    expect(activityHref({ kind: 'display', id: SCREEN })).not.toContain('display');
  });
});

describe('activityRefs and activityKindsToLoad', () => {
  const events = [
    event({ id: '3' }),
    event({ id: '2' }),
    event({ id: '1', action: 'playlist.delete', objectId: ID(30) }),
    event({
      id: '0',
      action: 'publication.create',
      objectType: 'publication',
      objectId: ID(7),
      detail: { displayId: SCREEN, playlistId: ID(31) },
    }),
    event({ id: '-1', action: 'auth.login', objectType: 'membership', objectId: ID(9) }),
  ];

  it('lists each named object once and skips what was deleted', () => {
    expect(activityRefs(events)).toEqual([
      { kind: 'playlist', id: PLAYLIST },
      { kind: 'display', id: SCREEN },
      { kind: 'playlist', id: ID(31) },
    ]);
    expect(activityRefs([])).toEqual([]);
  });

  it('asks only for the kinds with a name that is missing', () => {
    const refs = activityRefs(events);
    expect(activityKindsToLoad(refs, {})).toEqual(['display', 'playlist']);
    expect(activityKindsToLoad(refs, NAMES)).toEqual(['playlist']);
    expect(
      activityKindsToLoad(refs, {
        ...NAMES,
        playlist: new Map([
          [PLAYLIST, 'Reception loop'],
          [ID(31), 'Evening loop'],
        ]),
      }),
    ).toEqual([]);
    expect(activityKindsToLoad([], {})).toEqual([]);
  });
});

describe('activityTimeLabel', () => {
  const at = '2026-11-14T03:00:00.000Z';
  const base = Date.parse(at);

  it('counts within a day', () => {
    expect(activityTimeLabel(at, base + 2_000)).toBe('just now');
    expect(activityTimeLabel(at, base + 42_000)).toBe('42 seconds ago');
    expect(activityTimeLabel(at, base + 5 * 60_000)).toBe('5 minutes ago');
    expect(activityTimeLabel(at, base + 23 * 3_600_000)).toBe('23 hours ago');
  });

  it('reads a time in the future as just now', () => {
    expect(activityTimeLabel(at, base - 60_000)).toBe('just now');
  });

  it('gives the day after a day, and the year after about a year', () => {
    const midday = '2026-11-14T12:00:00.000Z';
    const later = activityTimeLabel(midday, Date.parse(midday) + 3 * 86_400_000);
    expect(later).toMatch(/1[45] Nov/);
    expect(later).not.toContain('2026');
    expect(activityTimeLabel(midday, Date.parse(midday) + 400 * 86_400_000)).toMatch(
      /1[45] Nov 2026/,
    );
  });

  it('returns what it was given when that is not a time', () => {
    expect(activityTimeLabel('not a time', base)).toBe('not a time');
  });
});
