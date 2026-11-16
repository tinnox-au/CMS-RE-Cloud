import {
  DELIVERY_SUMMARIES,
  PUSH_STATES,
  type DeliveryStatusView,
  type DisplayDto,
  type PushPlanResponse,
  type PushPlanRow,
  type PushState,
  type SiteDto,
} from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { applyListView } from './listView.ts';
import { pruneSelection, selectedRows } from './selection.ts';
import { SCREEN_STATUS_KINDS } from './screenStatus.ts';
import { CANVAS_PRESETS } from './screenWizard.ts';
import {
  assignedDetail,
  assignedDoneText,
  assignedMessage,
  buildScreenRows,
  canvasLabel,
  commonPlaylistId,
  contentInset,
  countByStatusFilter,
  formatStatusFilter,
  frameShape,
  hasUnlistedScreen,
  matchesStatusFilter,
  MIN_FRAME_SHARE,
  parseListView,
  parseStatusFilter,
  pushMarkerFor,
  SCREEN_SORT_ACCESSORS,
  SCREEN_STATUS_FILTER_HINTS,
  SCREEN_STATUS_FILTER_LABELS,
  SCREEN_STATUS_FILTERS,
  screenSearchTexts,
  screensLabel,
  screensToAssign,
  showsPushMarker,
  statusFilterOf,
  toggleStatusFilter,
  UNKNOWN_SITE_LABEL,
  WHOLE_CANVAS,
} from './screensList.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SITE = ID(900);
const T = '2026-11-14T03:00:00.000Z';
const MELBOURNE: SiteDto = { id: SITE, name: 'Melbourne', timezone: 'Australia/Melbourne' };

function display(n: number, change: Partial<DisplayDto> = {}): DisplayDto {
  return {
    id: ID(n),
    siteId: SITE,
    name: `Screen ${String(n)}`,
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
    createdAt: T,
    updatedAt: T,
    ...change,
  };
}

function view(displayId: string, change: Partial<DeliveryStatusView> = {}): DeliveryStatusView {
  return {
    displayId,
    paired: true,
    registrationId: ID(800),
    desired: null,
    downloaded: null,
    active: null,
    playerState: null,
    staging: null,
    lastHeartbeatAt: '2026-11-14T03:09:50.000Z',
    stale: false,
    staleAfterSeconds: 60,
    errors: [],
    summary: 'in_sync',
    asOf: '2026-11-14T03:10:00.000Z',
    ...change,
  };
}

function planRow(displayId: string, state: PushState, playlistId: string | null): PushPlanRow {
  return {
    display: { id: displayId, name: 'x' },
    playlist: playlistId === null ? null : { id: playlistId, name: 'Loop' },
    state,
    issues: [],
    lastPushedAt: null,
  };
}

const PLAYLIST = { id: ID(500), name: 'Reception loop' };
const OTHER = { id: ID(501), name: 'Foyer loop' };

describe('buildScreenRows', () => {
  const displays = [
    display(1, {
      assignedPlaylist: PLAYLIST,
      player: { registrationId: ID(800), registeredAt: T },
    }),
    display(2, { siteId: ID(901) }),
    display(3),
  ];

  it('joins sites, statuses and the push plan by id, in the order of the list', () => {
    const plan: PushPlanResponse = {
      items: [planRow(ID(1).toUpperCase(), 'changes', PLAYLIST.id)],
      pendingCount: 1,
    };
    const rows = buildScreenRows({
      displays,
      sites: [MELBOURNE],
      statuses: [view(ID(1), { summary: 'error' }), view(ID(2), { stale: true })],
      plan,
    });
    expect(rows.map((row) => row.display.id)).toEqual([ID(1), ID(2), ID(3)]);
    expect(rows.map((row) => row.siteName)).toEqual(['Melbourne', UNKNOWN_SITE_LABEL, 'Melbourne']);
    expect(rows.map((row) => row.statusKind)).toEqual(['error', 'not_reporting', null]);
    expect(rows[0]?.push?.state).toBe('changes');
    expect(rows[1]?.push).toBeNull();
  });

  it('leaves what is not known as null and never guesses', () => {
    const rows = buildScreenRows({ displays, sites: null, statuses: null, plan: null });
    for (const row of rows) {
      expect(row.siteName).toBeNull();
      expect(row.view).toBeNull();
      expect(row.statusKind).toBeNull();
      expect(row.push).toBeNull();
    }
  });

  it('counts a screen as paired by the list or by the latest status', () => {
    const rows = buildScreenRows({
      displays,
      sites: null,
      statuses: [view(ID(2), { paired: true }), view(ID(3), { paired: false })],
      plan: null,
    });
    expect(rows.map((row) => row.paired)).toEqual([true, true, false]);
  });
});

describe('hasUnlistedScreen', () => {
  it('is true only when a status names a screen the list does not hold', () => {
    const displays = [display(1), display(2)];
    expect(hasUnlistedScreen(displays, [view(ID(1)), view(ID(2).toUpperCase())])).toBe(false);
    expect(hasUnlistedScreen(displays, [view(ID(1))])).toBe(false);
    expect(hasUnlistedScreen(displays, [view(ID(3))])).toBe(true);
  });
});

describe('canvasLabel and search', () => {
  it('writes the canvas with the multiplication sign', () => {
    expect(canvasLabel(display(1))).toBe('1920 × 1080 px');
    expect(canvasLabel(display(1, { canvas: { width: 3840, height: 480 } }))).toBe('3840 × 480 px');
  });

  it('searches the name, description, site, playlist and canvas', () => {
    const [row] = buildScreenRows({
      displays: [display(1, { description: 'Near the lifts', assignedPlaylist: PLAYLIST })],
      sites: [MELBOURNE],
      statuses: null,
      plan: null,
    });
    if (row === undefined) throw new Error('no row');
    const texts = screenSearchTexts(row);
    expect(texts).toContain('Screen 1');
    expect(texts).toContain('Near the lifts');
    expect(texts).toContain('Melbourne');
    expect(texts).toContain('Reception loop');
    expect(texts).toContain('1920 × 1080 px');
    expect(texts).toContain('1920x1080');
  });
});

describe('the selection under a filter', () => {
  it('drops ticked screens that the search hides, so bulk actions only reach listed screens', () => {
    // As ScreensList does: the selection is pruned to the matched rows of every page.
    const rows = buildScreenRows({
      displays: [display(1), display(2), display(3)],
      sites: [MELBOURNE],
      statuses: null,
      plan: null,
    });
    const id = (row: (typeof rows)[number]) => row.display.id;
    const ticked = new Set([ID(1), ID(3)]);
    const list = applyListView(rows, {
      search: { query: 'Screen 3', texts: screenSearchTexts },
      filters: [],
      sort: { columnId: 'name', direction: 'asc' },
      accessors: SCREEN_SORT_ACCESSORS,
      page: 1,
      pageSize: 1,
    });
    const selected = pruneSelection(ticked, list.matched.map(id));
    expect([...selected]).toEqual([ID(3)]);
    expect(selectedRows(list.matched, selected, id).map((row) => row.display.name)).toEqual([
      'Screen 3',
    ]);
  });
});

describe('the status filter', () => {
  it('reads the values the dashboard links with, and ignores anything else', () => {
    expect([...parseStatusFilter(null)]).toEqual([]);
    expect([...parseStatusFilter('attention')]).toEqual(['attention']);
    expect([...parseStatusFilter(' In_Sync ,unpaired,bogus,,updating')]).toEqual([
      'in_sync',
      'unpaired',
      'updating',
    ]);
  });

  it('writes the selection in chip order, or nothing', () => {
    expect(formatStatusFilter(new Set())).toBeNull();
    expect(formatStatusFilter(new Set(['unpaired', 'in_sync'] as const))).toBe('in_sync,unpaired');
    const round = formatStatusFilter(parseStatusFilter('updating,attention'));
    expect(round).toBe('updating,attention');
  });

  it('toggles one value without changing the original', () => {
    const start = new Set(['in_sync'] as const);
    const on = toggleStatusFilter(start, 'attention', true);
    expect([...on].sort()).toEqual(['attention', 'in_sync']);
    expect([...start]).toEqual(['in_sync']);
    expect([...toggleStatusFilter(on, 'in_sync', false)]).toEqual(['attention']);
  });

  it('puts every status in exactly one chip', () => {
    expect(SCREEN_STATUS_KINDS.map((kind) => [kind, statusFilterOf(kind)])).toEqual([
      ['in_sync', 'in_sync'],
      ['standing_by', 'in_sync'],
      ['updating', 'updating'],
      ['not_reporting', 'attention'],
      ['error', 'attention'],
      ['waiting_for_player', 'updating'],
      ['nothing_pushed', 'updating'],
      ['not_paired', 'unpaired'],
    ]);
  });

  it('lets a screen of unknown status through only when no status is filtered', () => {
    expect(matchesStatusFilter(null, new Set())).toBe(true);
    expect(matchesStatusFilter(null, new Set(['in_sync'] as const))).toBe(false);
    expect(matchesStatusFilter('error', new Set(['attention'] as const))).toBe(true);
    expect(matchesStatusFilter('error', new Set(['in_sync', 'updating'] as const))).toBe(false);
  });

  it('counts the screens of each chip, leaving out unknown statuses', () => {
    const rows = buildScreenRows({
      displays: [display(1), display(2), display(3), display(4), display(5)],
      sites: null,
      statuses: [
        view(ID(1)),
        view(ID(2), { stale: true }),
        view(ID(3), { summary: 'unpaired', paired: false }),
        view(ID(4), { summary: 'updating' }),
      ],
      plan: null,
    });
    expect(countByStatusFilter(rows)).toEqual({
      in_sync: 1,
      updating: 1,
      attention: 1,
      unpaired: 1,
    });
  });

  it('never words a chip with the banned words', () => {
    const words = [
      ...Object.values(SCREEN_STATUS_FILTER_LABELS),
      ...Object.values(SCREEN_STATUS_FILTER_HINTS),
    ].join(' ');
    expect(words).not.toMatch(/online|offline|display/i);
    expect(SCREEN_STATUS_FILTERS).toEqual(['in_sync', 'updating', 'attention', 'unpaired']);
  });

  it('an in-sync summary that arrives stale is not counted as in sync', () => {
    for (const summary of DELIVERY_SUMMARIES) {
      const [row] = buildScreenRows({
        displays: [display(1)],
        sites: null,
        statuses: [view(ID(1), { summary, stale: true })],
        plan: null,
      });
      expect(row?.statusKind).not.toBe('in_sync');
    }
  });
});

describe('parseListView', () => {
  it('is the list unless the address asks for the grid', () => {
    expect(parseListView(null)).toBe('list');
    expect(parseListView('grid')).toBe('grid');
    expect(parseListView('tiles')).toBe('list');
  });
});

describe('sorting', () => {
  it('sorts the Status column with what needs a person first, unknown last', () => {
    const rows = buildScreenRows({
      displays: [display(1), display(2), display(3), display(4)],
      sites: null,
      statuses: [
        view(ID(1)),
        view(ID(2), { summary: 'error' }),
        view(ID(3), { summary: 'unpaired', paired: false }),
      ],
      plan: null,
    });
    const sorted = applyListView(rows, {
      sort: { columnId: 'status', direction: 'asc' },
      accessors: SCREEN_SORT_ACCESSORS,
      page: 1,
      pageSize: 10,
    });
    expect(sorted.rows.map((row) => row.display.id)).toEqual([ID(2), ID(1), ID(3), ID(4)]);
  });

  it('sorts the Canvas column by area', () => {
    const rows = buildScreenRows({
      displays: [
        display(1, { canvas: { width: 3840, height: 480 } }),
        display(2, { canvas: { width: 640, height: 360 } }),
      ],
      sites: null,
      statuses: null,
      plan: null,
    });
    const sorted = applyListView(rows, {
      sort: { columnId: 'canvas', direction: 'asc' },
      accessors: SCREEN_SORT_ACCESSORS,
      page: 1,
      pageSize: 10,
    });
    expect(sorted.rows.map((row) => row.display.id)).toEqual([ID(2), ID(1)]);
  });
});

describe('the push marker', () => {
  it('marks only states where something is waiting or blocked', () => {
    expect(PUSH_STATES.filter(showsPushMarker)).toEqual(
      expect.arrayContaining(['changes', 'never_pushed', 'blocked']),
    );
    expect(showsPushMarker('up_to_date')).toBe(false);
    expect(showsPushMarker('nothing_assigned')).toBe(false);
  });

  it('marks the assigned playlist when the plan is about it', () => {
    const assigned = display(1, { assignedPlaylist: PLAYLIST });
    expect(pushMarkerFor({ display: assigned, push: planRow(ID(1), 'changes', PLAYLIST.id) })).toBe(
      'changes',
    );
    expect(
      pushMarkerFor({
        display: assigned,
        push: planRow(ID(1), 'blocked', PLAYLIST.id.toUpperCase()),
      }),
    ).toBe('blocked');
    expect(
      pushMarkerFor({ display: assigned, push: planRow(ID(1), 'up_to_date', PLAYLIST.id) }),
    ).toBeNull();
  });

  it('shows no marker rather than a wrong one', () => {
    const assigned = display(1, { assignedPlaylist: PLAYLIST });
    expect(pushMarkerFor({ display: assigned, push: null })).toBeNull();
    expect(
      pushMarkerFor({ display: assigned, push: planRow(ID(1), 'changes', OTHER.id) }),
    ).toBeNull();
    expect(
      pushMarkerFor({ display: display(1), push: planRow(ID(1), 'changes', PLAYLIST.id) }),
    ).toBeNull();
  });
});

describe('frameShape', () => {
  it('fills the stage along its longer side', () => {
    expect(frameShape(1920, 1080)).toEqual({
      ratio: 16 / 9,
      widthPercent: 100,
      heightPercent: 100,
      clamped: false,
    });
    const portrait = frameShape(1080, 1920);
    expect(portrait.heightPercent).toBe(100);
    expect(portrait.widthPercent).toBeCloseTo(31.64, 1);
    const square = frameShape(500, 500, 1);
    expect([square.widthPercent, square.heightPercent]).toEqual([100, 100]);
  });

  it('draws every canvas preset of the wizard at its true shape in a grid tile', () => {
    for (const preset of CANVAS_PRESETS) {
      const shape = frameShape(preset.width, preset.height);
      expect(shape.clamped, preset.name).toBe(false);
      expect(shape.ratio, preset.name).toBeCloseTo(preset.width / preset.height, 10);
    }
    const strip = frameShape(3840, 480);
    expect(strip.widthPercent).toBe(100);
    expect(strip.heightPercent).toBeCloseTo(22.22, 1);
  });

  it('clamps a very long or very tall canvas and says so', () => {
    const strip = frameShape(16000, 480);
    expect(strip.ratio).toBeCloseTo(16 / 9 / MIN_FRAME_SHARE, 10);
    expect(strip.clamped).toBe(true);
    expect(strip.widthPercent).toBe(100);
    expect(strip.heightPercent).toBe(MIN_FRAME_SHARE * 100);
    const tower = frameShape(200, 2000);
    expect(tower.ratio).toBeCloseTo((16 / 9) * MIN_FRAME_SHARE, 10);
    expect(tower.clamped).toBe(true);
    expect(tower.heightPercent).toBe(100);
    expect(tower.widthPercent).toBe(MIN_FRAME_SHARE * 100);
    // In the square lead of a list row the wide strip is drawn at 5:1.
    const lead = frameShape(3840, 480, 1);
    expect(lead.ratio).toBe(5);
    expect(lead.clamped).toBe(true);
    expect(lead.heightPercent).toBe(20);
  });

  it('falls back to the stage shape for sizes that are not positive numbers', () => {
    for (const [w, h] of [
      [0, 100],
      [100, -1],
      [Number.NaN, 100],
      [100, Number.POSITIVE_INFINITY],
    ] as const) {
      const shape = frameShape(w, h);
      expect(shape.widthPercent).toBe(100);
      expect(shape.heightPercent).toBe(100);
    }
  });
});

describe('contentInset', () => {
  it('leaves the whole canvas to WHOLE_CANVAS, which covers all of it', () => {
    expect(contentInset(display(1))).toBeNull();
    expect(WHOLE_CANVAS).toEqual({
      leftPercent: 0,
      topPercent: 0,
      widthPercent: 100,
      heightPercent: 100,
    });
  });

  it('is null without a rectangle or for one that covers the canvas', () => {
    expect(contentInset(display(1))).toBeNull();
    expect(
      contentInset(display(1, { contentRect: { x: 0, y: 0, width: 1920, height: 1080 } })),
    ).toBeNull();
  });

  it('places the rectangle as percentages of the canvas, kept inside it', () => {
    expect(
      contentInset(
        display(1, {
          canvas: { width: 768, height: 448 },
          contentRect: { x: 64, y: 32, width: 640, height: 384 },
        }),
      ),
    ).toEqual({ leftPercent: 8.33, topPercent: 7.14, widthPercent: 83.33, heightPercent: 85.71 });
    const overflowing = contentInset(
      display(1, {
        canvas: { width: 100, height: 100 },
        contentRect: { x: 50, y: 50, width: 100, height: 100 },
      }),
    );
    expect(overflowing).toEqual({
      leftPercent: 50,
      topPercent: 50,
      widthPercent: 50,
      heightPercent: 50,
    });
  });
});

describe('assigning content', () => {
  const a = display(1, { assignedPlaylist: PLAYLIST });
  const b = display(2, { assignedPlaylist: { ...PLAYLIST, id: PLAYLIST.id.toUpperCase() } });
  const c = display(3);
  const d = display(4, { assignedPlaylist: OTHER });

  it('changes only the screens that do not have the choice already', () => {
    expect(screensToAssign([a, b, c, d], PLAYLIST.id).map((x) => x.id)).toEqual([ID(3), ID(4)]);
    expect(screensToAssign([a, c], null).map((x) => x.id)).toEqual([ID(1)]);
    expect(screensToAssign([c], null)).toEqual([]);
  });

  it('starts on the playlist every screen shares', () => {
    expect(commonPlaylistId([a, b])).toBe(PLAYLIST.id);
    expect(commonPlaylistId([a, d])).toBeNull();
    expect(commonPlaylistId([a, c])).toBeNull();
    expect(commonPlaylistId([c])).toBeNull();
    expect(commonPlaylistId([])).toBeNull();
  });

  it('words the outcome', () => {
    expect(assignedMessage([a], 'Reception loop')).toBe('Reception loop assigned to Screen 1');
    expect(assignedMessage([a, c], 'Reception loop')).toBe('Reception loop assigned to 2 screens');
    expect(assignedMessage([a], null)).toBe('Playlist unassigned from Screen 1');
    expect(assignedMessage(3, null)).toBe('Playlist unassigned from 3 screens');
    expect(assignedMessage(1, 'Reception loop')).toBe('Reception loop assigned to 1 screen');
    expect(assignedDetail('Reception loop', 1)).toBe(
      'Nothing changes on the screen until you push.',
    );
    expect(assignedDetail('Reception loop', 3)).toBe('Nothing changes on a screen until you push.');
    expect(assignedDetail(null, 1)).toBe('The screen keeps what it was last given.');
    expect(screensLabel(1)).toBe('1 screen');
  });

  it('never says a playlist was removed from a screen: the screen keeps what it was given', () => {
    for (const text of [
      assignedMessage([a], null),
      assignedMessage(2, null),
      assignedDoneText(null, 1),
      assignedDoneText(null, 4),
    ]) {
      expect(text).not.toMatch(/removed/i);
    }
    expect(assignedDoneText(null, 2)).toBe(
      'The playlist was unassigned from 2 screens. Each screen keeps what it was last given.',
    );
    expect(assignedDoneText('Reception loop', 1)).toBe(
      'Reception loop was assigned to 1 screen. Nothing changes on the screen until you push.',
    );
    expect(assignedDoneText(null, 0)).toBe('No screen was changed.');
    expect(screensLabel(4)).toBe('4 screens');
  });
});
