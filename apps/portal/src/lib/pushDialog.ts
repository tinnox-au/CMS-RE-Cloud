/**
 * State of the "Push to screens" dialog (docs/portal-v2/stage-a.md, 3.9). Pure functions,
 * no DOM: grouping the push plan, the default selection, the idempotency key's life, merging
 * the answers of a push into the rows, and the words shown for each state.
 *
 * In code the object is a `display`, as in the API and the contracts; every string an
 * operator sees says "screen" (P2-03).
 */
import {
  ABSOLUTE,
  isPushPending,
  type PushIssue,
  type PushOutcome,
  type PushPlanRow,
  type PushResult,
  type PushState,
} from '@tinnox/contracts';
import { presentPushState as presentSharedPushState } from './screenStatusPush.ts';
import { isApiRequestError, isOutcomeUnknown } from '../api/client.ts';
import { formatAge } from './format.ts';
import { matchesSearch } from './listView.ts';

/** Matches the tones of the kit's `StatusPill`. */
export type PushTone = 'ok' | 'warn' | 'danger' | 'neutral';

export interface PushPill {
  readonly label: string;
  readonly tone: PushTone;
}

// ---------------------------------------------------------------------------
// Identifiers

/** Identifiers compare without regard to letter case; the API answers in lower case. */
function idKey(id: string): string {
  return id.toLowerCase();
}

function idSet(ids: readonly string[]): ReadonlySet<string> {
  return new Set(ids.map(idKey));
}

// ---------------------------------------------------------------------------
// What a caller asked the dialog to start with

/** The rows the dialog lists: the whole plan, or the screens the caller limited it to. */
export function scopeRows(
  items: readonly PushPlanRow[],
  only: readonly string[] | undefined,
): readonly PushPlanRow[] {
  if (only === undefined) return items;
  const wanted = idSet(only);
  return items.filter((row) => wanted.has(idKey(row.display.id)));
}

/**
 * Rows whose screen name, playlist name, schedule name or layout name contains every word of
 * the query.
 */
export function searchRows(rows: readonly PushPlanRow[], query: string): readonly PushPlanRow[] {
  if (query.trim() === '') return rows;
  return rows.filter((row) =>
    matchesSearch(
      [row.display.name, row.playlist?.name, row.schedule?.name, row.layout?.name],
      query,
    ),
  );
}

// ---------------------------------------------------------------------------
// Groups

export const PUSH_GROUP_IDS = ['waiting', 'blocked', 'up_to_date', 'nothing_assigned'] as const;
export type PushGroupId = (typeof PUSH_GROUP_IDS)[number];

export function pushGroupOf(state: PushState): PushGroupId {
  switch (state) {
    case 'changes':
    case 'never_pushed':
      return 'waiting';
    case 'blocked':
      return 'blocked';
    case 'up_to_date':
      return 'up_to_date';
    case 'nothing_assigned':
      return 'nothing_assigned';
  }
}

export interface PushGroup {
  readonly id: PushGroupId;
  readonly title: string;
  /** One sentence under the title: what a push does, or does not do, for these screens. */
  readonly note: string;
  /** Only screens with changes waiting can be ticked. */
  readonly selectable: boolean;
  readonly rows: readonly PushPlanRow[];
}

const GROUP_TEXT: {
  readonly [K in PushGroupId]: { readonly title: string; readonly note: string };
} = {
  waiting: {
    title: 'Changes waiting',
    note: 'The assigned content differs from what these screens were last given.',
  },
  blocked: {
    title: 'Blocked',
    note: 'The assigned content cannot be pushed as it is. Each screen keeps the version it has.',
  },
  up_to_date: {
    title: 'Up to date',
    note: 'The last push already matches the assigned content. There is nothing to push.',
  },
  nothing_assigned: {
    title: 'Nothing assigned',
    note: 'Assign a playlist, a schedule or a layout to a screen before pushing to it.',
  },
};

/**
 * The rows in their groups, in the fixed order of `PUSH_GROUP_IDS`. A group without rows is
 * left out. Inside a group the rows keep the order of the plan.
 */
export function groupRows(rows: readonly PushPlanRow[]): readonly PushGroup[] {
  const groups: PushGroup[] = [];
  for (const id of PUSH_GROUP_IDS) {
    const members = rows.filter((row) => pushGroupOf(row.state) === id);
    if (members.length === 0) continue;
    groups.push({ id, ...GROUP_TEXT[id], selectable: id === 'waiting', rows: members });
  }
  return groups;
}

/** "3 screens", "1 screen". */
export function screenCount(count: number): string {
  return count === 1 ? '1 screen' : `${count} screens`;
}

// ---------------------------------------------------------------------------
// Selection

export function isSelectable(row: PushPlanRow): boolean {
  return isPushPending(row.state);
}

export function selectableIds(rows: readonly PushPlanRow[]): readonly string[] {
  return rows.filter(isSelectable).map((row) => row.display.id);
}

/**
 * What is ticked when the dialog opens: every listed screen with changes waiting (never
 * pushed counts), or only those of them the caller named.
 */
export function defaultSelection(
  rows: readonly PushPlanRow[],
  preselect?: readonly string[],
): ReadonlySet<string> {
  const ids = selectableIds(rows);
  if (preselect === undefined) return new Set(ids);
  const wanted = idSet(preselect);
  return new Set(ids.filter((id) => wanted.has(idKey(id))));
}

/**
 * Drops ticks from screens that can no longer be pushed to (pushed meanwhile, blocked,
 * unassigned or deleted). Returns the same set when nothing had to go.
 */
export function pruneToSelectable(
  selected: ReadonlySet<string>,
  rows: readonly PushPlanRow[],
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const allowed = new Set(selectableIds(rows));
  let changed = false;
  const next = new Set<string>();
  for (const id of selected) {
    if (allowed.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selected;
}

/** The ticked ids in the order of the rows, which is the order they are sent in. */
export function selectedInOrder(
  rows: readonly PushPlanRow[],
  selected: ReadonlySet<string>,
): readonly string[] {
  return selectableIds(rows).filter((id) => selected.has(id));
}

// ---------------------------------------------------------------------------
// Idempotency key

/**
 * A new key for one opening of the dialog. `crypto.randomUUID()` gives 36 URL-safe
 * characters, inside the 16 to 64 that `IdempotencyKeySchema` accepts.
 */
export function newPushKey(randomUUID: () => string): string {
  return randomUUID();
}

/**
 * How a failed push request ended.
 * - `unknown`: the server may have carried out some or all of it (no answer, a timeout, an
 *   unreadable answer, a server fault, throttling), or it said that it stopped part of the
 *   way through (409 `conflict`: screens pushed so far keep their new version, and a repeat
 *   with the same key carries on). The next attempt must send the same key.
 * - `refused`: the server clearly answered that it did nothing. The next attempt is a new
 *   intent with a new key.
 */
export type PushFailureKind = 'unknown' | 'refused';

export function classifyPushFailure(error: unknown): PushFailureKind {
  if (isOutcomeUnknown(error)) return 'unknown';
  if (isApiRequestError(error) && error.status === 409 && error.code === 'conflict') {
    return 'unknown';
  }
  return 'refused';
}

/** The largest number of screens one request may carry; a larger push is sent in batches. */
export const PUSH_BATCH_SIZE = ABSOLUTE.maxPushDisplays;

/** Splits the ids into batches of at most `size`, keeping their order. */
export function batchIds(
  ids: readonly string[],
  size: number = PUSH_BATCH_SIZE,
): readonly (readonly string[])[] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('batch size must be at least 1');
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += size) {
    batches.push(ids.slice(start, start + size));
  }
  return batches;
}

/**
 * Settles as `promise` does, or rejects with `onTimeout()` when it has not settled after
 * `ms`. The work itself is not cancelled: a push that timed out may still be carried out,
 * which is why its outcome counts as unknown and the retry repeats the key.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(onTimeout());
    }, ms);
  });
  return Promise.race([promise, limit]).finally(() => {
    clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// Dialog state

/** What one attempt (one press of the push button) came to. */
export interface PushAttempt {
  /** The screens that were ticked, in the order sent. */
  readonly requestedIds: readonly string[];
  /** What the API answered, per screen. Empty when the whole request failed. */
  readonly results: readonly PushResult[];
  /** The error that ended the attempt, or null when every batch was answered. */
  readonly failure: unknown;
  /** The Idempotency-Key the attempt sent (`keyForPush`). Left out, the state's key. */
  readonly key?: string;
}

export interface PushDialogState {
  /** The Idempotency-Key the next request carries. */
  readonly key: string;
  /** True once the default selection was made for this opening; later plans only prune it. */
  readonly seeded: boolean;
  readonly selected: ReadonlySet<string>;
  /** The latest answer per screen in this opening, by lower-case display id. */
  readonly results: ReadonlyMap<string, PushResult>;
  /** The last finished attempt, for the summary. Null before the first. */
  readonly lastAttempt: PushAttempt | null;
  /**
   * True while the outcome of the last attempt is not known: the next attempt is a retry
   * and repeats the key, so no screen can be given two new versions.
   */
  readonly retry: boolean;
}

/** The state of a dialog that has just been opened. */
export function openDialogState(key: string): PushDialogState {
  return {
    key,
    seeded: false,
    selected: new Set(),
    results: new Map(),
    lastAttempt: null,
    retry: false,
  };
}

/**
 * Applies a push plan that has just arrived. The first plan of an opening sets the default
 * selection; a later one only removes ticks from screens that can no longer be pushed to,
 * so a refresh never ticks a screen the operator did not tick.
 */
export function withPlan(
  state: PushDialogState,
  rows: readonly PushPlanRow[],
  preselect?: readonly string[],
): PushDialogState {
  if (!state.seeded) {
    return { ...state, seeded: true, selected: defaultSelection(rows, preselect) };
  }
  const selected = pruneToSelectable(state.selected, rows);
  return selected === state.selected ? state : { ...state, selected };
}

export function withSelection(
  state: PushDialogState,
  selected: ReadonlySet<string>,
): PushDialogState {
  return { ...state, selected };
}

/** Adds the answers to the ones already held; a newer answer for a screen replaces the older. */
export function mergeResults(
  previous: ReadonlyMap<string, PushResult>,
  results: readonly PushResult[],
): ReadonlyMap<string, PushResult> {
  if (results.length === 0) return previous;
  const next = new Map(previous);
  for (const result of results) next.set(idKey(result.displayId), result);
  return next;
}

export function resultFor(
  results: ReadonlyMap<string, PushResult>,
  displayId: string,
): PushResult | undefined {
  return results.get(idKey(displayId));
}

/**
 * The state after an attempt.
 * - Every answered screen keeps its answer and loses its tick: it has been dealt with.
 * - Screens that were sent but not answered stay ticked, ready for the retry.
 * - The key is kept only while the outcome is unknown; any definite answer, success or
 *   refusal, ends the intent and the next attempt gets a new key.
 */
export function afterAttempt(
  state: PushDialogState,
  attempt: PushAttempt,
  newKey: () => string,
): PushDialogState {
  const answered = idSet(attempt.results.map((result) => result.displayId));
  const selected = new Set<string>();
  for (const id of state.selected) if (!answered.has(idKey(id))) selected.add(id);
  const retry = attempt.failure !== null && classifyPushFailure(attempt.failure) === 'unknown';
  return {
    ...state,
    key: retry ? (attempt.key ?? state.key) : newKey(),
    selected,
    results: mergeResults(state.results, attempt.results),
    lastAttempt: attempt,
    retry,
  };
}

/**
 * The screens of the last attempt whose outcome is still unknown: sent, but not answered.
 * Empty unless the state is a retry.
 */
function unansweredOfLastAttempt(state: PushDialogState): ReadonlySet<string> {
  const attempt = state.lastAttempt;
  if (!state.retry || attempt === null) return new Set();
  const answered = idSet(attempt.results.map((result) => result.displayId));
  return idSet(attempt.requestedIds.filter((id) => !answered.has(idKey(id))));
}

/**
 * True when pushing `ids` now repeats the intent whose outcome is unknown: every screen is
 * one that attempt sent and got no answer for. Unticking some of them keeps it the same
 * intent, narrowed; ticking any other screen makes it a new one.
 */
export function isRetryOf(state: PushDialogState, ids: readonly string[]): boolean {
  if (ids.length === 0) return false;
  const unanswered = unansweredOfLastAttempt(state);
  return ids.every((id) => unanswered.has(idKey(id)));
}

/**
 * The Idempotency-Key for pushing `ids` now. A key is repeated only for the same intent
 * while its outcome is unknown (`isRetryOf`). Once the operator has ticked another screen
 * the push is a new intent and gets a new key: otherwise a screen the unknown attempt did
 * publish would be answered with that earlier publication, even if its playlist has changed
 * since, and shown as pushed. A new key cannot give a screen a second identical version:
 * the API answers `unchanged` for a screen that is already up to date.
 */
export function keyForPush(
  state: PushDialogState,
  ids: readonly string[],
  newKey: () => string,
): string {
  return state.retry && !isRetryOf(state, ids) ? newKey() : state.key;
}

// ---------------------------------------------------------------------------
// Summary of an attempt

export interface PushAttemptSummary {
  readonly requested: number;
  readonly published: number;
  readonly unchanged: number;
  readonly rejected: number;
  readonly skipped: number;
  /** Screens that were sent and got no answer, because a request failed. */
  readonly unanswered: number;
}

export function summariseAttempt(attempt: PushAttempt): PushAttemptSummary {
  const count = (outcome: PushOutcome) =>
    attempt.results.filter((result) => result.outcome === outcome).length;
  const answered = idSet(attempt.results.map((result) => result.displayId));
  return {
    requested: attempt.requestedIds.length,
    published: count('published'),
    unchanged: count('unchanged'),
    rejected: count('rejected'),
    skipped: count('skipped'),
    unanswered: attempt.requestedIds.filter((id) => !answered.has(idKey(id))).length,
  };
}

export interface PushAttemptReport {
  readonly tone: 'ok' | 'warn' | 'danger' | 'info';
  readonly title: string;
  /** One sentence per kind of outcome that occurred, most important first. */
  readonly lines: readonly string[];
}

function was(count: number): string {
  return count === 1 ? '1 screen was' : `${count} screens were`;
}

/**
 * The summary shown above the rows after an attempt, or null when no screen was answered
 * for (the request error is then the whole story). It states only what the API answered.
 */
export function reportAttempt(summary: PushAttemptSummary): PushAttemptReport | null {
  const answered = summary.published + summary.unchanged + summary.rejected + summary.skipped;
  if (answered === 0) return null;

  const lines: string[] = [];
  if (summary.published > 0) {
    lines.push(
      summary.published === 1
        ? '1 screen was handed a new version. It changes when its player has downloaded and verified it.'
        : `${summary.published} screens were handed a new version. Each changes when its player has downloaded and verified it.`,
    );
  }
  if (summary.rejected > 0) {
    lines.push(
      `${was(summary.rejected)} rejected: the assigned content cannot be pushed as it is. ${
        summary.rejected === 1 ? 'It keeps' : 'They keep'
      } the version ${summary.rejected === 1 ? 'it has' : 'they have'}.`,
    );
  }
  if (summary.unanswered > 0) {
    lines.push(
      `${was(summary.unanswered)} not answered for. ${
        summary.unanswered === 1 ? 'It is' : 'They are'
      } still ticked.`,
    );
  }
  if (summary.unchanged > 0) {
    lines.push(`${was(summary.unchanged)} already up to date, so nothing new was made.`);
  }
  if (summary.skipped > 0) {
    lines.push(`${was(summary.skipped)} skipped: nothing is assigned.`);
  }

  const complete = summary.published === summary.requested;
  if (complete) {
    return { tone: 'ok', title: `Pushed to ${screenCount(summary.published)}`, lines };
  }
  if (summary.published > 0) {
    return {
      tone: 'warn',
      title: `Pushed to ${summary.published} of ${screenCount(summary.requested)}`,
      lines,
    };
  }
  if (summary.rejected > 0 || summary.unanswered > 0) {
    return { tone: 'danger', title: 'No screen was given a new version', lines };
  }
  return { tone: 'info', title: 'Nothing needed pushing', lines };
}

// ---------------------------------------------------------------------------
// Words

/**
 * The pill for a push state: the shared wording of `lib/screenStatusPush.ts`, so the dialog,
 * the screens list, the playlist editor and the screen page say the same thing.
 */
export function presentPushState(state: PushState): PushPill {
  const { label, tone } = presentSharedPushState(state);
  return { label, tone };
}

const OUTCOME_PILL: { readonly [K in PushOutcome]: PushPill } = {
  published: { label: 'Pushed', tone: 'ok' },
  unchanged: { label: 'Already up to date', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

export function presentPushOutcome(outcome: PushOutcome): PushPill {
  return OUTCOME_PILL[outcome];
}

export interface PushRowView {
  readonly pill: PushPill;
  /** True when the pill reports the answer of a push made in this opening of the dialog. */
  readonly answered: boolean;
  /** Why the playlist cannot be pushed: from the answer when rejected, else from the plan. */
  readonly issues: readonly PushIssue[];
}

/** What a row shows: the answer of this opening's push when there is one, else its state. */
export function presentRow(row: PushPlanRow, result: PushResult | undefined): PushRowView {
  if (result === undefined) {
    return { pill: presentPushState(row.state), answered: false, issues: row.issues };
  }
  return {
    pill: presentPushOutcome(result.outcome),
    answered: true,
    issues: result.outcome === 'rejected' ? result.issues : row.issues,
  };
}

export interface PushIdleNotice {
  readonly tone: 'ok' | 'warn' | 'info';
  readonly title: string;
  readonly text: string;
}

/**
 * What the dialog says when no listed screen has changes waiting, or null when at least
 * one has (or when there are no rows at all, which has its own empty state).
 */
export function nothingWaitingNotice(rows: readonly PushPlanRow[]): PushIdleNotice | null {
  if (rows.length === 0 || rows.some(isSelectable)) return null;
  const blocked = rows.filter((row) => row.state === 'blocked').length;
  if (blocked > 0) {
    return {
      tone: 'warn',
      title: 'Nothing can be pushed right now',
      text: `${blocked === 1 ? '1 screen is' : `${blocked} screens are`} blocked. Fix the assigned content, then push.`,
    };
  }
  if (rows.some((row) => row.state === 'up_to_date')) {
    return {
      tone: 'ok',
      title: 'No changes waiting',
      text: 'Every screen with content assigned was already given its latest version.',
    };
  }
  return {
    tone: 'info',
    title: 'No changes waiting',
    text: 'No screen has content assigned yet. Assign a playlist, a schedule or a layout to a screen, then push.',
  };
}

/** "Last pushed 3 hours ago", or null for a screen that was never pushed to. */
export function lastPushedLabel(row: PushPlanRow, nowMs: number): string | null {
  if (row.lastPushedAt === null) return null;
  const then = Date.parse(row.lastPushedAt);
  if (Number.isNaN(then)) return null;
  return `Last pushed ${formatAge((nowMs - then) / 1000)}`;
}

/** The primary button: "Push to 3 screens"; after an attempt of unknown outcome, a retry. */
export function pushButtonLabel(count: number, retry: boolean): string {
  if (count === 0) return 'Push to screens';
  return `${retry ? 'Retry push' : 'Push'} to ${screenCount(count)}`;
}

/** Why the primary button does nothing, or null when it can be pressed. */
export function pushBlockedReason(selectableCount: number, selectedCount: number): string | null {
  if (selectedCount > 0) return null;
  return selectableCount === 0
    ? 'No screen has changes waiting.'
    : 'Tick at least one screen to push to.';
}
