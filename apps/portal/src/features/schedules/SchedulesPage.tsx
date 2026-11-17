import type { ScheduleSummaryDto } from '@tinnox/contracts';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/index.ts';
import { useLoad, type LoadState } from '../../hooks/useLoad.ts';
import { formatTimestamp } from '../../lib/format.ts';
import { countLabel, sortRows, type SortState } from '../../lib/listView.ts';
import { assignedScreensLabel, modifiedLabel } from '../../lib/playlistsList.ts';
import {
  DEFAULT_SCHEDULE_SORT,
  eventCountLabel,
  filterScheduleList,
  SCHEDULE_SORT_ACCESSORS,
} from '../../lib/schedules.ts';
import { Page } from '../../shell/Page.tsx';
import {
  CalendarDays,
  Ellipsis,
  Plus,
  RefreshCw,
  SearchX,
  SquarePen,
  Trash,
} from '../../ui/icons.ts';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorNotice,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  NameCell,
  SearchField,
  useToast,
  type DataTableColumn,
} from '../../ui/index.ts';
import { CreateScheduleDialog } from './CreateScheduleDialog.tsx';
import { DeleteScheduleDialog } from './DeleteScheduleDialog.tsx';
import './schedules.css';

const loadSchedules = (signal: AbortSignal) => api.listSchedules(signal);
const NO_SCHEDULES: readonly ScheduleSummaryDto[] = [];

/**
 * The schedules list (docs/portal-v2/stage-b.md, slice 3, section 7): search, sorting in the
 * browser, per schedule Edit and Delete, and "Create schedule", which asks for a name and a
 * default playlist and opens the editor.
 */
// shortcut: no grid, bulk selection or pagination; add when an organisation has over 100 schedules.
export function SchedulesPage() {
  const toast = useToast();
  const { state, reload } = useLoad(loadSchedules);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SCHEDULE_SORT);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleSummaryDto | null>(null);
  // The state a refresh was asked from; a new state, good or bad, ends the refresh.
  const [refreshFrom, setRefreshFrom] = useState<LoadState<ScheduleSummaryDto[]> | null>(null);

  const ready = state.status === 'ready';
  const loading = state.status === 'loading';
  const refreshing = refreshFrom !== null && refreshFrom === state;
  const schedules = ready ? state.data : NO_SCHEDULES;
  const searching = query.trim() !== '';
  const rows = useMemo(
    () => sortRows(filterScheduleList(schedules, query), sort, SCHEDULE_SORT_ACCESSORS),
    [schedules, query, sort],
  );

  const refresh = () => {
    setRefreshFrom(state);
    reload();
  };

  const now = new Date();
  const columns: readonly DataTableColumn<ScheduleSummaryDto>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      grow: true,
      cell: (schedule) => (
        <NameCell
          name={schedule.name}
          to={`/schedules/${schedule.id}`}
          media={
            <span className="tx-schedule-icon-tile">
              <Icon icon={CalendarDays} />
            </span>
          }
          meta={schedule.description ?? undefined}
        />
      ),
    },
    {
      id: 'playlist',
      header: 'Default playlist',
      sortable: true,
      priority: 2,
      cell: (schedule) => (
        <Link
          className="tx-schedule-list__link"
          to={`/playlists/${schedule.defaultPlaylist.id}`}
          title={schedule.defaultPlaylist.name}
        >
          {schedule.defaultPlaylist.name}
        </Link>
      ),
    },
    {
      id: 'events',
      header: 'Events',
      sortable: true,
      nowrap: true,
      priority: 3,
      cell: (schedule) => (
        <span className={schedule.eventCount === 0 ? 'tx-muted' : undefined}>
          {eventCountLabel(schedule.eventCount)}
        </span>
      ),
    },
    {
      id: 'screens',
      header: 'Screens',
      sortable: true,
      nowrap: true,
      priority: 2,
      cell: (schedule) => (
        <span className={schedule.assignedDisplayCount === 0 ? 'tx-muted' : undefined}>
          {assignedScreensLabel(schedule.assignedDisplayCount)}
        </span>
      ),
    },
    {
      id: 'updated',
      header: 'Updated',
      sortable: true,
      numeric: true,
      priority: 4,
      cell: (schedule) => (
        <time dateTime={schedule.updatedAt} title={formatTimestamp(schedule.updatedAt)}>
          {modifiedLabel(schedule.updatedAt, now)}
        </time>
      ),
    },
  ];

  const rowMenu = (schedule: ScheduleSummaryDto) => (
    <Menu
      placement="bottom-end"
      trigger={(props) => (
        <IconButton
          {...props}
          icon={Ellipsis}
          label={`Actions for ${schedule.name}`}
          data-testid="schedules-row-menu"
        />
      )}
    >
      <MenuItem icon={SquarePen} to={`/schedules/${schedule.id}`}>
        Edit
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={Trash}
        tone="danger"
        onSelect={() => {
          setDeleteTarget(schedule);
        }}
      >
        Delete
      </MenuItem>
    </Menu>
  );

  const createButton = (size: 'md' | 'lg') => (
    <Button
      variant="primary"
      size={size}
      icon={Plus}
      onClick={() => {
        setCreating(true);
      }}
      data-testid="schedules-create"
    >
      Create schedule
    </Button>
  );

  const dialogs = (
    <>
      <CreateScheduleDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
      />
      <DeleteScheduleDialog
        schedule={deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
        }}
        onDeleted={(schedule) => {
          reload();
          toast.success(`${schedule.name} deleted`);
        }}
      />
    </>
  );

  if (state.status === 'error') {
    return (
      <Page title="Schedules">
        <ErrorNotice
          error={state.error}
          title="The schedules could not be loaded"
          onRetry={reload}
        />
      </Page>
    );
  }

  if (ready && schedules.length === 0) {
    return (
      <Page title="Schedules">
        <div className="tx-stack" data-testid="schedules-empty">
          {state.refreshError !== null && (
            <ErrorNotice
              error={state.refreshError}
              title="The schedules could not be refreshed"
              onRetry={refresh}
            />
          )}
          <EmptyState icon={CalendarDays} title="No schedules yet" action={createButton('lg')}>
            A schedule shows different playlists at different days and times, and a default playlist
            the rest of the time.
          </EmptyState>
        </div>
        {dialogs}
      </Page>
    );
  }

  return (
    <Page title="Schedules" subtitle={ready ? countLabel(schedules.length, 'schedule') : undefined}>
      <div className="tx-stack">
        <div className="tx-filter-row">
          <div className="tx-filter-row__filters">
            <SearchField
              label="Search schedules"
              value={query}
              onChange={setQuery}
              data-testid="schedules-search"
            />
            <IconButton
              icon={RefreshCw}
              label="Refresh"
              aria-disabled={refreshing || loading || undefined}
              aria-busy={refreshing || undefined}
              onClick={refresh}
              data-testid="schedules-refresh"
            />
          </div>
          <div className="tx-filter-row__end">{createButton('md')}</div>
        </div>

        {ready && state.refreshError !== null && (
          <ErrorNotice
            error={state.refreshError}
            title="The schedules could not be refreshed"
            onRetry={refresh}
          />
        )}

        {/* The page subtitle says how many there are; this line is the live region for a
            search, and shows only while one narrows the list. */}
        <span
          className={searching ? 'tx-toolbar__count' : 'tx-toolbar__count tx-visually-hidden'}
          aria-live="polite"
          data-testid="schedules-count"
        >
          {loading
            ? 'Loading schedules'
            : searching
              ? `${String(rows.length)} of ${countLabel(schedules.length, 'schedule')}`
              : countLabel(schedules.length, 'schedule')}
        </span>

        <div data-testid="schedules-table">
          <DataTable
            caption="Schedules"
            columns={columns}
            rows={rows}
            rowId={(schedule) => schedule.id}
            sort={sort}
            onSortChange={setSort}
            rowActions={rowMenu}
            rowTestId={(schedule) => `schedules-row-${schedule.id}`}
            loading={loading || refreshing}
            empty={
              <EmptyState
                variant="inline"
                icon={SearchX}
                title="No schedule matches"
                action={
                  <Button
                    onClick={() => {
                      setQuery('');
                    }}
                  >
                    Clear search
                  </Button>
                }
              >
                No schedule has those words in its name, its description or its default playlist.
              </EmptyState>
            }
          />
        </div>
      </div>
      {dialogs}
    </Page>
  );
}
