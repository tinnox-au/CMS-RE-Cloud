import { describe, expect, it } from 'vitest';
import { DeliveryStatusViewSchema, type WorkingHours } from '@tinnox/contracts';
import {
  EMPTY_REPORTED_STATE,
  buildDeliveryStatusView,
  heartbeatRejection,
  isStale,
  offlineDue,
  reduceHeartbeat,
  type StatusViewInput,
} from './delivery-state.ts';
import { ID, heartbeat } from './fixtures.test-support.ts';

const at = (iso: string) => new Date(iso);

describe('reduceHeartbeat', () => {
  it('accepts the first report and records server receive time', () => {
    const r = reduceHeartbeat(EMPTY_REPORTED_STATE, {
      registrationId: ID.regA,
      report: heartbeat({ seq: 5 }),
      receivedAt: at('2026-11-14T00:00:10.000Z'),
    });
    expect(r.accepted).toBe(true);
    expect(r.state).toMatchObject({
      registrationId: ID.regA,
      lastSeq: 5,
      activePublicationId: ID.pubA,
      lastHeartbeatAt: '2026-11-14T00:00:10.000Z',
    });
  });

  it('ignores a delayed report with a lower seq and a replay with the same seq', () => {
    const first = reduceHeartbeat(EMPTY_REPORTED_STATE, {
      registrationId: ID.regA,
      report: heartbeat({
        seq: 10,
        activePublicationId: ID.pubB,
        downloadedPublicationId: ID.pubB,
      }),
      receivedAt: at('2026-11-14T00:01:00.000Z'),
    });
    const delayed = reduceHeartbeat(first.state, {
      registrationId: ID.regA,
      report: heartbeat({ seq: 9 }),
      receivedAt: at('2026-11-14T00:02:00.000Z'),
    });
    expect(delayed).toMatchObject({ accepted: false, ignoredReason: 'stale_seq' });
    expect(delayed.state).toBe(first.state);
    expect(delayed.state.activePublicationId).toBe(ID.pubB);
    expect(delayed.state.lastHeartbeatAt).toBe('2026-11-14T00:01:00.000Z');

    const replay = reduceHeartbeat(first.state, {
      registrationId: ID.regA,
      report: heartbeat({ seq: 10 }),
      receivedAt: at('2026-11-14T00:03:00.000Z'),
    });
    expect(replay.accepted).toBe(false);
  });

  it('accepts a higher seq and replaces the whole reported state', () => {
    const first = reduceHeartbeat(EMPTY_REPORTED_STATE, {
      registrationId: ID.regA,
      report: heartbeat({
        seq: 1,
        errors: [
          {
            code: 'download_failed',
            message: 'x',
            at: '2026-11-14T00:00:00.000Z',
            publicationId: ID.pubA,
            assetId: null,
          },
        ],
      }),
      receivedAt: at('2026-11-14T00:00:01.000Z'),
    });
    const next = reduceHeartbeat(first.state, {
      registrationId: ID.regA,
      report: heartbeat({ seq: 2, activeItemIndex: 3 }),
      receivedAt: at('2026-11-14T00:00:16.000Z'),
    });
    expect(next.accepted).toBe(true);
    expect(next.state.activeItemIndex).toBe(3);
    expect(next.state.errors).toEqual([]);
  });

  it('starts a new sequence for a newly registered player', () => {
    const old = reduceHeartbeat(EMPTY_REPORTED_STATE, {
      registrationId: ID.regA,
      report: heartbeat({ seq: 5000 }),
      receivedAt: at('2026-11-14T00:00:01.000Z'),
    });
    const fresh = reduceHeartbeat(old.state, {
      registrationId: ID.regB,
      report: heartbeat({
        seq: 0,
        activePublicationId: null,
        activeItemIndex: null,
        downloadedPublicationId: null,
        playerState: 'idle',
      }),
      receivedAt: at('2026-11-14T00:05:00.000Z'),
    });
    expect(fresh.accepted).toBe(true);
    expect(fresh.state).toMatchObject({
      registrationId: ID.regB,
      lastSeq: 0,
      activePublicationId: null,
    });
  });

  it('does not mutate the previous state or the report', () => {
    const report = heartbeat({ seq: 2 });
    const frozen = JSON.stringify(report);
    const before = { ...EMPTY_REPORTED_STATE };
    reduceHeartbeat(EMPTY_REPORTED_STATE, {
      registrationId: ID.regA,
      report,
      receivedAt: at('2026-11-14T00:00:01.000Z'),
    });
    expect(EMPTY_REPORTED_STATE).toEqual(before);
    expect(JSON.stringify(report)).toBe(frozen);
  });
});

describe('heartbeatRejection', () => {
  const context = { displayId: ID.display, isPublicationOfDisplay: (id: string) => id === ID.pubA };

  it('accepts a consistent report', () => {
    expect(heartbeatRejection(heartbeat(), context)).toBeNull();
  });
  it('rejects a report for another display', () => {
    expect(heartbeatRejection(heartbeat({ displayId: ID.otherDisplay }), context)).toMatch(
      /display other than/,
    );
  });
  it('rejects unknown publications wherever they are named', () => {
    expect(heartbeatRejection(heartbeat({ activePublicationId: ID.pubB }), context)).toMatch(
      /not published to this display/,
    );
    expect(
      heartbeatRejection(heartbeat({ downloadedPublicationId: ID.pubB }), context),
    ).not.toBeNull();
    expect(
      heartbeatRejection(
        heartbeat({
          staging: { publicationId: ID.pubB, phase: 'downloading', assetsDone: 0, assetsTotal: 2 },
        }),
        context,
      ),
    ).not.toBeNull();
    expect(
      heartbeatRejection(
        heartbeat({
          errors: [
            {
              code: 'decode_failed',
              message: 'm',
              at: '2026-11-14T00:00:00.000Z',
              publicationId: ID.pubB,
              assetId: null,
            },
          ],
        }),
        context,
      ),
    ).not.toBeNull();
  });
});

describe('isStale', () => {
  const now = at('2026-11-14T00:10:00.000Z');
  it('treats no report as stale', () => expect(isStale(null, now, 60)).toBe(true));
  it('is fresh up to and including the threshold', () => {
    expect(isStale('2026-11-14T00:09:30.000Z', now, 60)).toBe(false);
    expect(isStale('2026-11-14T00:09:00.000Z', now, 60)).toBe(false);
  });
  it('is stale just past the threshold', () =>
    expect(isStale('2026-11-14T00:08:59.999Z', now, 60)).toBe(true));
  it('treats a future timestamp as fresh and garbage as stale', () => {
    expect(isStale('2026-11-14T00:10:05.000Z', now, 60)).toBe(false);
    expect(isStale('not a date', now, 60)).toBe(true);
  });
  it('rejects a non-positive threshold', () =>
    expect(() => isStale(null, now, 0)).toThrow(RangeError));
});

describe('offlineDue (Australia/Melbourne)', () => {
  const zone = 'Australia/Melbourne';
  const day = { start: '08:00', end: '20:00' };
  const everyDay = [day, day, day, day, day, day, day];
  const allDay = { start: '00:00', end: '24:00' };
  const due = (
    last: string,
    now: string,
    hours: WorkingHours | null,
    timeZone = zone,
    minutes = 30,
  ) => offlineDue(new Date(last), new Date(now), minutes, hours, timeZone);

  it('does not alert at night for a screen switched off at closing time', () => {
    // Tuesday 19:50 to 23:00 local (AEDT, UTC+11): 10 minutes inside hours.
    expect(due('2026-11-17T08:50:00Z', '2026-11-17T12:00:00Z', everyDay)).toBe(false);
  });
  it('carries the minutes before closing over the night', () => {
    // Silent since Tuesday 19:50: 10 minutes that evening, then 20 from Wednesday 08:00.
    expect(due('2026-11-17T08:50:00Z', '2026-11-17T21:19:00Z', everyDay)).toBe(false);
    expect(due('2026-11-17T08:50:00Z', '2026-11-17T21:20:00Z', everyDay)).toBe(true);
  });
  it('does not alert at opening time for a screen off all night', () => {
    // Silent since Tuesday 20:05, after closing: due at Wednesday 08:30, not at opening.
    expect(due('2026-11-17T09:05:00Z', '2026-11-17T21:00:00Z', everyDay)).toBe(false);
    expect(due('2026-11-17T09:05:00Z', '2026-11-17T21:29:00Z', everyDay)).toBe(false);
    expect(due('2026-11-17T09:05:00Z', '2026-11-17T21:30:00Z', everyDay)).toBe(true);
  });
  it('does not alert at opening time when the screen reports within the delay', () => {
    // Reported at 08:10; due at 08:40, not at 08:35.
    expect(due('2026-11-17T21:10:00Z', '2026-11-17T21:35:00Z', everyDay)).toBe(false);
    expect(due('2026-11-17T21:10:00Z', '2026-11-17T21:40:00Z', everyDay)).toBe(true);
  });
  it('does not alert on a day the screen is closed', () => {
    const weekdays = [day, day, day, day, day, null, null];
    // Saturday 2026-11-21, 12:00 local.
    expect(due('2026-11-20T09:00:00Z', '2026-11-21T01:00:00Z', weekdays)).toBe(false);
  });
  it('counts a 24-hour delay across days and over a closed weekend', () => {
    const office = { start: '08:00', end: '18:00' };
    const weekdays = [office, office, office, office, office, null, null];
    // Silent since Thursday 2026-11-19 08:00: 10 h Thursday, 10 h Friday, none at the weekend,
    // so 24 h inside hours are reached on Monday at 12:00 (01:00Z).
    const last = '2026-11-18T21:00:00Z';
    const day1440 = (now: string) => due(last, now, weekdays, zone, 1440);
    expect(day1440('2026-11-22T12:00:00Z')).toBe(false); // Sunday 23:00
    expect(day1440('2026-11-23T00:59:00Z')).toBe(false); // Monday 11:59
    expect(day1440('2026-11-23T01:00:00Z')).toBe(true); // Monday 12:00
    // 48 h: 20 h by Friday, 10 h Monday and Tuesday, 8 h Wednesday: Wednesday 16:00.
    expect(due(last, '2026-11-25T04:59:00Z', weekdays, zone, 2880)).toBe(false);
    expect(due(last, '2026-11-25T05:00:00Z', weekdays, zone, 2880)).toBe(true);
  });
  it('counts an outage across midnight on all-day hours', () => {
    const always = [allDay, allDay, allDay, allDay, allDay, allDay, allDay];
    // Silent since Tuesday 23:45: due at Wednesday 00:15, not 00:30.
    expect(due('2026-11-17T12:45:00Z', '2026-11-17T13:14:00Z', always)).toBe(false);
    expect(due('2026-11-17T12:45:00Z', '2026-11-17T13:15:00Z', always)).toBe(true);
    // A 24-hour delay fires after 24 hours.
    expect(due('2026-11-17T12:00:00Z', '2026-11-18T11:59:00Z', always, zone, 1440)).toBe(false);
    expect(due('2026-11-17T12:00:00Z', '2026-11-18T12:00:00Z', always, zone, 1440)).toBe(true);
  });
  it('counts every minute for an always-on screen', () => {
    expect(due('2026-11-17T12:00:00Z', '2026-11-17T12:29:59Z', null)).toBe(false);
    expect(due('2026-11-17T12:00:00Z', '2026-11-17T12:30:00Z', null)).toBe(true);
  });
  it('fails open on a zone this runtime does not know', () => {
    // 23:00 in Melbourne would be closed; an unknown zone counts every minute.
    expect(due('2026-11-17T11:00:00Z', '2026-11-17T12:00:00Z', everyDay, 'Mars/Olympus_Mons')).toBe(
      true,
    );
  });
  it('counts real minutes on the DST change day', () => {
    // Sunday 2026-10-04: 02:00 AEST becomes 03:00 AEDT. Silent since 01:00 AEST.
    expect(due('2026-10-03T15:00:00Z', '2026-10-03T21:29:00Z', everyDay)).toBe(false); // 08:29 AEDT
    expect(due('2026-10-03T15:00:00Z', '2026-10-03T21:30:00Z', everyDay)).toBe(true); // 08:30 AEDT
    // Open from 01:00, silent since 00:30 AEST, 2-hour delay: 01:00 AEST to 04:00 AEDT is two
    // real hours, though the wall clock moved three.
    const early = [1, 2, 3, 4, 5, 6, 7].map(() => ({ start: '01:00', end: '20:00' }));
    expect(due('2026-10-03T14:30:00Z', '2026-10-03T16:00:00Z', early, zone, 120)).toBe(false); // 03:00 AEDT
    expect(due('2026-10-03T14:30:00Z', '2026-10-03T16:59:00Z', early, zone, 120)).toBe(false);
    expect(due('2026-10-03T14:30:00Z', '2026-10-03T17:00:00Z', early, zone, 120)).toBe(true); // 04:00 AEDT
    // Always on: 01:45 AEST to 03:05 AEDT is 20 real minutes, though the wall clock moved 80.
    expect(due('2026-10-03T15:45:00Z', '2026-10-03T16:05:00Z', null)).toBe(false);
  });
  it('counts the exact minutes when hours do not fall on 5-minute marks', () => {
    // Round 8 EAU-01: closing at 18:02, silent since Tuesday 17:34 is 28 minutes that day.
    const odd = [1, 2, 3, 4, 5, 6, 7].map(() => ({ start: '08:00', end: '18:02' }));
    expect(due('2026-11-17T06:34:00Z', '2026-11-17T07:04:00Z', odd)).toBe(false); // 18:04
    expect(due('2026-11-17T06:34:00Z', '2026-11-17T21:01:00Z', odd)).toBe(false); // 08:01
    expect(due('2026-11-17T06:34:00Z', '2026-11-17T21:02:00Z', odd)).toBe(true); // 08:02
    // An opening shorter than a step, 09:01 to 09:04 UTC: 3 minutes a day, so 30 minutes take
    // ten days.
    const short = [1, 2, 3, 4, 5, 6, 7].map(() => ({ start: '09:01', end: '09:04' }));
    expect(due('2026-10-01T10:00:00Z', '2026-10-10T09:03:00Z', short, 'UTC')).toBe(false);
    expect(due('2026-10-01T10:00:00Z', '2026-10-11T09:04:00Z', short, 'UTC')).toBe(true);
  });
  it('alerts at the first open moment after 14 silent days when the delay needs more', () => {
    // Round 8 EAX-02: one hour a day never reaches 48 hours within the 14 days scanned.
    const noon = [1, 2, 3, 4, 5, 6, 7].map(() => ({ start: '12:00', end: '13:00' }));
    const long = (last: string, now: string) => due(last, now, noon, 'UTC', 2880);
    expect(long('2026-09-21T12:30:00Z', '2026-11-20T01:30:00Z')).toBe(false); // closed
    expect(long('2026-09-21T12:30:00Z', '2026-11-20T12:30:00Z')).toBe(true); // open
    expect(long('2026-11-06T12:31:00Z', '2026-11-20T12:30:00Z')).toBe(false); // 1 min short
    expect(long('2026-11-06T12:30:00Z', '2026-11-20T12:30:00Z')).toBe(true); // 14 days
  });
  it('can come due at closing time; the check then sends it just after closing', () => {
    // Round 8 EAX-03, kept by Michael: the delay counts inside hours only, but an alert due at
    // 17:00 goes out at the next check, a minute or two after closing.
    const office = [1, 2, 3, 4, 5, 6, 7].map(() => ({ start: '09:00', end: '17:00' }));
    expect(due('2026-11-17T05:30:00Z', '2026-11-17T05:59:00Z', office)).toBe(false); // 16:59
    expect(due('2026-11-17T05:30:00Z', '2026-11-17T06:00:00Z', office)).toBe(true); // 17:00
    expect(due('2026-11-17T05:30:00Z', '2026-11-17T06:02:00Z', office)).toBe(true); // 17:02
    // Silent since 16:31: 29 minutes that day, the 30th at 09:00 to 09:01 the next morning.
    expect(due('2026-11-17T05:31:00Z', '2026-11-17T06:01:00Z', office)).toBe(false); // 17:01
    expect(due('2026-11-17T05:31:00Z', '2026-11-17T22:00:00Z', office)).toBe(false); // 09:00
    expect(due('2026-11-17T05:31:00Z', '2026-11-17T22:01:00Z', office)).toBe(true); // 09:01
  });
});

describe('buildDeliveryStatusView', () => {
  const now = at('2026-11-14T00:10:00.000Z');
  const reported = reduceHeartbeat(EMPTY_REPORTED_STATE, {
    registrationId: ID.regA,
    report: heartbeat({ seq: 1 }),
    receivedAt: at('2026-11-14T00:09:50.000Z'),
  }).state;
  const base: StatusViewInput = {
    displayId: ID.display,
    activeRegistrationId: ID.regA,
    desired: { publicationId: ID.pubA, publishedAt: '2026-11-14T00:00:00.000Z' },
    reported,
    now,
    staleAfterSeconds: 60,
  };
  const summary = (overrides: Partial<StatusViewInput>) =>
    buildDeliveryStatusView({ ...base, ...overrides });

  it('reports in_sync only for a fresh playing report of the desired publication', () => {
    const view = summary({});
    expect(DeliveryStatusViewSchema.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({
      summary: 'in_sync',
      stale: false,
      paired: true,
      active: { publicationId: ID.pubA, itemIndex: 0 },
      downloaded: { publicationId: ID.pubA },
    });
  });

  it('distinguishes desired from reported when a newer publication is pending', () => {
    const view = summary({
      desired: { publicationId: ID.pubB, publishedAt: '2026-11-14T00:09:55.000Z' },
    });
    expect(view.summary).toBe('updating');
    expect(view.desired?.publicationId).toBe(ID.pubB);
    expect(view.active?.publicationId).toBe(ID.pubA);
  });

  it('marks an old report stale without discarding what it said', () => {
    const view = summary({ now: at('2026-11-14T00:20:00.000Z') });
    expect(view).toMatchObject({
      summary: 'stale',
      stale: true,
      lastHeartbeatAt: '2026-11-14T00:09:50.000Z',
    });
    expect(view.active?.publicationId).toBe(ID.pubA);
  });

  it('reports unpaired, awaiting_player, nothing_published and error', () => {
    expect(summary({ activeRegistrationId: null }).summary).toBe('unpaired');
    expect(summary({ reported: EMPTY_REPORTED_STATE }).summary).toBe('awaiting_player');
    expect(summary({ reported: EMPTY_REPORTED_STATE, desired: null }).summary).toBe(
      'nothing_published',
    );
    expect(summary({ desired: null }).summary).toBe('nothing_published');
    expect(summary({ reported: { ...reported, playerState: 'error' } }).summary).toBe('error');
  });

  it('reports standing_by when the player holds the desired publication and shows nothing', () => {
    const idle = { ...reported, playerState: 'idle' as const, activePublicationId: null };
    expect(summary({ reported: idle }).summary).toBe('standing_by');
    expect(summary({ reported: { ...idle, downloadedPublicationId: ID.pubB } }).summary).toBe(
      'updating',
    );
    expect(summary({ reported: idle, now: at('2026-11-14T00:20:00.000Z') }).summary).toBe('stale');
  });

  it('does not present a revoked player report as the current state', () => {
    const view = summary({ activeRegistrationId: ID.regB });
    expect(view).toMatchObject({
      summary: 'awaiting_player',
      active: null,
      downloaded: null,
      lastHeartbeatAt: null,
      stale: true,
    });
  });
});
