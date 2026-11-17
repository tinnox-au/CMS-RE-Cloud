import type { PushPlanResponse, PushPlanRow, PushResult } from '@tinnox/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import {
  afterAttempt,
  isRetryOf,
  keyForPush,
  batchIds,
  classifyPushFailure,
  groupRows,
  lastPushedLabel,
  newPushKey,
  nothingWaitingNotice,
  openDialogState,
  presentRow,
  pushBlockedReason,
  pushButtonLabel,
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
  type PushDialogState,
  type PushGroup,
  type PushGroupId,
} from '../../lib/pushDialog.ts';
import { summariseSelection, toggleAll, toggleOne } from '../../lib/selection.ts';
import {
  Banner,
  Button,
  ButtonLink,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorNotice,
  Icon,
  IconButton,
  SearchField,
  Skeleton,
  SkeletonGroup,
  StatusPill,
  Tooltip,
} from '../../ui/index.ts';
import {
  CalendarDays,
  CircleCheck,
  CircleDashed,
  CircleExclamationPoint,
  ListVideo,
  Monitor,
  Plus,
  RefreshCw,
  SearchX,
  Send,
  type IconComponent,
} from '../../ui/icons.ts';
import { PushStatePill } from '../shared/PushStatePill.tsx';
import './push.css';

export interface PushDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Show only these screens (display ids). The operator can lift the limit. */
  readonly only?: readonly string[] | undefined;
  /** Tick exactly these screens, where they have changes waiting. */
  readonly preselect?: readonly string[] | undefined;
  /** The push plan, read at or after the moment the dialog opened; null until it arrives. */
  readonly plan: PushPlanResponse | null;
  /** `Date.now()` when `plan` arrived. */
  readonly planLoadedAt: number;
  /** Why the latest attempt to read the plan failed, or null. */
  readonly planError: unknown;
  /** Reads the plan again; settles when that attempt is over, whatever its outcome. */
  readonly reload: () => Promise<void>;
}

/** The search field appears once the list is long enough to need one. */
const SEARCH_FROM_ROWS = 8;
/** Groups that cannot be pushed show this many rows until the operator asks for all. */
const COLLAPSED_ROWS = 25;

const NO_ROWS: readonly PushPlanRow[] = [];

const GROUP_TEST_ID: { readonly [K in PushGroupId]: string } = {
  waiting: 'push-group-waiting',
  blocked: 'push-group-blocked',
  up_to_date: 'push-group-up-to-date',
  nothing_assigned: 'push-group-nothing-assigned',
};

const STATIC_ICON: { readonly [K in Exclude<PushGroupId, 'waiting'>]: IconComponent } = {
  blocked: CircleExclamationPoint,
  up_to_date: CircleCheck,
  nothing_assigned: CircleDashed,
};

/**
 * How long one push request may take before the dialog stops waiting for it. The API client
 * has no time limit of its own and a push cannot be cancelled, so without this a request
 * that never answers would hold the dialog for ever.
 */
const PUSH_TIMEOUT_MS = 60_000;
/** How long the dialog waits for the list to refresh after a push before it lets go. */
const RELOAD_TIMEOUT_MS = 15_000;

function pushTimedOut(): ApiRequestError {
  return new ApiRequestError({
    status: 0,
    code: 'network_error',
    message: 'The server did not answer within a minute.',
    fromApi: false,
  });
}

function freshKey(): string {
  return newPushKey(() => crypto.randomUUID());
}

/**
 * The "Push to screens" dialog (docs/portal-v2/stage-a.md, 3.9). `PushProvider` mounts a
 * new instance for every opening (by `key`), so the selection, the results and the
 * Idempotency-Key all start fresh each time the dialog opens.
 */
export function PushDialog({
  open,
  onClose,
  only,
  preselect,
  plan,
  planLoadedAt,
  planError,
  reload,
}: PushDialogProps) {
  const [state, setState] = useState<PushDialogState>(() => openDialogState(freshKey()));
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [scopeLifted, setScopeLifted] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<PushGroupId>>(new Set());

  // Each plan that arrives is applied once: the first seeds the default selection for the
  // screens the caller asked for, a later one only drops ticks that can no longer be pushed.
  const [appliedPlan, setAppliedPlan] = useState<PushPlanResponse | null>(null);
  if (plan !== null && plan !== appliedPlan) {
    setAppliedPlan(plan);
    setState((current) =>
      current.seeded
        ? withPlan(current, plan.items)
        : withPlan(current, scopeRows(plan.items, only), preselect),
    );
  }

  const items = plan?.items ?? NO_ROWS;
  const scope = scopeLifted ? undefined : only;
  const rows = useMemo(() => scopeRows(items, scope), [items, scope]);
  const visible = useMemo(() => searchRows(rows, query), [rows, query]);
  const groups = useMemo(() => groupRows(visible), [visible]);

  const selectableCount = selectableIds(rows).length;
  const sendIds = selectedInOrder(rows, state.selected);
  const attempt = state.lastAttempt;
  const report = attempt === null ? null : reportAttempt(summariseAttempt(attempt));
  const idle = attempt === null ? nothingWaitingNotice(rows) : null;
  const loading = plan === null && planError === null;

  const push = () => {
    if (busy || sendIds.length === 0) return;
    const requestedIds = sendIds;
    const key = keyForPush(state, requestedIds, freshKey);
    setBusy(true);
    void (async () => {
      const results: PushResult[] = [];
      let failure: unknown = null;
      // One request carries at most 200 screens. Every batch repeats the same key, which
      // the API holds per screen, so a retry after a failure cannot push a screen twice.
      for (const batch of batchIds(requestedIds)) {
        try {
          const answer = await withTimeout(api.push(batch, key), PUSH_TIMEOUT_MS, pushTimedOut);
          results.push(...answer.results);
        } catch (error) {
          failure = error;
          break;
        }
      }
      const finished: PushAttempt = { requestedIds, results, failure, key };
      const nextKey = freshKey();
      setState((current) => afterAttempt(current, finished, () => nextKey));
      // What is waiting has changed, or may have: the rows and the header count follow the API.
      // A refresh that fails is reported above the list; a slow one lands when it lands.
      await withTimeout(reload(), RELOAD_TIMEOUT_MS, () => new Error('slow refresh')).catch(
        () => undefined,
      );
      setBusy(false);
    })();
  };

  const refresh = () => {
    if (busy || refreshing) return;
    setRefreshing(true);
    void reload().then(() => {
      setRefreshing(false);
    });
  };

  // The answer of a push is written at the top of the list, which may be scrolled away.
  const outcomeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (attempt !== null) outcomeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [attempt]);

  // Nothing is ticked and nothing is in flight: either the push was answered in full, or
  // no listed screen has changes waiting. The one button then closes the dialog.
  const settled = plan !== null && !busy && sendIds.length === 0;
  const answered = report !== null && attempt?.failure === null;
  const done = settled && (answered || selectableCount === 0);
  // Why the push button does nothing, while it is the button shown and the list is loaded.
  const hint =
    done || busy || plan === null ? null : pushBlockedReason(selectableCount, sendIds.length);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      busy={busy}
      className="tx-push-dialog"
      title="Push to screens"
      description="A push hands a new version to the player of each ticked screen. A screen changes when its player has downloaded and verified it."
      footerStart={
        selectableCount > 0 ? (
          <span className="tx-num" data-testid="push-selected-count" aria-live="polite">
            {sendIds.length} of {selectableCount} selected
          </span>
        ) : undefined
      }
      footer={
        <>
          {!done && (
            <Button variant="secondary" onClick={onClose} disabled={busy} data-testid="push-cancel">
              {attempt === null ? 'Cancel' : 'Close'}
            </Button>
          )}
          <Tooltip content={hint ?? ''} describe={hint !== null} disabled={hint === null}>
            {done ? (
              <Button
                variant={report === null ? 'secondary' : 'primary'}
                onClick={onClose}
                data-testid="push-done"
              >
                {report === null ? 'Close' : 'Done'}
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={Send}
                busy={busy}
                aria-disabled={sendIds.length === 0 || undefined}
                onClick={push}
                data-testid="push-submit"
              >
                {pushButtonLabel(sendIds.length, isRetryOf(state, sendIds))}
              </Button>
            )}
          </Tooltip>
        </>
      }
    >
      {/* Focus starts here, at the top of the content: the list is still loading when the
          dialog opens, and the first Tab then reaches the search field and the screens. */}
      <div className="tx-push" tabIndex={-1} data-autofocus data-testid="push-dialog-body">
        {attempt !== null && (
          <div ref={outcomeRef} className="tx-push__outcome" data-testid="push-outcome">
            {report !== null && (
              <div data-testid="push-summary" data-tone={report.tone}>
                <Banner tone={report.tone} title={report.title} live="polite">
                  {report.lines.length === 1 ? (
                    <p>{report.lines[0]}</p>
                  ) : (
                    <ul>
                      {report.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </Banner>
              </div>
            )}
            {attempt.failure !== null && (
              <div data-testid="push-error">
                <AttemptError attempt={attempt} />
              </div>
            )}
          </div>
        )}

        {loading && <PlanSkeleton />}

        {plan === null && planError !== null && (
          <ErrorNotice
            error={planError}
            title="The list of screens could not be loaded"
            onRetry={refresh}
          />
        )}

        {plan !== null && (
          <>
            {planError !== null && (
              <ErrorNotice
                error={planError}
                title="The list could not be refreshed and may be out of date"
                onRetry={refresh}
              />
            )}

            {items.length === 0 ? (
              <div data-testid="push-empty">
                <EmptyState
                  variant="inline"
                  icon={Monitor}
                  title="No screens yet"
                  action={
                    <ButtonLink variant="primary" to="/screens/new" icon={Plus} onClick={onClose}>
                      Add screen
                    </ButtonLink>
                  }
                >
                  Add a screen and assign a playlist or a schedule to it, then push from here.
                </EmptyState>
              </div>
            ) : (
              <>
                <div className="tx-push__tools">
                  {rows.length > SEARCH_FROM_ROWS ? (
                    <SearchField
                      className="tx-push__search"
                      label="Search screens"
                      value={query}
                      onChange={setQuery}
                      data-testid="push-search"
                    />
                  ) : (
                    <p className="tx-push__count tx-muted" data-testid="push-count">
                      {scope === undefined
                        ? screenCount(rows.length)
                        : `Showing ${rows.length} of ${screenCount(items.length)}`}
                    </p>
                  )}
                  {scope !== undefined && items.length > rows.length && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setScopeLifted(true);
                      }}
                      data-testid="push-show-all-screens"
                    >
                      Show all screens
                    </Button>
                  )}
                  <IconButton
                    icon={RefreshCw}
                    label="Refresh list"
                    disabled={busy || refreshing}
                    onClick={refresh}
                    data-testid="push-refresh"
                  />
                </div>

                {idle !== null && (
                  <div data-testid="push-idle">
                    <Banner tone={idle.tone} title={idle.title}>
                      <p>{idle.text}</p>
                    </Banner>
                  </div>
                )}

                {rows.length === 0 && (
                  <EmptyState variant="inline" icon={Monitor} title="No screens to show">
                    The screens this push was opened for are no longer in the list.
                  </EmptyState>
                )}

                {rows.length > 0 && visible.length === 0 && (
                  <EmptyState
                    variant="inline"
                    icon={SearchX}
                    title="No screens match the search"
                    action={
                      <Button
                        onClick={() => {
                          setQuery('');
                        }}
                      >
                        Clear search
                      </Button>
                    }
                  />
                )}

                {groups.map((group) => (
                  <GroupSection
                    key={group.id}
                    group={group}
                    state={state}
                    disabled={busy}
                    now={planLoadedAt}
                    expanded={expanded.has(group.id)}
                    onExpand={() => {
                      setExpanded((current) => new Set(current).add(group.id));
                    }}
                    onSelection={(selected) => {
                      setState((current) => withSelection(current, selected));
                    }}
                    onNavigate={onClose}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The failure of a whole request, with what it means for the screens. */
function AttemptError({ attempt }: { readonly attempt: PushAttempt }) {
  const unknown = classifyPushFailure(attempt.failure) === 'unknown';
  return (
    <div className="tx-stack tx-stack--tight">
      <ErrorNotice
        error={attempt.failure}
        title={unknown ? 'The push did not complete' : 'The push was refused'}
      />
      <p className="tx-small tx-muted">
        {unknown
          ? 'It is not known whether every ticked screen was given a new version. Retrying is safe: the same request key is sent again, so no screen is given a second version.'
          : attempt.results.length === 0
            ? 'Nothing was pushed by this request.'
            : 'The screens listed as pushed keep their new version. Nothing was pushed to the others.'}
      </p>
    </div>
  );
}

function PlanSkeleton() {
  return (
    <SkeletonGroup label="Loading screens" className="tx-push__skeleton">
      <Skeleton width="140px" height="16px" />
      <div className="tx-push-list" data-testid="push-loading">
        {[0, 1, 2].map((index) => (
          <div key={index} className="tx-push-row tx-push-row--skeleton">
            <div className="tx-push-row__main tx-push-row__main--static">
              <Skeleton variant="block" width="18px" height="18px" />
              <span className="tx-push-row__text">
                <Skeleton width="180px" height="14px" />
                <Skeleton width="120px" />
              </span>
            </div>
            <Skeleton variant="pill" width="96px" height="24px" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

function GroupSection({
  group,
  state,
  disabled,
  now,
  expanded,
  onExpand,
  onSelection,
  onNavigate,
}: {
  readonly group: PushGroup;
  readonly state: PushDialogState;
  readonly disabled: boolean;
  readonly now: number;
  readonly expanded: boolean;
  readonly onExpand: () => void;
  readonly onSelection: (selected: ReadonlySet<string>) => void;
  readonly onNavigate: () => void;
}) {
  const titleId = `push-group-${group.id}-title`;
  const ids = group.rows.map((row) => row.display.id);
  const summary = summariseSelection(ids, state.selected);
  const collapsed = !group.selectable && !expanded && group.rows.length > COLLAPSED_ROWS;
  const shown = collapsed ? group.rows.slice(0, COLLAPSED_ROWS) : group.rows;

  return (
    <section
      className="tx-push-group"
      aria-labelledby={titleId}
      data-testid={GROUP_TEST_ID[group.id]}
    >
      <div className="tx-push-group__head">
        <h3 id={titleId} className="tx-push-group__title">
          {group.title} <span className="tx-push-group__count tx-num">{group.rows.length}</span>
        </h3>
        <p className="tx-push-group__note">{group.note}</p>
      </div>
      <div className="tx-push-list">
        {group.selectable && group.rows.length > 1 && (
          <div className="tx-push-list__all">
            <Checkbox
              checked={summary === 'all'}
              mixed={summary === 'some'}
              disabled={disabled}
              label="Select all"
              aria-label={`Select all ${screenCount(group.rows.length)} with changes waiting`}
              onChange={() => {
                onSelection(toggleAll(ids, state.selected));
              }}
              data-testid="push-select-all"
            />
          </div>
        )}
        <ul className="tx-push-rows">
          {shown.map((row) => (
            <PushRow
              key={row.display.id}
              row={row}
              group={group}
              result={resultFor(state.results, row.display.id)}
              checked={state.selected.has(row.display.id)}
              disabled={disabled}
              now={now}
              onToggle={() => {
                onSelection(toggleOne(state.selected, row.display.id));
              }}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
        {collapsed && (
          <div className="tx-push-list__more">
            <Button variant="ghost" size="sm" onClick={onExpand} data-testid="push-show-all">
              Show all {screenCount(group.rows.length)}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function PushRow({
  row,
  group,
  result,
  checked,
  disabled,
  now,
  onToggle,
  onNavigate,
}: {
  readonly row: PushPlanRow;
  readonly group: PushGroup;
  readonly result: PushResult | undefined;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly now: number;
  readonly onToggle: () => void;
  readonly onNavigate: () => void;
}) {
  const view = presentRow(row, result);
  const lastPushed = lastPushedLabel(row, now);
  const name = <span className="tx-push-row__name">{row.display.name}</span>;
  const meta = (
    <span className="tx-push-row__meta">
      {row.schedule !== null ? (
        <span className="tx-push-row__playlist" title={`Schedule: ${row.schedule.name}`}>
          <Icon icon={CalendarDays} size={14} />
          <span className="tx-push-row__playlist-name">Schedule: {row.schedule.name}</span>
        </span>
      ) : row.playlist === null ? (
        <span>Nothing assigned</span>
      ) : (
        <span className="tx-push-row__playlist" title={row.playlist.name}>
          <Icon icon={ListVideo} size={14} />
          <span className="tx-visually-hidden">Playlist: </span>
          <span className="tx-push-row__playlist-name">{row.playlist.name}</span>
        </span>
      )}
      {lastPushed !== null && <span>{lastPushed}</span>}
    </span>
  );

  return (
    <li
      className="tx-push-row"
      data-testid={`push-row-${row.display.id}`}
      data-state={row.state}
      data-outcome={result?.outcome}
    >
      {group.id === 'waiting' ? (
        <Checkbox
          className="tx-push-row__main"
          checked={checked}
          disabled={disabled}
          label={name}
          hint={meta}
          onChange={onToggle}
          data-testid={`push-row-check-${row.display.id}`}
        />
      ) : (
        <div className="tx-push-row__main tx-push-row__main--static">
          <span className="tx-push-row__lead">
            <Icon icon={STATIC_ICON[group.id]} size={18} />
          </span>
          <span className="tx-push-row__text">
            {name}
            {meta}
          </span>
        </div>
      )}
      <div className="tx-push-row__side">
        <span data-testid="push-row-status">
          {result === undefined ? (
            <PushStatePill state={row.state} testId="push-row-state" />
          ) : (
            <StatusPill tone={view.pill.tone}>{view.pill.label}</StatusPill>
          )}
        </span>
        {row.schedule !== null && view.issues.length > 0 && (
          <ButtonLink
            variant="secondary"
            size="sm"
            to={`/schedules/${row.schedule.id}`}
            onClick={onNavigate}
          >
            Open schedule
            <span className="tx-visually-hidden"> {row.schedule.name}</span>
          </ButtonLink>
        )}
        {row.schedule === null && row.playlist !== null && view.issues.length > 0 && (
          <ButtonLink
            variant="secondary"
            size="sm"
            to={`/playlists/${row.playlist.id}`}
            onClick={onNavigate}
          >
            Open playlist
            <span className="tx-visually-hidden"> {row.playlist.name}</span>
          </ButtonLink>
        )}
        {group.id === 'nothing_assigned' && (
          <ButtonLink
            variant="secondary"
            size="sm"
            to={`/screens/${row.display.id}`}
            onClick={onNavigate}
          >
            Open screen
            <span className="tx-visually-hidden"> {row.display.name}</span>
          </ButtonLink>
        )}
      </div>
      {view.issues.length > 0 && (
        <ul className="tx-push-row__issues" data-testid="push-row-issues">
          {view.issues.map((issue, index) => (
            <li key={index}>
              {issue.message} <span className="tx-code">{issue.code}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
