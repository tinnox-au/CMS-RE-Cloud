/**
 * The dashboard's own logic (docs/portal-v2/stage-a.md, 3.1). Pure functions, no DOM: the
 * four screen counters and their links, the screens that need attention, the "Get set up"
 * steps, and the words of the "Changes waiting" card. Everything is derived from what the
 * API answered; nothing here invents a number.
 *
 * In code the object is a `display`, as in the API and the contracts; every string an
 * operator sees says "screen" (P2-03). Status wording follows P2-04: the portal reports what
 * the player software last said and has no word for a screen being reachable.
 */
import {
  DELIVERY_SUMMARIES,
  isPushPending,
  type DeliveryStatusView,
  type DeliverySummary,
  type DisplayDto,
  type OverviewResponse,
  type PushPlanResponse,
  type PushPlanRow,
} from '@tinnox/contracts';
import {
  screenStatus,
  screenStatusGroup,
  screenStatusKindOf,
  type ScreenStatusGroup,
  type ScreenStatusKind,
  type ScreenStatusTone,
} from './screenStatus.ts';
import { SCREEN_STATUS_FILTERS, type ScreenStatusFilter } from './screensList.ts';

// ---------------------------------------------------------------------------
// Push plan on arrival

/**
 * Whether the dashboard asks for the push plan when it opens. The plan's provider reads it
 * when the application starts, so while it has neither a plan nor a failure its first read is
 * still under way (or about to start: a page's effects run before its provider's), and asking
 * again would only cancel that read and make the server assess the plan twice. Once a plan
 * or a failure is known, the dashboard asks for a fresh one: the last may be 30 s old.
 */
export function readPlanOnArrival(plan: PushPlanResponse | null, planError: unknown): boolean {
  return plan !== null || (planError !== null && planError !== undefined);
}

// ---------------------------------------------------------------------------
// Numbers

const countFormat = new Intl.NumberFormat('en-AU');

/** 12345 -> "12,345". */
export function formatCount(count: number): string {
  return countFormat.format(count);
}

/** "1 screen", "12 screens", "1,204 screens". */
export function pluralCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

// ---------------------------------------------------------------------------
// Screen counters

/**
 * The values of `?status=` that the screens list understands. Taken from the list's own
 * definition, so a counter can never link to a filter the list does not know.
 */
export const SCREENS_STATUS_PARAMS: readonly ScreenStatusFilter[] = SCREEN_STATUS_FILTERS;
export type ScreensStatusParam = ScreenStatusFilter;

/** The screens list, optionally filtered by status: `/screens?status=attention`. */
export function screensPath(status?: ScreensStatusParam): string {
  return status === undefined ? '/screens' : `/screens?status=${status}`;
}

export interface ScreenCounter {
  readonly group: ScreenStatusGroup;
  /** The value of `?status=` on the screens list. */
  readonly status: ScreensStatusParam;
  readonly label: string;
  /** Which statuses the number counts, in the approved status words. */
  readonly hint: string;
  readonly tone: ScreenStatusTone;
  readonly count: number;
  /** The screens list filtered to these screens. */
  readonly href: string;
}

interface CounterText {
  readonly status: ScreensStatusParam;
  readonly label: string;
  readonly hint: string;
  readonly tone: ScreenStatusTone;
}

const COUNTER_ORDER: readonly ScreenStatusGroup[] = [
  'in_sync',
  'pending',
  'attention',
  'not_paired',
];

const COUNTER_TEXT: { readonly [K in ScreenStatusGroup]: CounterText } = {
  in_sync: {
    status: 'in_sync',
    label: 'In sync',
    hint: 'In sync or standing by, as the player last reported',
    tone: 'ok',
  },
  pending: {
    status: 'updating',
    label: 'Updating or waiting',
    hint: 'Updating, waiting for player or nothing pushed',
    tone: 'warn',
  },
  attention: {
    status: 'attention',
    label: 'Needs attention',
    hint: 'Error or not reporting',
    tone: 'danger',
  },
  not_paired: {
    status: 'unpaired',
    label: 'Not paired',
    hint: 'No player paired yet',
    tone: 'neutral',
  },
};

/**
 * The four counters of the Screens card, from `displays.bySummary` of `GET /api/overview`.
 * Every delivery summary falls into exactly one counter, so the four add up to the number
 * of screens.
 */
export function screenCounters(
  bySummary: OverviewResponse['displays']['bySummary'],
): readonly ScreenCounter[] {
  const counts: Record<ScreenStatusGroup, number> = {
    in_sync: 0,
    pending: 0,
    attention: 0,
    not_paired: 0,
  };
  for (const summary of DELIVERY_SUMMARIES) {
    counts[groupOfSummary(summary)] += bySummary[summary];
  }
  return COUNTER_ORDER.map((group) => {
    const text = COUNTER_TEXT[group];
    return { group, ...text, count: counts[group], href: screensPath(text.status) };
  });
}

function groupOfSummary(summary: DeliverySummary): ScreenStatusGroup {
  return screenStatusGroup(screenStatusKindOf(summary));
}

// ---------------------------------------------------------------------------
// Screens that need attention

export interface AttentionRow {
  readonly display: DisplayDto;
  readonly view: DeliveryStatusView;
  readonly kind: ScreenStatusKind;
}

export interface AttentionList {
  /** The first screens, errors before screens that stopped reporting, then by name. */
  readonly rows: readonly AttentionRow[];
  /** How many screens need attention in all. */
  readonly total: number;
}

const nameOrder = new Intl.Collator('en-AU', { numeric: true, sensitivity: 'base' });

/**
 * The screens whose player reports an error or has stopped reporting. The kind is taken from
 * `screenStatus`, exactly as the status pill decides it, so the list and the pills agree.
 * A status without a screen in the list (it was added a moment ago) is left out.
 */
export function screensNeedingAttention(
  displays: readonly DisplayDto[],
  statuses: readonly DeliveryStatusView[],
  limit = 5,
): AttentionList {
  const byId = new Map(displays.map((display) => [display.id.toLowerCase(), display]));
  const rows: AttentionRow[] = [];
  for (const view of statuses) {
    const display = byId.get(view.displayId.toLowerCase());
    if (display === undefined) continue;
    const kind = screenStatus(view, 0).kind;
    if (screenStatusGroup(kind) === 'attention') rows.push({ display, view, kind });
  }
  rows.sort(
    (a, b) =>
      Number(b.kind === 'error') - Number(a.kind === 'error') ||
      nameOrder.compare(a.display.name, b.display.name) ||
      a.display.id.localeCompare(b.display.id),
  );
  return { rows: rows.slice(0, Math.max(0, limit)), total: rows.length };
}

// ---------------------------------------------------------------------------
// Get set up

/**
 * Whether anything has ever been pushed to a screen: a status with a desired publication, or
 * a row of the push plan with a push time. `null` while neither source has answered.
 */
export function anythingPushed(
  statuses: readonly DeliveryStatusView[] | null,
  plan: PushPlanResponse | null,
): boolean | null {
  if (statuses?.some((view) => view.desired !== null) === true) return true;
  if (plan?.items.some((row) => row.lastPushedAt !== null) === true) return true;
  return statuses === null && plan === null ? null : false;
}

export const SETUP_STEP_IDS = ['screen', 'pair', 'media', 'push'] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

/** Where a step is done: a page, or the push dialog. */
export type SetupAction =
  | { readonly kind: 'link'; readonly label: string; readonly to: string }
  | { readonly kind: 'push'; readonly label: string };

export interface SetupStep {
  readonly id: SetupStepId;
  readonly title: string;
  /** One sentence: what to do, or what has to come first. */
  readonly text: string;
  /** One sentence for the step once it is done. */
  readonly doneText: string;
  readonly done: boolean;
  /** Null when the step is done, or when an earlier step has to come first. */
  readonly action: SetupAction | null;
}

export interface SetupInput {
  /** `displays.total` of the overview. */
  readonly screens: number;
  /** `displays.paired` of the overview. */
  readonly paired: number;
  /** `media.total` of the overview. */
  readonly media: number;
  /** `playlists.total` of the overview. */
  readonly playlists: number;
  /** From `anythingPushed`. */
  readonly pushed: boolean;
  /** Screens with changes waiting, or null while the push plan is not known. */
  readonly pending: number | null;
}

export interface SetupProgress {
  readonly steps: readonly SetupStep[];
  readonly doneCount: number;
  readonly total: number;
  /** All four steps are done: the card is no longer shown. */
  readonly complete: boolean;
  /** "2 of 4 steps done". */
  readonly summary: string;
}

/**
 * What the member's role allows, for the step actions: `screen.setup`, `screen.pair`,
 * `content.write` and `push.publish`. A step whose key is missing offers no action.
 */
export interface SetupAllowed {
  readonly setup: boolean;
  readonly pair: boolean;
  readonly write: boolean;
  readonly push: boolean;
}

const ALL_ALLOWED: SetupAllowed = { setup: true, pair: true, write: true, push: true };

/** The four steps from an empty organisation to content on a screen, from real numbers only. */
export function setupProgress(input: SetupInput, can: SetupAllowed = ALL_ALLOWED): SetupProgress {
  const hasScreen = input.screens > 0;
  const hasPlayer = input.paired > 0;
  const hasMedia = input.media > 0;

  const pushAction = (): SetupAction | null => {
    if (!can.push) return null;
    if (input.pending !== null && input.pending > 0) {
      return { kind: 'push', label: 'Review and push' };
    }
    if (!can.write) return null;
    if (input.playlists === 0)
      return { kind: 'link', label: 'Create a playlist', to: '/playlists' };
    return { kind: 'link', label: 'Open playlists', to: '/playlists' };
  };

  const steps: readonly SetupStep[] = [
    {
      id: 'screen',
      title: 'Add a screen',
      text: 'Give the screen a name, a site and its canvas size in pixels.',
      doneText: 'A screen is set up.',
      done: hasScreen,
      action:
        hasScreen || !can.setup ? null : { kind: 'link', label: 'Add screen', to: '/screens/new' },
    },
    {
      id: 'pair',
      title: 'Pair its player',
      text: hasScreen
        ? 'Open the player on the screen’s device and enter the code it shows.'
        : 'Add a screen first. Its player then shows a code to enter here.',
      doneText: 'A player is paired with a screen.',
      done: hasPlayer,
      action:
        hasPlayer || !hasScreen || !can.pair
          ? null
          : { kind: 'link', label: 'Choose a screen to pair', to: screensPath('unpaired') },
    },
    {
      id: 'media',
      title: 'Upload media',
      text: 'Add the images and videos you want to show.',
      doneText: 'There is media in the library.',
      done: hasMedia,
      action: hasMedia || !can.write ? null : { kind: 'link', label: 'Add media', to: '/media' },
    },
    {
      id: 'push',
      title: 'Push a playlist',
      text: can.push
        ? 'Put media in a playlist, assign it to a screen, then push.'
        : 'An editor or admin pushes.',
      doneText: 'A playlist has been pushed to a screen.',
      done: input.pushed,
      action: input.pushed ? null : pushAction(),
    },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  return {
    steps,
    doneCount,
    total: steps.length,
    complete: doneCount === steps.length,
    summary: `${doneCount} of ${steps.length} steps done`,
  };
}

/** Nothing has been made yet: no screen, no media, no playlist. */
export function isEmptyOrganisation(overview: OverviewResponse): boolean {
  return (
    overview.displays.total === 0 && overview.media.total === 0 && overview.playlists.total === 0
  );
}

// ---------------------------------------------------------------------------
// Changes waiting

export type PushOverviewState =
  /** One or more screens have changes waiting. */
  | 'changes'
  /** Nothing is waiting and nothing is blocked. */
  | 'up_to_date'
  /** Nothing can be pushed, and at least one screen is blocked. */
  | 'blocked_only'
  /** There are screens, and none has a playlist, a schedule or a layout assigned. */
  | 'nothing_assigned'
  | 'no_screens';

export interface PushOverview {
  readonly state: PushOverviewState;
  /** Screens with changes waiting; equals `pendingCount` of the plan. */
  readonly pending: number;
  /** Screens whose assigned content cannot be pushed as it is. */
  readonly blocked: number;
  /** The first screens with changes waiting, in the plan's order. */
  readonly waiting: readonly PushPlanRow[];
  /** How many waiting screens are not in `waiting`. */
  readonly moreWaiting: number;
  readonly headline: string;
  readonly text: string;
  /** A sentence about the blocked screens, or null when there are none. */
  readonly blockedText: string | null;
}

/**
 * The "Changes waiting" card, from the push plan. `canPush` false (no `push.publish`) words
 * the texts for someone who waits for an editor to push.
 */
export function pushOverview(plan: PushPlanResponse, limit = 3, canPush = true): PushOverview {
  const whoPushes = canPush ? 'you push' : 'an editor pushes';
  const pendingRows = plan.items.filter((row) => isPushPending(row.state));
  const pending = pendingRows.length;
  const blocked = plan.items.filter((row) => row.state === 'blocked').length;
  const assigned = plan.items.filter((row) => row.state !== 'nothing_assigned').length;
  const waiting = pendingRows.slice(0, Math.max(0, limit));

  let state: PushOverviewState;
  let headline: string;
  let text: string;
  if (pending > 0) {
    state = 'changes';
    headline = pending === 1 ? 'screen has changes waiting' : 'screens have changes waiting';
    text = `Nothing changes on a screen until ${whoPushes}.`;
  } else if (blocked > 0) {
    state = 'blocked_only';
    headline = 'No changes can be pushed';
    text = 'No screen has changes that are ready to push.';
  } else if (plan.items.length === 0) {
    state = 'no_screens';
    headline = 'Nothing to push yet';
    text = canPush
      ? 'Add a screen and assign a playlist, a schedule or a layout to it. Its changes then wait here until you push.'
      : 'An editor adds screens and assigns content. Changes then wait here until an editor pushes.';
  } else if (assigned === 0) {
    state = 'nothing_assigned';
    headline = 'Nothing to push yet';
    text = canPush
      ? 'Assign a playlist, a schedule or a layout to a screen. Its changes then wait here until you push.'
      : 'An editor assigns a playlist, a schedule or a layout to a screen. Its changes then wait here until an editor pushes.';
  } else {
    state = 'up_to_date';
    headline = 'Everything is up to date';
    text = 'Every screen with content assigned has been given its latest version.';
  }

  return {
    state,
    pending,
    blocked,
    waiting,
    moreWaiting: pending - waiting.length,
    headline,
    text,
    blockedText:
      blocked === 0
        ? null
        : `${pluralCount(blocked, 'screen is', 'screens are')} blocked: the assigned content cannot be pushed as it is.`,
  };
}

// ---------------------------------------------------------------------------
// Library

export interface MediaStatusNote {
  readonly status: 'processing' | 'failed';
  readonly tone: 'warn' | 'danger';
  /** "2 processing", "3 failed". */
  readonly label: string;
}

/** The media states worth a word on the dashboard: files still being checked, and failures. */
export function mediaStatusNotes(media: OverviewResponse['media']): readonly MediaStatusNote[] {
  const notes: MediaStatusNote[] = [];
  if (media.processing > 0) {
    notes.push({
      status: 'processing',
      tone: 'warn',
      label: `${formatCount(media.processing)} processing`,
    });
  }
  if (media.failed > 0) {
    notes.push({ status: 'failed', tone: 'danger', label: `${formatCount(media.failed)} failed` });
  }
  return notes;
}
