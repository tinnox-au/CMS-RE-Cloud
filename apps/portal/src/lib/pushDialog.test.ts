import {
  ABSOLUTE,
  IdempotencyKeySchema,
  PUSH_OUTCOMES,
  PUSH_STATES,
  PushPlanResponseSchema,
  PushResultSchema,
  isPushPending,
  type PushPlanRow,
  type PushResult,
  type PushState,
} from '@tinnox/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client.ts';
import {
  PUSH_BATCH_SIZE,
  PUSH_GROUP_IDS,
  afterAttempt,
  batchIds,
  classifyPushFailure,
  defaultSelection,
  groupRows,
  isRetryOf,
  isSelectable,
  keyForPush,
  lastPushedLabel,
  mergeResults,
  newPushKey,
  nothingWaitingNotice,
  openDialogState,
  presentPushOutcome,
  presentPushState,
  presentRow,
  pruneToSelectable,
  pushBlockedReason,
  pushButtonLabel,
  pushGroupOf,
  reportAttempt,
  resultFor,
  scopeRows,
  screenCount,
  searchRows,
  selectableIds,
  selectedInOrder,
  summariseAttempt,
  withPlan,
  withSelection,
  withTimeout,
  type PushAttempt,
} from './pushDialog.ts';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PLAYLIST = '11111111-1111-4111-8111-111111111111';
const PUBLICATION = '22222222-2222-4222-8222-222222222222';
const PUSHED_AT = '2026-11-15T01:00:00.000Z';

const ISSUE = {
  path: 'playlist',
  message: 'The playlist has no items. Add at least one image or video.',
  code: 'playlist_empty',
} as const;

function row(n: number, state: PushState, name = `Screen ${n}`): PushPlanRow {
  return {
    display: { id: id(n), name },
    playlist: state === 'nothing_assigned' ? null : { id: PLAYLIST, name: 'Foyer loop' },
    schedule: null,
    state,
    issues: state === 'blocked' ? [ISSUE] : [],
    lastPushedAt: state === 'changes' || state === 'up_to_date' ? PUSHED_AT : null,
  };
}

function result(n: number, outcome: PushResult['outcome']): PushResult {
  return {
    displayId: id(n),
    outcome,
    publicationId: outcome === 'published' || outcome === 'unchanged' ? PUBLICATION : null,
    issues: outcome === 'rejected' ? [ISSUE] : [],
  };
}

/** One row of every state: 1 changes, 2 never pushed, 3 up to date, 4 blocked, 5 unassigned. */
const PLAN: readonly PushPlanRow[] = [
  row(1, 'changes'),
  row(2, 'never_pushed'),
  row(3, 'up_to_date'),
  row(4, 'blocked'),
  row(5, 'nothing_assigned'),
];

function apiError(status: number, code: ApiRequestError['code'], fromApi = true): ApiRequestError {
  return new ApiRequestError({ status, code, message: 'x', fromApi });
}

const sorted = (set: ReadonlySet<string>): string[] => [...set].sort();

let keyCounter = 0;
const nextKey = (): string => {
  keyCounter += 1;
  return `key-${String(keyCounter).padStart(16, '0')}`;
};

describe('the fixtures', () => {
  it('are rows and results the API could send', () => {
    expect(PushPlanResponseSchema.safeParse({ items: PLAN, pendingCount: 2 }).success).toBe(true);
    for (const outcome of PUSH_OUTCOMES) {
      expect(PushResultSchema.safeParse(result(1, outcome)).success).toBe(true);
    }
  });
});

describe('scope and search', () => {
  it('lists the whole plan unless the caller limits it', () => {
    expect(scopeRows(PLAN, undefined)).toBe(PLAN);
    expect(scopeRows(PLAN, [id(3), id(1)]).map((r) => r.display.id)).toEqual([id(1), id(3)]);
  });

  it('compares ids without regard to letter case and ignores unknown ids', () => {
    const upper = 'ABCDEF00-0000-4000-8000-000000000001';
    const plan = [{ ...row(1, 'changes'), display: { id: upper.toLowerCase(), name: 'A' } }];
    expect(scopeRows(plan, [upper])).toHaveLength(1);
    expect(scopeRows(PLAN, [id(99)])).toEqual([]);
    expect(scopeRows(PLAN, [])).toEqual([]);
  });

  it('searches the screen name and the playlist name', () => {
    const plan = [
      row(1, 'changes', 'Foyer north'),
      row(2, 'changes', 'Lift lobby'),
      row(3, 'nothing_assigned', 'Loop room'),
    ];
    expect(searchRows(plan, '')).toBe(plan);
    expect(searchRows(plan, '   ')).toBe(plan);
    expect(searchRows(plan, 'lift').map((r) => r.display.name)).toEqual(['Lift lobby']);
    // "Foyer loop" is the playlist of the first two; the third has no playlist but is named Loop.
    expect(searchRows(plan, 'LOOP')).toHaveLength(3);
    expect(searchRows(plan, 'foyer north')).toHaveLength(1);
    expect(searchRows(plan, 'nowhere')).toEqual([]);
  });

  it('finds a screen by the name of its schedule', () => {
    const scheduled: PushPlanRow = {
      ...row(4, 'changes', 'Canteen'),
      schedule: { id: id(600), name: 'Opening hours' },
    };
    const plan = [row(1, 'changes', 'Foyer north'), scheduled];
    expect(searchRows(plan, 'opening').map((r) => r.display.name)).toEqual(['Canteen']);
    // The default playlist of the schedule still matches, as the playlist of any row does.
    expect(searchRows(plan, 'foyer loop')).toHaveLength(2);
  });
});

describe('groups', () => {
  it('puts every state in exactly one group', () => {
    expect(pushGroupOf('changes')).toBe('waiting');
    expect(pushGroupOf('never_pushed')).toBe('waiting');
    expect(pushGroupOf('blocked')).toBe('blocked');
    expect(pushGroupOf('up_to_date')).toBe('up_to_date');
    expect(pushGroupOf('nothing_assigned')).toBe('nothing_assigned');
    for (const state of PUSH_STATES) expect(PUSH_GROUP_IDS).toContain(pushGroupOf(state));
  });

  it('groups in the fixed order and keeps the plan order inside a group', () => {
    const plan = [
      row(5, 'nothing_assigned'),
      row(3, 'up_to_date'),
      row(2, 'never_pushed'),
      row(4, 'blocked'),
      row(1, 'changes'),
    ];
    const groups = groupRows(plan);
    expect(groups.map((g) => g.id)).toEqual([
      'waiting',
      'blocked',
      'up_to_date',
      'nothing_assigned',
    ]);
    expect(groups.map((g) => g.title)).toEqual([
      'Changes waiting',
      'Blocked',
      'Up to date',
      'Nothing assigned',
    ]);
    expect(groups[0]?.rows.map((r) => r.display.id)).toEqual([id(2), id(1)]);
  });

  it('speaks of content in the group notes: a screen may have a schedule', () => {
    const groups = groupRows([
      row(5, 'nothing_assigned'),
      row(3, 'up_to_date'),
      row(4, 'blocked'),
      row(1, 'changes'),
    ]);
    expect(groups.map((g) => g.note)).toEqual([
      'The assigned content differs from what these screens were last given.',
      'The assigned content cannot be pushed as it is. Each screen keeps the version it has.',
      'The last push already matches the assigned content. There is nothing to push.',
      'Assign a playlist or a schedule to a screen before pushing to it.',
    ]);
  });

  it('leaves out a group without rows', () => {
    expect(groupRows([row(3, 'up_to_date')]).map((g) => g.id)).toEqual(['up_to_date']);
    expect(groupRows([])).toEqual([]);
  });

  it('lets only the waiting group be ticked, exactly the states the API counts as pending', () => {
    for (const group of groupRows(PLAN)) {
      expect(group.selectable).toBe(group.id === 'waiting');
      for (const member of group.rows) {
        expect(isSelectable(member)).toBe(group.selectable);
        expect(isSelectable(member)).toBe(isPushPending(member.state));
      }
    }
  });

  it('counts screens in words', () => {
    expect(screenCount(0)).toBe('0 screens');
    expect(screenCount(1)).toBe('1 screen');
    expect(screenCount(12)).toBe('12 screens');
  });
});

describe('selection', () => {
  it('ticks every screen with changes waiting by default, never pushed included', () => {
    expect(selectableIds(PLAN)).toEqual([id(1), id(2)]);
    expect(sorted(defaultSelection(PLAN))).toEqual([id(1), id(2)]);
    expect(defaultSelection([row(3, 'up_to_date'), row(4, 'blocked')]).size).toBe(0);
  });

  it('ticks only the named screens when the caller preselects, and only where pushable', () => {
    expect(sorted(defaultSelection(PLAN, [id(2)]))).toEqual([id(2)]);
    // Blocked, up to date, unassigned and unknown screens cannot be ticked by a caller either.
    expect(defaultSelection(PLAN, [id(3), id(4), id(5), id(99)]).size).toBe(0);
    expect(defaultSelection(PLAN, []).size).toBe(0);
    expect(sorted(defaultSelection(PLAN, [id(1).toUpperCase()]))).toEqual([id(1)]);
  });

  it('prunes ticks that can no longer be pushed and keeps the set when nothing changes', () => {
    const selected: ReadonlySet<string> = new Set([id(1), id(2)]);
    expect(pruneToSelectable(selected, PLAN)).toBe(selected);
    const later = [row(1, 'up_to_date'), row(2, 'never_pushed')];
    expect(sorted(pruneToSelectable(selected, later))).toEqual([id(2)]);
    expect(pruneToSelectable(selected, []).size).toBe(0);
    const empty: ReadonlySet<string> = new Set();
    expect(pruneToSelectable(empty, PLAN)).toBe(empty);
  });

  it('sends the ticked ids in the order of the rows', () => {
    expect(selectedInOrder(PLAN, new Set([id(2), id(1)]))).toEqual([id(1), id(2)]);
    expect(selectedInOrder(PLAN, new Set([id(2), id(3)]))).toEqual([id(2)]);
  });
});

describe('idempotency key', () => {
  it('makes keys the API accepts from crypto.randomUUID', () => {
    const key = newPushKey(() => crypto.randomUUID());
    expect(IdempotencyKeySchema.safeParse(key).success).toBe(true);
    expect(newPushKey(() => crypto.randomUUID())).not.toBe(key);
  });

  it('treats no answer, a server fault and throttling as unknown', () => {
    expect(classifyPushFailure(apiError(0, 'network_error', false))).toBe('unknown');
    expect(classifyPushFailure(apiError(0, 'aborted', false))).toBe('unknown');
    expect(classifyPushFailure(apiError(200, 'invalid_response', false))).toBe('unknown');
    expect(classifyPushFailure(apiError(500, 'internal_error'))).toBe('unknown');
    expect(classifyPushFailure(apiError(503, 'invalid_response', false))).toBe('unknown');
    expect(classifyPushFailure(apiError(429, 'rate_limited'))).toBe('unknown');
    expect(classifyPushFailure(new Error('something else'))).toBe('unknown');
  });

  it('treats a push that stopped part of the way through (409 conflict) as unknown', () => {
    expect(classifyPushFailure(apiError(409, 'conflict'))).toBe('unknown');
  });

  it('treats a clear refusal as definite', () => {
    expect(classifyPushFailure(apiError(404, 'not_found'))).toBe('refused');
    expect(classifyPushFailure(apiError(400, 'validation_failed'))).toBe('refused');
    expect(classifyPushFailure(apiError(403, 'csrf_failed'))).toBe('refused');
    expect(classifyPushFailure(apiError(401, 'unauthenticated'))).toBe('refused');
    // Never sent: there was no session token to send it with.
    expect(classifyPushFailure(apiError(0, 'no_session', false))).toBe('refused');
  });

  it('batches a push larger than one request may carry', () => {
    expect(PUSH_BATCH_SIZE).toBe(ABSOLUTE.maxPushDisplays);
    expect(batchIds([])).toEqual([]);
    expect(batchIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    expect(batchIds(['a', 'b'], 2)).toEqual([['a', 'b']]);
    const many = Array.from({ length: PUSH_BATCH_SIZE + 1 }, (_, n) => id(n));
    const batches = batchIds(many);
    expect(batches.map((batch) => batch.length)).toEqual([PUSH_BATCH_SIZE, 1]);
    expect(batches.flat()).toEqual(many);
    expect(() => batchIds(['a'], 0)).toThrow(RangeError);
  });
});

describe('timeout', () => {
  it('passes a prompt answer and a prompt failure through unchanged', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, () => new Error('late'))).resolves.toBe(
      'ok',
    );
    const failure = apiError(404, 'not_found');
    await expect(withTimeout(Promise.reject(failure), 1000, () => new Error('late'))).rejects.toBe(
      failure,
    );
  });

  it('gives up waiting after the limit, with an outcome that counts as unknown', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => undefined);
      const timedOut = apiError(0, 'network_error', false);
      const waiting = withTimeout(never, 60_000, () => timedOut);
      const settled = vi.fn();
      waiting.then(settled, settled);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledWith(timedOut);
      expect(classifyPushFailure(timedOut)).toBe('unknown');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fire after the promise has settled', async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn(() => new Error('late'));
      await expect(withTimeout(Promise.resolve(1), 1000, onTimeout)).resolves.toBe(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(onTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('dialog state', () => {
  it('opens with nothing ticked and nothing known', () => {
    const state = openDialogState('key-a');
    expect(state).toMatchObject({ key: 'key-a', seeded: false, retry: false, lastAttempt: null });
    expect(state.selected.size).toBe(0);
    expect(state.results.size).toBe(0);
  });

  it('seeds the default selection from the first plan only', () => {
    const seeded = withPlan(openDialogState('key-a'), PLAN);
    expect(seeded.seeded).toBe(true);
    expect(sorted(seeded.selected)).toEqual([id(1), id(2)]);

    // The operator unticks a screen; a refreshed plan must not tick it again.
    const unticked = withSelection(seeded, new Set([id(1)]));
    const refreshed = withPlan(unticked, PLAN);
    expect(refreshed).toBe(unticked);

    // A screen that newly has changes waiting is not ticked behind the operator's back.
    const grown = withPlan(unticked, [...PLAN, row(6, 'changes')]);
    expect(sorted(grown.selected)).toEqual([id(1)]);
  });

  it('seeds from the preselection when the caller gave one', () => {
    const seeded = withPlan(openDialogState('key-a'), PLAN, [id(2), id(4)]);
    expect(sorted(seeded.selected)).toEqual([id(2)]);
  });

  it('prunes on a later plan', () => {
    const seeded = withPlan(openDialogState('key-a'), PLAN);
    const later = withPlan(seeded, [row(1, 'up_to_date'), row(2, 'never_pushed')]);
    expect(sorted(later.selected)).toEqual([id(2)]);
  });

  it('after a full answer: stores results, clears those ticks and takes a new key', () => {
    const seeded = withPlan(openDialogState('key-a'), PLAN);
    const attempt: PushAttempt = {
      requestedIds: [id(1), id(2)],
      results: [result(1, 'published'), result(2, 'rejected')],
      failure: null,
    };
    const after = afterAttempt(seeded, attempt, () => 'key-b');
    expect(after.key).toBe('key-b');
    expect(after.retry).toBe(false);
    expect(after.selected.size).toBe(0);
    expect(resultFor(after.results, id(1))?.outcome).toBe('published');
    expect(resultFor(after.results, id(2))?.outcome).toBe('rejected');
    expect(after.lastAttempt).toBe(attempt);
    // The input state is untouched.
    expect(seeded.key).toBe('key-a');
    expect(seeded.selected.size).toBe(2);
  });

  it('after an unknown outcome: keeps the key and the ticks for the retry', () => {
    const seeded = withPlan(openDialogState('key-a'), PLAN);
    const attempt: PushAttempt = {
      requestedIds: [id(1), id(2)],
      results: [],
      failure: apiError(0, 'network_error', false),
    };
    const after = afterAttempt(seeded, attempt, nextKey);
    expect(after.key).toBe('key-a');
    expect(after.retry).toBe(true);
    expect(sorted(after.selected)).toEqual([id(1), id(2)]);
    expect(after.results.size).toBe(0);

    // The retry is answered: the intent is over and the next push gets a new key.
    const retried = afterAttempt(
      after,
      {
        requestedIds: [id(1), id(2)],
        results: [result(1, 'published'), result(2, 'published')],
        failure: null,
      },
      () => 'key-c',
    );
    expect(retried.key).toBe('key-c');
    expect(retried.retry).toBe(false);
    expect(retried.selected.size).toBe(0);
  });

  it('repeats the key only for the same intent, narrowed or whole', () => {
    const seeded = withPlan(openDialogState('key-a'), PLAN);
    // A timeout after the first batch: screen 1 answered, screens 2 and 3 unknown.
    const after = afterAttempt(
      seeded,
      {
        requestedIds: [id(1), id(2), id(3)],
        results: [result(1, 'published')],
        failure: apiError(0, 'network_error', false),
      },
      nextKey,
    );
    expect(after.retry).toBe(true);
    const fresh = vi.fn(() => 'key-new');

    // The same screens, or some of them: the same intent, so the same key.
    expect(isRetryOf(after, [id(2), id(3)])).toBe(true);
    expect(keyForPush(after, [id(2), id(3)], fresh)).toBe('key-a');
    expect(isRetryOf(after, [id(3)])).toBe(true);
    expect(keyForPush(after, [id(3)], fresh)).toBe('key-a');
    expect(fresh).not.toHaveBeenCalled();

    // Another screen ticked, even one already answered in this opening: a new intent.
    expect(isRetryOf(after, [id(2), id(4)])).toBe(false);
    expect(keyForPush(after, [id(2), id(4)], fresh)).toBe('key-new');
    expect(isRetryOf(after, [id(1)])).toBe(false);
    expect(keyForPush(after, [id(1)], fresh)).toBe('key-new');
    expect(isRetryOf(after, [])).toBe(false);

    // Ids compare without regard to case, as the API returns them.
    expect(isRetryOf(after, [id(2).toUpperCase()])).toBe(true);

    // An unknown outcome of the new intent keeps the new key for its own retry.
    const second = afterAttempt(
      after,
      {
        requestedIds: [id(4)],
        results: [],
        failure: apiError(0, 'network_error', false),
        key: 'key-new',
      },
      nextKey,
    );
    expect(second.key).toBe('key-new');
    expect(second.retry).toBe(true);
  });

  it('uses the state key when no attempt is pending', () => {
    const seeded = withPlan(openDialogState('key-a'), PLAN);
    const fresh = vi.fn(() => 'key-new');
    expect(isRetryOf(seeded, [id(1)])).toBe(false);
    expect(keyForPush(seeded, [id(1)], fresh)).toBe('key-a');
    expect(fresh).not.toHaveBeenCalled();
  });

  it('after a clear refusal: takes a new key and keeps the ticks', () => {
    const seeded = withPlan(openDialogState('key-a'), PLAN);
    const after = afterAttempt(
      seeded,
      { requestedIds: [id(1), id(2)], results: [], failure: apiError(404, 'not_found') },
      () => 'key-b',
    );
    expect(after.key).toBe('key-b');
    expect(after.retry).toBe(false);
    expect(sorted(after.selected)).toEqual([id(1), id(2)]);
  });

  it('after a batch failed part of the way: keeps answers, keeps the rest ticked, keeps the key', () => {
    const seeded = withPlan(openDialogState('key-a'), PLAN);
    const after = afterAttempt(
      seeded,
      {
        requestedIds: [id(1), id(2)],
        results: [result(1, 'published')],
        failure: apiError(502, 'invalid_response', false),
      },
      nextKey,
    );
    expect(after.key).toBe('key-a');
    expect(after.retry).toBe(true);
    expect(sorted(after.selected)).toEqual([id(2)]);
    expect(resultFor(after.results, id(1))?.outcome).toBe('published');
  });

  it('never repeats a key after a definite answer, over any sequence of attempts', () => {
    let state = withPlan(openDialogState(nextKey()), PLAN);
    const used = new Set<string>();
    const failures: unknown[] = [
      apiError(0, 'network_error', false),
      apiError(404, 'not_found'),
      null,
      apiError(409, 'conflict'),
      null,
    ];
    let previousKey = state.key;
    let previousDefinite = false;
    for (const failure of failures) {
      if (previousDefinite) expect(used.has(state.key)).toBe(false);
      else if (used.size > 0) expect(state.key).toBe(previousKey);
      used.add(state.key);
      previousKey = state.key;
      state = afterAttempt(
        state,
        {
          requestedIds: [id(1)],
          results: failure === null ? [result(1, 'unchanged')] : [],
          failure,
        },
        nextKey,
      );
      previousDefinite = !state.retry;
    }
  });

  it('merges results by screen, the newer answer winning, without regard to letter case', () => {
    const first = mergeResults(new Map(), [result(1, 'rejected'), result(2, 'published')]);
    expect(first.size).toBe(2);
    expect(mergeResults(first, [])).toBe(first);
    const second = mergeResults(first, [
      { ...result(1, 'published'), displayId: id(1).toUpperCase() },
    ]);
    expect(second.size).toBe(2);
    expect(resultFor(second, id(1))?.outcome).toBe('published');
    expect(resultFor(second, id(2).toUpperCase())?.outcome).toBe('published');
    expect(resultFor(first, id(1))?.outcome).toBe('rejected');
    expect(resultFor(second, id(9))).toBeUndefined();
  });
});

describe('summary of an attempt', () => {
  const attempt = (
    requested: readonly number[],
    results: readonly PushResult[],
    failure: unknown = null,
  ): PushAttempt => ({ requestedIds: requested.map(id), results, failure });

  it('counts each outcome and the screens that got no answer', () => {
    const summary = summariseAttempt(
      attempt(
        [1, 2, 3, 4, 5, 6],
        [
          result(1, 'published'),
          result(2, 'published'),
          result(3, 'unchanged'),
          result(4, 'rejected'),
          result(5, 'skipped'),
        ],
        apiError(0, 'network_error', false),
      ),
    );
    expect(summary).toEqual({
      requested: 6,
      published: 2,
      unchanged: 1,
      rejected: 1,
      skipped: 1,
      unanswered: 1,
    });
  });

  it('reports a complete push as done, with the honest sentence about the player', () => {
    const report = reportAttempt(
      summariseAttempt(attempt([1, 2], [result(1, 'published'), result(2, 'published')])),
    );
    expect(report?.tone).toBe('ok');
    expect(report?.title).toBe('Pushed to 2 screens');
    expect(report?.lines).toHaveLength(1);
    expect(report?.lines[0]).toContain('downloaded and verified');

    const one = reportAttempt(summariseAttempt(attempt([1], [result(1, 'published')])));
    expect(one?.title).toBe('Pushed to 1 screen');
    expect(one?.lines[0]).toContain('downloaded and verified');
  });

  it('reports partial success precisely', () => {
    const report = reportAttempt(
      summariseAttempt(
        attempt(
          [1, 2, 3, 4],
          [
            result(1, 'published'),
            result(2, 'rejected'),
            result(3, 'unchanged'),
            result(4, 'skipped'),
          ],
        ),
      ),
    );
    expect(report?.tone).toBe('warn');
    expect(report?.title).toBe('Pushed to 1 of 4 screens');
    expect(report?.lines).toHaveLength(4);
    expect(report?.lines.join(' ')).toContain('1 screen was rejected');
    expect(report?.lines.join(' ')).toContain('1 screen was already up to date');
    expect(report?.lines.join(' ')).toContain('1 screen was skipped: nothing is assigned.');
    expect(report?.lines.join(' ')).toContain(
      '1 screen was rejected: the assigned content cannot be pushed as it is.',
    );
  });

  it('never claims a push when nothing was published', () => {
    const rejected = reportAttempt(
      summariseAttempt(attempt([1, 2], [result(1, 'rejected'), result(2, 'rejected')])),
    );
    expect(rejected?.tone).toBe('danger');
    expect(rejected?.title).toBe('No screen was given a new version');
    expect(rejected?.lines.join(' ')).toContain('2 screens were rejected');
    expect(rejected?.lines.join(' ')).not.toContain('downloaded');

    const unchanged = reportAttempt(summariseAttempt(attempt([1], [result(1, 'unchanged')])));
    expect(unchanged?.tone).toBe('info');
    expect(unchanged?.title).toBe('Nothing needed pushing');
    expect(`${unchanged?.title} ${unchanged?.lines.join(' ')}`).not.toMatch(/^Pushed/);
  });

  it('says which screens were not answered for when a later batch failed', () => {
    const report = reportAttempt(
      summariseAttempt(
        attempt([1, 2, 3], [result(1, 'published')], apiError(0, 'network_error', false)),
      ),
    );
    expect(report?.tone).toBe('warn');
    expect(report?.title).toBe('Pushed to 1 of 3 screens');
    expect(report?.lines.join(' ')).toContain('2 screens were not answered for');
  });

  it('has no summary when the whole request failed', () => {
    expect(
      reportAttempt(summariseAttempt(attempt([1, 2], [], apiError(500, 'internal_error')))),
    ).toBeNull();
  });
});

describe('words', () => {
  it('has a pill for every state and every outcome', () => {
    for (const state of PUSH_STATES) expect(presentPushState(state).label).not.toBe('');
    for (const outcome of PUSH_OUTCOMES) expect(presentPushOutcome(outcome).label).not.toBe('');
    expect(presentPushState('changes')).toEqual({ label: 'Changes waiting', tone: 'warn' });
    expect(presentPushState('never_pushed').tone).toBe('warn');
    expect(presentPushState('up_to_date')).toEqual({ label: 'Up to date', tone: 'neutral' });
    expect(presentPushState('never_pushed').label).toBe('Not pushed yet');
    expect(presentPushState('blocked').tone).toBe('danger');
    expect(presentPushOutcome('published')).toEqual({ label: 'Pushed', tone: 'ok' });
    expect(presentPushOutcome('rejected').tone).toBe('danger');
  });

  it('shows the state before a push and the answer after it', () => {
    const before = presentRow(row(1, 'changes'), undefined);
    expect(before).toEqual({ pill: presentPushState('changes'), answered: false, issues: [] });

    const after = presentRow(row(1, 'up_to_date'), result(1, 'published'));
    expect(after.pill.label).toBe('Pushed');
    expect(after.answered).toBe(true);
  });

  it('shows the issues of a blocked row, and of a rejection even before the plan catches up', () => {
    expect(presentRow(row(4, 'blocked'), undefined).issues).toEqual([ISSUE]);
    // Rejected by the push while the plan still said "changes".
    const rejected = presentRow(row(1, 'changes'), result(1, 'rejected'));
    expect(rejected.pill.label).toBe('Rejected');
    expect(rejected.issues).toEqual([ISSUE]);
  });

  it('never uses the banned status words or the word display', () => {
    const texts: string[] = [];
    for (const state of PUSH_STATES) texts.push(presentPushState(state).label);
    for (const outcome of PUSH_OUTCOMES) texts.push(presentPushOutcome(outcome).label);
    for (const group of groupRows(PLAN)) texts.push(group.title, group.note);
    for (const count of [0, 1, 5]) {
      texts.push(pushButtonLabel(count, false), pushButtonLabel(count, true), screenCount(count));
      texts.push(pushBlockedReason(count, 0) ?? '');
    }
    const everyOutcome = summariseAttempt({
      requestedIds: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id),
      results: [
        result(1, 'published'),
        result(2, 'published'),
        result(3, 'unchanged'),
        result(4, 'unchanged'),
        result(5, 'rejected'),
        result(6, 'rejected'),
        result(7, 'skipped'),
        result(8, 'skipped'),
      ],
      failure: apiError(0, 'network_error', false),
    });
    const report = reportAttempt(everyOutcome);
    texts.push(report?.title ?? '', ...(report?.lines ?? []));
    const all = texts.join(' ').toLowerCase();
    expect(all).not.toContain('online');
    expect(all).not.toContain('offline');
    expect(all).not.toContain('display');
  });

  it('says why nothing is waiting, and nothing when something is', () => {
    expect(nothingWaitingNotice(PLAN)).toBeNull();
    expect(nothingWaitingNotice([])).toBeNull();
    const upToDate = nothingWaitingNotice([row(3, 'up_to_date'), row(5, 'nothing_assigned')]);
    expect(upToDate).toMatchObject({ tone: 'ok', title: 'No changes waiting' });
    const blocked = nothingWaitingNotice([row(3, 'up_to_date'), row(4, 'blocked')]);
    expect(blocked?.tone).toBe('warn');
    expect(blocked?.text).toBe('1 screen is blocked. Fix the assigned content, then push.');
    expect(upToDate?.text).toBe(
      'Every screen with content assigned was already given its latest version.',
    );
    expect(nothingWaitingNotice([row(4, 'blocked'), row(6, 'blocked')])?.text).toContain(
      '2 screens are blocked',
    );
    const unassigned = nothingWaitingNotice([row(5, 'nothing_assigned')]);
    expect(unassigned?.tone).toBe('info');
    expect(unassigned?.text).toBe(
      'No screen has content assigned yet. Assign a playlist or a schedule to a screen, then push.',
    );
    for (const notice of [upToDate, blocked, unassigned]) {
      expect(`${notice?.title} ${notice?.text}`.toLowerCase()).not.toMatch(
        /online|offline|display/,
      );
    }
  });

  it('says when a screen was last pushed to', () => {
    const now = Date.parse(PUSHED_AT) + 3 * 3600 * 1000;
    expect(lastPushedLabel(row(1, 'changes'), now)).toBe('Last pushed 3 hours ago');
    expect(lastPushedLabel(row(1, 'changes'), Date.parse(PUSHED_AT))).toBe('Last pushed just now');
    expect(lastPushedLabel(row(2, 'never_pushed'), now)).toBeNull();
    expect(lastPushedLabel({ ...row(1, 'changes'), lastPushedAt: 'not a time' }, now)).toBeNull();
  });

  it('labels the primary button with the number of ticked screens', () => {
    expect(pushButtonLabel(0, false)).toBe('Push to screens');
    expect(pushButtonLabel(1, false)).toBe('Push to 1 screen');
    expect(pushButtonLabel(3, false)).toBe('Push to 3 screens');
    expect(pushButtonLabel(3, true)).toBe('Retry push to 3 screens');
    expect(pushButtonLabel(1, true)).toBe('Retry push to 1 screen');
  });

  it('explains why the button does nothing when nothing is ticked', () => {
    expect(pushBlockedReason(2, 1)).toBeNull();
    expect(pushBlockedReason(2, 0)).toBe('Tick at least one screen to push to.');
    expect(pushBlockedReason(0, 0)).toBe('No screen has changes waiting.');
  });
});
