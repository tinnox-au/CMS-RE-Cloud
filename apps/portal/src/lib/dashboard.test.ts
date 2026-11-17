import {
  DELIVERY_SUMMARIES,
  PUSH_STATES,
  PushPlanResponseSchema,
  type DeliveryStatusView,
  type DeliverySummary,
  type DisplayDto,
  type OverviewResponse,
  type PushPlanResponse,
  type PushPlanRow,
  type PushState,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import {
  anythingPushed,
  formatCount,
  isEmptyOrganisation,
  mediaStatusNotes,
  pluralCount,
  pushOverview,
  readPlanOnArrival,
  screenCounters,
  SCREENS_STATUS_PARAMS,
  screensNeedingAttention,
  screensPath,
  setupProgress,
  type SetupInput,
} from './dashboard.ts';
import { SCREEN_STATUS_KINDS, SCREEN_STATUS_LABELS, screenStatusGroup } from './screenStatus.ts';
import { statusFilterOf } from './screensList.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-11-14T03:00:00.000Z';

function bySummary(
  change: Partial<Record<DeliverySummary, number>> = {},
): OverviewResponse['displays']['bySummary'] {
  return {
    unpaired: 0,
    nothing_published: 0,
    awaiting_player: 0,
    stale: 0,
    updating: 0,
    error: 0,
    standing_by: 0,
    in_sync: 0,
    ...change,
  };
}

function overview(change: Partial<OverviewResponse> = {}): OverviewResponse {
  return {
    displays: { total: 0, paired: 0, bySummary: bySummary() },
    media: { total: 0, ready: 0, processing: 0, failed: 0, usedBytes: 0, limitBytes: 1024 },
    playlists: { total: 0 },
    pendingPushCount: 0,
    ...change,
  };
}

function display(n: number, name: string): DisplayDto {
  return {
    id: ID(n),
    siteId: ID(900),
    name,
    description: null,
    canvas: { width: 1920, height: 1080 },
    contentRect: null,
    defaultFit: 'contain',
    rotation: 0,
    workingHours: null,
    route: 'browser',
    player: null,
    tagIds: [],
    assignedPlaylist: null,
    assignedSchedule: null,
    createdAt: T,
    updatedAt: T,
  };
}

function view(n: number, change: Partial<DeliveryStatusView> = {}): DeliveryStatusView {
  return {
    displayId: ID(n),
    paired: true,
    registrationId: ID(800 + n),
    desired: { publicationId: ID(700), publishedAt: T },
    downloaded: { publicationId: ID(700) },
    active: { publicationId: ID(700), itemIndex: 0 },
    playerState: 'playing',
    staging: null,
    lastHeartbeatAt: T,
    stale: false,
    staleAfterSeconds: 60,
    errors: [],
    summary: 'in_sync',
    asOf: T,
    ...change,
  };
}

function row(n: number, state: PushState, name = `Screen ${n}`): PushPlanRow {
  return {
    display: { id: ID(n), name },
    playlist: state === 'nothing_assigned' ? null : { id: ID(500), name: 'Reception loop' },
    schedule: null,
    state,
    issues:
      state === 'blocked'
        ? [{ path: 'playlist', message: 'The playlist has no items.', code: 'playlist_empty' }]
        : [],
    lastPushedAt: state === 'changes' || state === 'up_to_date' || state === 'blocked' ? T : null,
  };
}

function plan(states: readonly PushState[]): PushPlanResponse {
  const items = states.map((state, index) => row(index + 1, state));
  const pendingCount = items.filter(
    (item) => item.state === 'changes' || item.state === 'never_pushed',
  ).length;
  // The fixture must be a plan the API could send.
  return PushPlanResponseSchema.parse({ items, pendingCount });
}

describe('formatCount and pluralCount', () => {
  it('groups thousands and picks the right word', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12345)).toBe('12,345');
    expect(pluralCount(1, 'screen')).toBe('1 screen');
    expect(pluralCount(0, 'screen')).toBe('0 screens');
    expect(pluralCount(1204, 'screen')).toBe('1,204 screens');
    expect(pluralCount(1, 'screen is', 'screens are')).toBe('1 screen is');
    expect(pluralCount(2, 'screen is', 'screens are')).toBe('2 screens are');
  });
});

describe('screensPath', () => {
  it('builds the address the screens list reads', () => {
    expect(screensPath()).toBe('/screens');
    expect(SCREENS_STATUS_PARAMS.map(screensPath)).toEqual([
      '/screens?status=in_sync',
      '/screens?status=updating',
      '/screens?status=attention',
      '/screens?status=unpaired',
    ]);
  });
});

describe('screenCounters', () => {
  it('lists the four counters in a fixed order, each with its filtered list', () => {
    const counters = screenCounters(bySummary());
    expect(counters.map((counter) => counter.label)).toEqual([
      'In sync',
      'Updating or waiting',
      'Needs attention',
      'Not paired',
    ]);
    expect(counters.map((counter) => counter.href)).toEqual(SCREENS_STATUS_PARAMS.map(screensPath));
    expect(counters.map((counter) => counter.count)).toEqual([0, 0, 0, 0]);
  });

  it('puts every delivery summary into exactly one counter', () => {
    for (const summary of DELIVERY_SUMMARIES) {
      const counters = screenCounters(bySummary({ [summary]: 3 }));
      expect(
        counters.filter((counter) => counter.count === 3),
        summary,
      ).toHaveLength(1);
      expect(counters.reduce((sum, counter) => sum + counter.count, 0)).toBe(3);
    }
  });

  it('adds up to the number of screens', () => {
    const counters = screenCounters(
      bySummary({
        in_sync: 4,
        standing_by: 2,
        updating: 2,
        awaiting_player: 1,
        nothing_published: 3,
        stale: 5,
        error: 6,
        unpaired: 7,
      }),
    );
    expect(counters.map((counter) => counter.count)).toEqual([6, 6, 11, 7]);
  });

  it('links each counter to the filter of the screens list that shows the same screens', () => {
    for (const counter of screenCounters(bySummary())) {
      const kinds = SCREEN_STATUS_KINDS.filter((kind) => screenStatusGroup(kind) === counter.group);
      expect(kinds.length, counter.label).toBeGreaterThan(0);
      for (const kind of kinds) expect(statusFilterOf(kind), kind).toBe(counter.status);
    }
  });

  it('gives the healthy tone to the in-sync counter only', () => {
    const counters = screenCounters(bySummary());
    expect(counters.filter((counter) => counter.tone === 'ok').map((c) => c.group)).toEqual([
      'in_sync',
    ]);
  });

  it('names in each hint the statuses it counts, in the approved words', () => {
    for (const counter of screenCounters(bySummary())) {
      const kinds = SCREEN_STATUS_KINDS.filter((kind) => screenStatusGroup(kind) === counter.group);
      if (kinds.length < 2) continue;
      for (const kind of kinds) {
        expect(counter.hint.toLowerCase(), counter.label).toContain(
          SCREEN_STATUS_LABELS[kind].toLowerCase(),
        );
      }
    }
  });

  it('never says online, offline or display', () => {
    for (const counter of screenCounters(bySummary())) {
      expect(`${counter.label} ${counter.hint}`.toLowerCase()).not.toMatch(
        /online|offline|display/,
      );
      expect(counter.href).not.toContain('display');
    }
  });
});

describe('screensNeedingAttention', () => {
  const displays = [
    display(1, 'Foyer'),
    display(2, 'Atrium 10'),
    display(3, 'Atrium 2'),
    display(4, 'Cafe'),
    display(5, 'Dock'),
  ];

  it('keeps errors and screens that stopped reporting, errors first, then by name', () => {
    const list = screensNeedingAttention(displays, [
      view(1, { summary: 'stale', stale: true }),
      view(2, { summary: 'stale', stale: true }),
      view(3, { summary: 'error' }),
      view(4, { summary: 'in_sync' }),
      view(5, { summary: 'unpaired', paired: false, stale: true, lastHeartbeatAt: null }),
    ]);
    expect(list.total).toBe(3);
    expect(list.rows.map((item) => item.display.name)).toEqual(['Atrium 2', 'Atrium 10', 'Foyer']);
    expect(list.rows.map((item) => item.kind)).toEqual(['error', 'not_reporting', 'not_reporting']);
  });

  it('leaves out screens that are only waiting', () => {
    const list = screensNeedingAttention(displays, [
      view(1, { summary: 'updating' }),
      view(2, { summary: 'awaiting_player', lastHeartbeatAt: null, stale: true }),
      view(3, { summary: 'nothing_published', desired: null }),
    ]);
    expect(list).toEqual({ rows: [], total: 0 });
  });

  it('treats an in-sync summary that arrives stale as not reporting, like the pill', () => {
    const list = screensNeedingAttention(displays, [view(1, { summary: 'in_sync', stale: true })]);
    expect(list.rows.map((item) => item.kind)).toEqual(['not_reporting']);
  });

  it('limits the rows and still counts them all', () => {
    const statuses = displays.map((item, index) => view(index + 1, { summary: 'error' }));
    const list = screensNeedingAttention(displays, statuses, 2);
    expect(list.rows).toHaveLength(2);
    expect(list.total).toBe(5);
    expect(screensNeedingAttention(displays, statuses).rows).toHaveLength(5);
  });

  it('skips a status whose screen is not in the list, and matches ids in any case', () => {
    const list = screensNeedingAttention(
      [display(1, 'Foyer')],
      [
        view(1, { displayId: ID(1).toUpperCase(), summary: 'error' }),
        view(9, { summary: 'error' }),
      ],
    );
    expect(list.total).toBe(1);
    expect(list.rows[0]?.display.name).toBe('Foyer');
  });
});

describe('anythingPushed', () => {
  it('is unknown while neither source has answered', () => {
    expect(anythingPushed(null, null)).toBeNull();
  });

  it('is true when a status has a desired publication or the plan has a push time', () => {
    expect(anythingPushed([view(1)], null)).toBe(true);
    expect(anythingPushed([view(1, { desired: null })], plan(['up_to_date']))).toBe(true);
    expect(anythingPushed(null, plan(['changes']))).toBe(true);
  });

  it('is false when what is known shows no push', () => {
    expect(anythingPushed([], null)).toBe(false);
    expect(anythingPushed([view(1, { desired: null })], null)).toBe(false);
    expect(anythingPushed(null, plan(['never_pushed', 'nothing_assigned']))).toBe(false);
    expect(anythingPushed([], plan([]))).toBe(false);
  });
});

describe('setupProgress', () => {
  const empty: SetupInput = {
    screens: 0,
    paired: 0,
    media: 0,
    playlists: 0,
    pushed: false,
    pending: 0,
  };

  it('starts with four steps to do', () => {
    const progress = setupProgress(empty);
    expect(progress.steps.map((step) => step.id)).toEqual(['screen', 'pair', 'media', 'push']);
    expect(progress.steps.every((step) => !step.done)).toBe(true);
    expect(progress).toMatchObject({
      doneCount: 0,
      total: 4,
      complete: false,
      summary: '0 of 4 steps done',
    });
  });

  it('links each open step to the place to do it', () => {
    const steps = setupProgress(empty).steps;
    expect(steps[0]?.action).toEqual({ kind: 'link', label: 'Add screen', to: '/screens/new' });
    // A player cannot be paired before there is a screen.
    expect(steps[1]?.action).toBeNull();
    expect(steps[1]?.text).toContain('Add a screen first');
    expect(steps[2]?.action).toEqual({ kind: 'link', label: 'Add media', to: '/media' });
    expect(steps[3]?.action).toEqual({
      kind: 'link',
      label: 'Create a playlist',
      to: '/playlists',
    });
  });

  it('sends pairing to the screens without a player once there is a screen', () => {
    const steps = setupProgress({ ...empty, screens: 2 }).steps;
    expect(steps[0]).toMatchObject({ done: true, action: null });
    expect(steps[1]?.action).toEqual({
      kind: 'link',
      label: 'Choose a screen to pair',
      to: '/screens?status=unpaired',
    });
  });

  it('offers the push dialog when changes are waiting, and the playlists otherwise', () => {
    const waiting = setupProgress({ ...empty, screens: 1, media: 1, playlists: 1, pending: 1 });
    expect(waiting.steps[3]?.action).toEqual({ kind: 'push', label: 'Review and push' });
    const none = setupProgress({ ...empty, screens: 1, media: 1, playlists: 1, pending: 0 });
    expect(none.steps[3]?.action).toEqual({
      kind: 'link',
      label: 'Open playlists',
      to: '/playlists',
    });
    const unknown = setupProgress({ ...empty, playlists: 2, pending: null });
    expect(unknown.steps[3]?.action).toMatchObject({ kind: 'link', to: '/playlists' });
  });

  it('counts the steps that are done from the numbers alone', () => {
    const progress = setupProgress({
      screens: 3,
      paired: 0,
      media: 5,
      playlists: 1,
      pushed: false,
      pending: 0,
    });
    expect(progress.steps.map((step) => step.done)).toEqual([true, false, true, false]);
    expect(progress.summary).toBe('2 of 4 steps done');
    expect(progress.complete).toBe(false);
  });

  it('is complete when all four are done, and done steps have no action', () => {
    const progress = setupProgress({
      screens: 1,
      paired: 1,
      media: 1,
      playlists: 1,
      pushed: true,
      pending: 0,
    });
    expect(progress.complete).toBe(true);
    expect(progress.doneCount).toBe(4);
    expect(progress.steps.every((step) => step.action === null)).toBe(true);
  });

  it('never says online, offline or display, and never links to an M0 address', () => {
    for (const input of [empty, { ...empty, screens: 1 }, { ...empty, screens: 1, pending: 2 }]) {
      for (const step of setupProgress(input).steps) {
        const label = step.action?.label ?? '';
        expect(`${step.title} ${step.text} ${step.doneText} ${label}`.toLowerCase()).not.toMatch(
          /online|offline|display/,
        );
        if (step.action?.kind === 'link') expect(step.action.to).not.toContain('display');
      }
    }
  });
});

describe('isEmptyOrganisation', () => {
  it('is true only when there is no screen, no media and no playlist', () => {
    expect(isEmptyOrganisation(overview())).toBe(true);
    expect(isEmptyOrganisation(overview({ playlists: { total: 1 } }))).toBe(false);
    expect(
      isEmptyOrganisation(
        overview({ displays: { total: 1, paired: 0, bySummary: bySummary({ unpaired: 1 }) } }),
      ),
    ).toBe(false);
    expect(
      isEmptyOrganisation(
        overview({
          media: { total: 1, ready: 0, processing: 1, failed: 0, usedBytes: 10, limitBytes: 1024 },
        }),
      ),
    ).toBe(false);
  });
});

describe('pushOverview', () => {
  it('counts the screens with changes waiting, never pushed included', () => {
    const result = pushOverview(plan(['changes', 'never_pushed', 'up_to_date', 'blocked']));
    expect(result).toMatchObject({
      state: 'changes',
      pending: 2,
      blocked: 1,
      headline: 'screens have changes waiting',
      moreWaiting: 0,
    });
    expect(result.waiting.map((item) => item.display.name)).toEqual(['Screen 1', 'Screen 2']);
    expect(result.blockedText).toBe(
      '1 screen is blocked: the assigned content cannot be pushed as it is.',
    );
  });

  it('agrees with the pending count of the plan for every mix of states', () => {
    const mixes: PushState[][] = [[], [...PUSH_STATES], ['changes', 'changes'], ['blocked']];
    for (const states of mixes) {
      const source = plan(states);
      expect(pushOverview(source).pending).toBe(source.pendingCount);
    }
  });

  it('uses the singular for one screen', () => {
    expect(pushOverview(plan(['never_pushed'])).headline).toBe('screen has changes waiting');
  });

  it('lists the first waiting screens and counts the rest', () => {
    const result = pushOverview(plan(['changes', 'changes', 'up_to_date', 'changes', 'changes']));
    expect(result.waiting.map((item) => item.display.name)).toEqual([
      'Screen 1',
      'Screen 2',
      'Screen 4',
    ]);
    expect(result.moreWaiting).toBe(1);
    expect(pushOverview(plan(['changes', 'changes']), 1).moreWaiting).toBe(1);
  });

  it('says everything is up to date only when nothing waits and nothing is blocked', () => {
    expect(pushOverview(plan(['up_to_date', 'nothing_assigned']))).toMatchObject({
      state: 'up_to_date',
      headline: 'Everything is up to date',
      text: 'Every screen with content assigned has been given its latest version.',
      blockedText: null,
    });
    const blocked = pushOverview(plan(['up_to_date', 'blocked', 'blocked']));
    expect(blocked.state).toBe('blocked_only');
    expect(blocked.headline).not.toContain('up to date');
    expect(blocked.blockedText).toContain('2 screens are blocked');
  });

  it('tells an organisation without screens or assignments what to do first', () => {
    expect(pushOverview(plan([]))).toMatchObject({
      state: 'no_screens',
      headline: 'Nothing to push yet',
      text: 'Add a screen and assign a playlist or a schedule to it. Its changes then wait here until you push.',
    });
    const unassigned = pushOverview(plan(['nothing_assigned', 'nothing_assigned']));
    expect(unassigned.state).toBe('nothing_assigned');
    expect(unassigned.text).toBe(
      'Assign a playlist or a schedule to a screen. Its changes then wait here until you push.',
    );
  });

  it('never says online, offline or display', () => {
    const mixes: PushState[][] = [
      [],
      ['changes'],
      ['blocked'],
      ['up_to_date'],
      ['nothing_assigned'],
    ];
    for (const states of mixes) {
      const result = pushOverview(plan(states));
      expect(
        `${result.headline} ${result.text} ${result.blockedText ?? ''}`.toLowerCase(),
      ).not.toMatch(/online|offline|display/);
    }
  });
});

describe('mediaStatusNotes', () => {
  it('mentions only what is processing or failed', () => {
    const media = overview().media;
    expect(mediaStatusNotes({ ...media, total: 5, ready: 5 })).toEqual([]);
    expect(mediaStatusNotes({ ...media, total: 6, ready: 1, processing: 2, failed: 3 })).toEqual([
      { status: 'processing', tone: 'warn', label: '2 processing' },
      { status: 'failed', tone: 'danger', label: '3 failed' },
    ]);
  });
});

describe('readPlanOnArrival', () => {
  it('leaves the first read to the provider while it has neither a plan nor a failure', () => {
    expect(readPlanOnArrival(null, null)).toBe(false);
    expect(readPlanOnArrival(null, undefined)).toBe(false);
  });

  it('asks for a fresh plan once one is known, or once a read failed', () => {
    expect(readPlanOnArrival(plan(['changes']), null)).toBe(true);
    expect(readPlanOnArrival(null, new Error('offline'))).toBe(true);
    expect(readPlanOnArrival(plan([]), new Error('offline'))).toBe(true);
  });
});
