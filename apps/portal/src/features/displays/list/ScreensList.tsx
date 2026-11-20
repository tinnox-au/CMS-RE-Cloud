import type { DisplayDto, PlaylistSummaryDto } from '@tinnox/contracts';
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../../api/index.ts';
import {
  anyHasOtherContent,
  assignedContent,
  CONTENT_KIND_LABEL,
  CONTENT_REPLACED_NOTE,
  contentHref,
} from '../../../lib/assignedContent.ts';
import { mergeBulkOutcomes, runInSequence, type BulkOutcome } from '../../../lib/bulkOutcome.ts';
import {
  applyListView,
  countLabel,
  DEFAULT_PAGE_SIZE,
  type SortState,
} from '../../../lib/listView.ts';
import {
  assignedDetail,
  assignedMessage,
  buildScreenRows,
  canvasLabel,
  commonPlaylistId,
  countByStatusFilter,
  formatStatusFilter,
  matchesStatusFilter,
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
  toggleStatusFilter,
  type ScreenListView,
  type ScreenRow,
  type ScreenStatusFilter,
} from '../../../lib/screensList.ts';
import { revokeOutcomeText } from '../../../lib/screenDetail.ts';
import { pruneSelection, selectedRows, toggleOne } from '../../../lib/selection.ts';
import { matchesTagFilter } from '../../../lib/tagColours.ts';
import {
  LayoutGrid,
  List,
  ListVideo,
  Monitor,
  Plus,
  RefreshCw,
  SearchX,
  Send,
  Tags,
} from '../../../ui/icons.ts';
import {
  Banner,
  Button,
  ButtonLink,
  Chip,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorNotice,
  IconButton,
  NameCell,
  Pagination,
  SearchField,
  Segmented,
  SelectionBar,
  Skeleton,
  SkeletonGroup,
  Tile,
  TileGrid,
  TileSkeleton,
  useToast,
  type DataTableColumn,
} from '../../../ui/index.ts';
import { useCan } from '../../../session/AuthenticatedSession.tsx';
import { Page } from '../../../shell/Page.tsx';
import { usePush } from '../../push/PushContext.tsx';
import {
  PlaylistPickerDialog,
  PushStatePill,
  ScreenStatusPill,
  TagChips,
  TagFilter,
  TagsDialog,
  useTags,
} from '../../shared/index.ts';
import { ScreenFrame } from './ScreenFrame.tsx';
import { AssignFailureNotice, PartialNotice, type AssignFailure } from './ScreenNotices.tsx';
import { ScreenRowMenu } from './ScreenRowMenu.tsx';
import './screensList.css';
import { useScreensData } from './useScreensData.ts';

const DEFAULT_SORT: SortState = { columnId: 'name', direction: 'asc' };

const VIEW_OPTIONS = [
  { value: 'list', label: 'List', icon: List },
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
] as const;

interface AssignState {
  readonly open: boolean;
  /** Kept after closing, so the dialog's words do not change while it leaves. */
  readonly targets: readonly DisplayDto[];
  readonly busy: boolean;
  readonly error: unknown;
}

interface TagsState {
  readonly open: boolean;
  readonly targets: readonly DisplayDto[];
}

interface RevokeState {
  readonly open: boolean;
  readonly target: DisplayDto | null;
  readonly busy: boolean;
}

interface RevokeOutcome {
  readonly name: string;
  /** What the revocation did, from revokeOutcomeText. */
  readonly text: string;
}

function rowId(row: ScreenRow): string {
  return row.display.id;
}

/**
 * The screens list (docs/portal-v2/stage-a.md, 3.6): search, status and tag filters, a table
 * or a grid of canvas-shaped tiles, and the actions on one screen or on the ticked ones.
 * The status of every screen is what its player last reported and is read again every ten
 * seconds; the age of each report keeps counting in between.
 */
export function ScreensList() {
  const data = useScreensData();
  const { displays, sites, statuses, reloadDisplays, reloadSites, reloadStatuses, mergeDisplays } =
    data;
  const tags = useTags('display');
  const { plan, planError, refresh: refreshPush, openDialog: openPushDialog } = usePush();
  const toast = useToast();
  const canSetup = useCan('screen.setup');
  const canAssign = useCan('screen.assign');
  const canPush = useCan('push.publish');
  const canDetails = useCan('screen.details');
  const canPair = useCan('screen.pair');
  // Selection is offered while one bulk action is left; the row menu while one row action is.
  const canSelect = canAssign || canDetails || canPush;
  const hasRowMenu = canSelect || canPair;

  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const statusFilter = useMemo(() => parseStatusFilter(statusParam), [statusParam]);
  const view = parseListView(params.get('view'));

  const [query, setQuery] = useState('');
  const [tagFilterRaw, setTagFilter] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selectedRaw, setSelected] = useState<ReadonlySet<string>>(new Set());

  const [assign, setAssign] = useState<AssignState>({
    open: false,
    targets: [],
    busy: false,
    error: null,
  });
  const [assignFailure, setAssignFailure] = useState<AssignFailure | null>(null);
  const [assignRetrying, setAssignRetrying] = useState(false);
  const [tagsDialog, setTagsDialog] = useState<TagsState>({ open: false, targets: [] });
  const [revoke, setRevoke] = useState<RevokeState>({ open: false, target: null, busy: false });
  const [revokeOutcome, setRevokeOutcome] = useState<RevokeOutcome | null>(null);
  const [revokeError, setRevokeError] = useState<{
    readonly name: string;
    readonly error: unknown;
  } | null>(null);

  const displayList = displays.status === 'ready' ? displays.data : null;
  const siteList = sites.status === 'ready' ? sites.data : null;
  const statusList = statuses.status === 'ready' ? statuses.data : null;
  const statusFetchedAt = statuses.status === 'ready' ? statuses.fetchedAt : undefined;

  const rows = useMemo(
    () =>
      buildScreenRows({
        displays: displayList ?? [],
        sites: siteList,
        statuses: statusList,
        plan,
      }),
    [displayList, siteList, statusList, plan],
  );

  // A tag that was deleted somewhere else stops filtering.
  const tagFilter = useMemo(
    () => (tags.status === 'ready' ? pruneSelection(tagFilterRaw, tags.byId.keys()) : tagFilterRaw),
    [tagFilterRaw, tags.status, tags.byId],
  );
  const list = useMemo(
    () =>
      applyListView(rows, {
        search: { query, texts: screenSearchTexts },
        filters: [
          (row) => matchesStatusFilter(row.statusKind, statusFilter),
          (row) => matchesTagFilter(row.display.tagIds, tagFilter),
        ],
        sort,
        accessors: SCREEN_SORT_ACCESSORS,
        page,
        pageSize,
      }),
    [rows, query, statusFilter, tagFilter, sort, page, pageSize],
  );

  // Screens that are no longer listed (gone, or hidden by the search, status or tag filter)
  // leave the selection, as in the media library: the selection bar and every bulk action
  // only ever count and act on screens the operator can see. Ticks on other pages stay,
  // because `matched` covers every page.
  const selected = useMemo(
    () =>
      displayList === null ? selectedRaw : pruneSelection(selectedRaw, list.matched.map(rowId)),
    [selectedRaw, displayList, list.matched],
  );

  const statusCounts = useMemo(
    // No counts until both the screens and their statuses are known: never a misleading 0.
    () => (statusList === null || displayList === null ? null : countByStatusFilter(rows)),
    [rows, statusList, displayList],
  );

  const setParam = useCallback(
    (name: string, value: string | null) => {
      // Built from the address itself: the router's functional updater hands over the
      // last rendered params, so two quick changes in a row would undo the first.
      const next = new URLSearchParams(window.location.search);
      if (value === null) next.delete(name);
      else next.set(name, value);
      setParams(next, { replace: true });
    },
    [setParams],
  );

  const setStatusFilter = (next: ReadonlySet<ScreenStatusFilter>) => {
    setParam('status', formatStatusFilter(next));
    setPage(1);
  };

  const setView = (next: ScreenListView) => {
    setParam('view', next === 'grid' ? 'grid' : null);
  };

  const filtering = query.trim() !== '' || statusFilter.size > 0 || tagFilter.size > 0;
  const clearFilters = () => {
    setQuery('');
    setTagFilter(new Set());
    setStatusFilter(new Set());
  };

  const refreshAll = () => {
    reloadDisplays();
    reloadStatuses();
    if (sites.status !== 'ready') reloadSites();
    tags.reload();
    refreshPush();
  };

  // ---- Assign content -------------------------------------------------------------------

  const openAssign = (targets: readonly DisplayDto[]) => {
    if (targets.length === 0) return;
    setAssign({ open: true, targets, busy: false, error: null });
  };

  const applyAssignment = useCallback(
    async (
      todo: readonly DisplayDto[],
      playlistId: string | null,
    ): Promise<BulkOutcome<DisplayDto, DisplayDto>> => {
      const outcome = await runInSequence(todo, (display) =>
        api.patchDisplay(display.id, { assignedPlaylistId: playlistId }),
      );
      if (outcome.done.length > 0) {
        mergeDisplays(outcome.done.map((entry) => entry.result));
        refreshPush();
      }
      return outcome;
    },
    [mergeDisplays, refreshPush],
  );

  const confirmAssign = (playlist: PlaylistSummaryDto | null) => {
    const targets = assign.targets;
    const todo = screensToAssign(targets, playlist?.id ?? null);
    if (todo.length === 0) {
      // Every screen already has this choice: there is nothing to send and nothing to report.
      setAssign((state) => ({ ...state, open: false }));
      return;
    }
    setAssign((state) => ({ ...state, busy: true, error: null }));
    setAssignFailure(null);
    void applyAssignment(todo, playlist?.id ?? null).then((outcome) => {
      const first = outcome.failed[0];
      if (first === undefined) {
        setAssign((state) => ({ ...state, open: false, busy: false }));
        // "No playlist" leaves a schedule or a layout in place (the API clears only the kind it
        // is sent). The list's copy may predate one assigned elsewhere: then nothing was removed.
        const kept =
          playlist === null
            ? outcome.done
                .map((entry) => ({
                  name: entry.result.name,
                  kind: assignedContent(entry.result)?.kind,
                }))
                .find((entry) => entry.kind !== undefined)
            : undefined;
        if (kept?.kind !== undefined) {
          toast.info(`${kept.name} now has a ${kept.kind}`, {
            detail: `Its ${kept.kind} stays assigned. To remove it, use "Remove content" on the screen's page.`,
          });
          return;
        }
        toast.success(
          assignedMessage(
            outcome.done.map((entry) => entry.item),
            playlist?.name ?? null,
          ),
          { detail: assignedDetail(playlist?.name ?? null, outcome.done.length) },
        );
        return;
      }
      if (targets.length === 1) {
        // One screen: the refusal is shown in the dialog, which stays open.
        setAssign((state) => ({ ...state, busy: false, error: first.error }));
        return;
      }
      setAssign((state) => ({ ...state, open: false, busy: false }));
      setAssignFailure({
        playlist: playlist === null ? null : { id: playlist.id, name: playlist.name },
        failed: outcome.failed,
        doneCount: outcome.done.length,
        total: todo.length,
      });
    });
  };

  const retryAssign = () => {
    const failure = assignFailure;
    if (failure === null || assignRetrying) return;
    setAssignRetrying(true);
    void applyAssignment(
      failure.failed.map((entry) => entry.item),
      failure.playlist?.id ?? null,
    ).then((retry) => {
      setAssignRetrying(false);
      const merged = mergeBulkOutcomes({ done: [], failed: failure.failed }, retry);
      const doneCount = failure.doneCount + merged.done.length;
      if (merged.failed.length === 0) {
        setAssignFailure(null);
        toast.success(assignedMessage(doneCount, failure.playlist?.name ?? null), {
          detail: assignedDetail(failure.playlist?.name ?? null, doneCount),
        });
        return;
      }
      setAssignFailure({ ...failure, failed: merged.failed, doneCount });
    });
  };

  const assignTargets = assign.targets;
  const assignSingle = assignTargets.length === 1 ? (assignTargets[0] ?? null) : null;
  const assignCurrentId = commonPlaylistId(assignTargets);

  // ---- Push, tags, revoke ---------------------------------------------------------------

  const pushTo = (targets: readonly DisplayDto[]) => {
    if (targets.length === 0) return;
    const ids = targets.map((display) => display.id);
    openPushDialog({ only: ids, preselect: ids });
  };

  const openTags = (targets: readonly DisplayDto[]) => {
    if (targets.length === 0) return;
    setTagsDialog({ open: true, targets });
  };

  const askRevoke = (display: DisplayDto) => {
    setRevoke({ open: true, target: display, busy: false });
  };

  const confirmRevoke = () => {
    const target = revoke.target;
    if (target === null || revoke.busy) return;
    setRevoke((state) => ({ ...state, busy: true }));
    setRevokeError(null);
    setRevokeOutcome(null);
    api
      .revokePlayer(target.id)
      .then((result) => {
        setRevokeOutcome({
          name: target.name,
          text: revokeOutcomeText(result.revokedRegistrationId, result.cancelledPairingCount),
        });
        reloadDisplays();
        reloadStatuses();
      })
      .catch((error: unknown) => {
        setRevokeError({ name: target.name, error });
      })
      .finally(() => {
        setRevoke((state) => ({ ...state, open: false, busy: false }));
      });
  };

  const selectedDisplays = (): DisplayDto[] =>
    selectedRows(list.matched, selected, rowId).map((row) => row.display);

  // ---- Cells ----------------------------------------------------------------------------

  const statusCell = (row: ScreenRow) => (
    <ScreenStatusPill
      view={row.view}
      fetchedAt={statusFetchedAt}
      loading={statuses.status === 'loading'}
      testId="screens-status"
    />
  );

  const contentCell = (row: ScreenRow) => {
    const content = assignedContent(row.display);
    // A playlist reads as its name alone; a schedule or a layout says which it is.
    const label =
      content === null || content.kind === 'playlist'
        ? content?.name
        : `${CONTENT_KIND_LABEL[content.kind]}: ${content.name}`;
    const marker = pushMarkerFor(row);
    return (
      <span className="tx-screens-content" data-testid="screens-content">
        {content !== null ? (
          <Link
            className="tx-screens-content__link"
            to={contentHref(content.kind, content.id)}
            title={label}
          >
            {label}
          </Link>
        ) : (
          <span className="tx-muted">Nothing assigned</span>
        )}
        {marker !== null && <PushStatePill state={marker} testId="screens-push-state" />}
      </span>
    );
  };

  const siteCell = (row: ScreenRow) => {
    if (row.siteName !== null) return <span className="tx-muted">{row.siteName}</span>;
    if (sites.status === 'loading') return <Skeleton width="96px" />;
    return <span className="tx-muted">Not loaded</span>;
  };

  const menuFor = (row: ScreenRow) => (
    <ScreenRowMenu
      row={row}
      onAssign={
        canAssign
          ? (display) => {
              openAssign([display]);
            }
          : undefined
      }
      onPush={
        canPush
          ? (display) => {
              pushTo([display]);
            }
          : undefined
      }
      onEditTags={
        canDetails
          ? (display) => {
              openTags([display]);
            }
          : undefined
      }
      onRevoke={canPair ? askRevoke : undefined}
    />
  );

  const columns: readonly DataTableColumn<ScreenRow>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      grow: true,
      cell: (row) => (
        <NameCell
          name={row.display.name}
          to={`/screens/${row.display.id}`}
          media={<ScreenFrame display={row.display} size="lead" />}
          meta={row.display.description ?? undefined}
        />
      ),
    },
    { id: 'status', header: 'Status', sortable: true, cell: statusCell },
    {
      id: 'content',
      header: 'Content',
      sortable: true,
      priority: 2,
      width: '184px',
      cell: contentCell,
    },
    // Tags outlast Site and Canvas: at 1280 and 1366 px the tags still show (section 3.6).
    { id: 'site', header: 'Site', sortable: true, nowrap: true, priority: 4, cell: siteCell },
    {
      id: 'canvas',
      header: 'Canvas',
      sortable: true,
      numeric: true,
      priority: 4,
      cell: (row) => <span className="tx-muted">{canvasLabel(row.display)}</span>,
    },
    {
      id: 'tags',
      header: 'Tags',
      priority: 3,
      width: '144px',
      cell: (row) => <TagChips tags={tags} tagIds={row.display.tagIds} />,
    },
  ];

  // ---- States ---------------------------------------------------------------------------

  if (displays.status === 'error') {
    return (
      <Page title="Screens">
        <ErrorNotice
          error={displays.error}
          title="The screens could not be loaded"
          onRetry={reloadDisplays}
        />
      </Page>
    );
  }

  const loading = displays.status === 'loading';
  const statusFilterWaiting = statusFilter.size > 0 && statusList === null;
  const tableLoading = loading || (statusFilterWaiting && statuses.status === 'loading');

  if (!loading && rows.length === 0) {
    return (
      <Page title="Screens">
        <div className="tx-stack" data-testid="screens-empty">
          {displays.refreshError !== null && (
            <ErrorNotice
              error={displays.refreshError}
              title="The list could not be refreshed"
              onRetry={reloadDisplays}
            />
          )}
          <EmptyState
            icon={Monitor}
            title="No screens yet"
            action={
              canSetup ? (
                <ButtonLink
                  variant="primary"
                  size="lg"
                  to="/screens/new"
                  icon={Plus}
                  data-testid="screens-add"
                >
                  Add screen
                </ButtonLink>
              ) : undefined
            }
          >
            {canSetup
              ? 'Add a screen to set its canvas, pair its player, and assign a playlist to it.'
              : 'An editor adds screens.'}
          </EmptyState>
        </div>
      </Page>
    );
  }

  const empty =
    statusFilterWaiting && statuses.status === 'error' ? (
      <EmptyState
        variant="inline"
        icon={SearchX}
        title="Status is not known"
        action={
          <Button variant="secondary" onClick={clearFilters} data-testid="screens-clear-filters">
            Clear filters
          </Button>
        }
      >
        The list cannot be filtered by status until the status of the screens has loaded.
      </EmptyState>
    ) : (
      <EmptyState
        variant="inline"
        icon={SearchX}
        title="No screen matches"
        action={
          <Button variant="secondary" onClick={clearFilters} data-testid="screens-clear-filters">
            Clear filters
          </Button>
        }
      >
        No screen fits the search and filters that are set.
      </EmptyState>
    );

  const pagination = (
    <Pagination
      info={list.info}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );

  const countText = loading
    ? 'Loading screens'
    : filtering
      ? `${list.matched.length} of ${countLabel(list.total, 'screen')}, as each player last reported.`
      : `${countLabel(list.total, 'screen')}, as each player last reported.`;

  return (
    <Page
      title="Screens"
      subtitle={
        <span aria-live="polite" data-testid="screens-count">
          {countText}
        </span>
      }
      actions={
        canSetup ? (
          <ButtonLink
            variant="secondary"
            to="/screens/new"
            icon={Plus}
            className="tx-screens-add"
            title="Add screen"
            data-testid="screens-add"
          >
            {/* Under 1100 px only the icon shows; the name stays for assistive technology. */}
            <span className="tx-screens-add__label">Add screen</span>
          </ButtonLink>
        ) : undefined
      }
    >
      <div className="tx-stack tx-screens">
        {displays.status === 'ready' && displays.refreshError !== null && (
          <ErrorNotice
            error={displays.refreshError}
            title="The list could not be refreshed"
            onRetry={reloadDisplays}
          />
        )}
        {statuses.status === 'error' && (
          <div data-testid="screens-status-error">
            <ErrorNotice
              error={statuses.error}
              title="The status of the screens could not be loaded"
              onRetry={reloadStatuses}
            />
          </div>
        )}
        {statuses.status === 'ready' && statuses.refreshError !== null && (
          <PartialNotice
            testId="screens-status-stale"
            title="The status could not be refreshed"
            note="The list shows what was last received, and the age of each report keeps counting."
            error={statuses.refreshError}
            onRetry={reloadStatuses}
          />
        )}
        {sites.status === 'error' && (
          <PartialNotice
            testId="screens-sites-error"
            title="The sites could not be loaded"
            note="The screens are listed without their site."
            error={sites.error}
            onRetry={reloadSites}
          />
        )}
        {planError !== null && (
          <PartialNotice
            testId="screens-plan-error"
            title="The push state could not be read"
            note="The Content column may not show which screens have changes waiting."
            error={planError}
            onRetry={refreshPush}
          />
        )}
        {assignFailure !== null && (
          <AssignFailureNotice
            failure={assignFailure}
            retrying={assignRetrying}
            onRetry={retryAssign}
            onDismiss={() => {
              setAssignFailure(null);
            }}
          />
        )}
        {revokeError !== null && (
          <ErrorNotice
            error={revokeError.error}
            title={`The player of ${revokeError.name} was not revoked`}
            onDismiss={() => {
              setRevokeError(null);
            }}
          />
        )}
        {revokeOutcome !== null && (
          <div data-testid="screens-revoke-result">
            <Banner
              tone="info"
              live="polite"
              title={revokeOutcome.name}
              onDismiss={() => {
                setRevokeOutcome(null);
              }}
            >
              <p>{revokeOutcome.text}</p>
            </Banner>
          </div>
        )}

        <div className="tx-filter-row">
          <div className="tx-filter-row__filters">
            <SearchField
              label="Search screens"
              value={query}
              onChange={(next) => {
                setQuery(next);
                setPage(1);
              }}
              data-testid="screens-search"
            />
            <div
              className="tx-screens-status"
              role="group"
              aria-label="Filter by status"
              data-testid="screens-status-filter"
            >
              <span className="tx-screens-chip" data-testid="screens-status-all">
                <Chip
                  selected={statusFilter.size === 0}
                  onToggle={() => {
                    setStatusFilter(new Set());
                  }}
                >
                  All
                  {statusCounts !== null && (
                    <>
                      <span className="tx-visually-hidden">, </span>
                      <span className="tx-screens-chip__count">{rows.length}</span>
                    </>
                  )}
                </Chip>
              </span>
              {SCREEN_STATUS_FILTERS.map((value) => (
                <span
                  key={value}
                  className="tx-screens-chip"
                  title={SCREEN_STATUS_FILTER_HINTS[value]}
                  data-testid={`screens-status-${value.replace('_', '-')}`}
                >
                  <Chip
                    selected={statusFilter.has(value)}
                    onToggle={(on) => {
                      setStatusFilter(toggleStatusFilter(statusFilter, value, on));
                    }}
                  >
                    {SCREEN_STATUS_FILTER_LABELS[value]}
                    {statusCounts !== null && (
                      <>
                        {/* Keeps the label and the count apart in the name: "Needs attention, 5". */}
                        <span className="tx-visually-hidden">, </span>
                        <span className="tx-screens-chip__count">{statusCounts[value]}</span>
                      </>
                    )}
                  </Chip>
                </span>
              ))}
            </div>
            <TagFilter
              tags={tags}
              selected={tagFilter}
              onChange={(next) => {
                setTagFilter(next);
                setPage(1);
              }}
              testId="screens-tag-filter"
            />
          </div>
          <div className="tx-filter-row__end">
            <Segmented
              label="View"
              iconOnly
              value={view}
              onChange={setView}
              options={VIEW_OPTIONS}
            />
            <IconButton
              icon={RefreshCw}
              label="Refresh"
              onClick={refreshAll}
              data-testid="screens-refresh"
            />
          </div>
        </div>

        {view === 'list' ? (
          <DataTable
            caption="Screens"
            columns={columns}
            rows={list.rows}
            rowId={rowId}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            selection={
              canSelect
                ? {
                    selected,
                    onChange: setSelected,
                    rowLabel: (row) => row.display.name,
                  }
                : undefined
            }
            rowActions={hasRowMenu ? menuFor : undefined}
            loading={tableLoading}
            empty={empty}
            footer={list.matched.length > 0 ? pagination : undefined}
            rowTestId={(row) => `screens-row-${row.display.id}`}
          />
        ) : tableLoading ? (
          <SkeletonGroup label="Loading screens">
            <TileGrid label="Screens" minTileWidth={240} className="tx-screens-grid">
              {Array.from({ length: 8 }, (_, index) => (
                <TileSkeleton key={index} />
              ))}
            </TileGrid>
          </SkeletonGroup>
        ) : list.rows.length === 0 ? (
          <div className="tx-card tx-card--flush">{empty}</div>
        ) : (
          <>
            <TileGrid label="Screens" minTileWidth={240} className="tx-screens-grid">
              {list.rows.map((row) => (
                <Tile
                  key={row.display.id}
                  name={row.display.name}
                  to={`/screens/${row.display.id}`}
                  testId={`screens-tile-${row.display.id}`}
                  media={<ScreenFrame display={row.display} />}
                  meta={
                    <span className="tx-screens-tile-meta">
                      <span className="tx-num">{canvasLabel(row.display)}</span>
                      {statusCell(row)}
                      {contentCell(row)}
                    </span>
                  }
                  actions={hasRowMenu ? menuFor(row) : undefined}
                  selection={
                    canSelect
                      ? {
                          selected: selected.has(row.display.id),
                          label: row.display.name,
                          onChange: () => {
                            setSelected(toggleOne(selected, row.display.id));
                          },
                        }
                      : undefined
                  }
                />
              ))}
            </TileGrid>
            {pagination}
          </>
        )}

        <p className="tx-small tx-muted tx-screens-note">
          Status is what the player of each screen last reported, with the time of that report. It
          is not proof of what the screen shows.
        </p>

        {canSelect && (
          <SelectionBar
            count={selected.size}
            label="Selected screens"
            onClear={() => {
              setSelected(new Set());
            }}
          >
            {canAssign && (
              <Button
                variant="ghost"
                size="sm"
                icon={ListVideo}
                data-testid="screens-bulk-assign"
                onClick={() => {
                  openAssign(selectedDisplays());
                }}
              >
                Assign content
              </Button>
            )}
            {canDetails && (
              <Button
                variant="ghost"
                size="sm"
                icon={Tags}
                data-testid="screens-bulk-tags"
                onClick={() => {
                  openTags(selectedDisplays());
                }}
              >
                Add tags
              </Button>
            )}
            {canPush && (
              <Button
                variant="ghost"
                size="sm"
                icon={Send}
                data-testid="screens-bulk-push"
                onClick={() => {
                  pushTo(selectedDisplays());
                }}
              >
                Push
              </Button>
            )}
          </SelectionBar>
        )}

        <PlaylistPickerDialog
          open={assign.open}
          onClose={() => {
            setAssign((state) => ({ ...state, open: false }));
          }}
          title={
            assignSingle !== null || assignTargets.length === 0
              ? 'Assign content'
              : `Assign content to ${screensLabel(assignTargets.length)}`
          }
          description={`${
            assignSingle !== null
              ? `Choose the playlist for ${assignSingle.name}. Nothing changes on the screen until you push.`
              : 'Every chosen screen gets this playlist. Nothing changes on a screen until you push.'
          }${anyHasOtherContent(assignTargets) ? ` ${CONTENT_REPLACED_NOTE}` : ''}`}
          confirmLabel={
            assignSingle !== null || assignTargets.length === 0
              ? 'Assign playlist'
              : `Assign to ${screensLabel(assignTargets.length)}`
          }
          currentId={assignCurrentId}
          // shortcut: content cannot be removed from a screen with a schedule or a layout in the list; send all three ids null and say "Content removed" if operators ask.
          allowNone={assignSingle !== null && !anyHasOtherContent([assignSingle])}
          noneHint="The screen keeps what it was last given."
          disabledReason={(playlist) =>
            screensToAssign(assignTargets, playlist.id).length > 0
              ? null
              : assignSingle !== null
                ? 'Assigned to this screen now'
                : 'Every chosen screen has this playlist'
          }
          busy={assign.busy}
          error={assign.error}
          errorTitle="The playlist was not assigned"
          onConfirm={confirmAssign}
          testId="screens-assign"
        />

        <TagsDialog
          open={tagsDialog.open}
          onClose={() => {
            setTagsDialog((state) => ({ ...state, open: false }));
          }}
          items={tagsDialog.targets}
          tags={tags}
          allowCreate={canSetup}
          onSaved={reloadDisplays}
          testId="screens-tags"
        />

        <ConfirmDialog
          open={revoke.open}
          title="Revoke this player?"
          confirmLabel="Revoke player"
          tone="danger"
          busy={revoke.busy}
          onConfirm={confirmRevoke}
          onCancel={() => {
            setRevoke((state) => ({ ...state, open: false }));
          }}
        >
          <p>
            The player paired with “{revoke.target?.name ?? 'this screen'}” will lose access
            immediately. To use it again it must be paired with a new code.
          </p>
        </ConfirmDialog>
      </div>
    </Page>
  );
}
