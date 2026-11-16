import { APP_TYPES, type AppDto, type AppType } from '@tinnox/contracts';
import { useMemo, useState } from 'react';
import { api } from '../../api/index.ts';
import { useLoad, type LoadState } from '../../hooks/useLoad.ts';
import {
  APP_SORT_ACCESSORS,
  APP_TYPE_LABELS,
  DEFAULT_APP_SORT,
  filterAppList,
  usedInLabel,
} from '../../lib/apps.ts';
import { formatTimestamp } from '../../lib/format.ts';
import { countLabel, sortRows, type SortState } from '../../lib/listView.ts';
import { modifiedLabel } from '../../lib/playlistsList.ts';
import { Page } from '../../shell/Page.tsx';
import { Blocks, Ellipsis, Plus, RefreshCw, SearchX, SquarePen, Trash } from '../../ui/icons.ts';
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
  Select,
  useToast,
  type DataTableColumn,
} from '../../ui/index.ts';
import { APP_TYPE_ICONS } from './appIcons.ts';
import { CreateAppDialog } from './CreateAppDialog.tsx';
import { DeleteAppDialog } from './DeleteAppDialog.tsx';
import './apps.css';

const loadApps = (signal: AbortSignal) => api.listApps(signal);
const NO_APPS: readonly AppDto[] = [];

/**
 * The apps list (docs/portal-v2/stage-b.md, slice 2, section 8): search, a type filter,
 * sorting in the browser, per app Edit and Delete, and "Create app", which asks for a type
 * and a name and opens the editor.
 */
// shortcut: no grid, bulk selection or pagination; add when an organisation has over 100 apps.
export function AppsPage() {
  const toast = useToast();
  const { state, reload } = useLoad(loadApps);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<AppType | null>(null);
  const [sort, setSort] = useState<SortState>(DEFAULT_APP_SORT);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AppDto | null>(null);
  // The state a refresh was asked from; a new state, good or bad, ends the refresh.
  const [refreshFrom, setRefreshFrom] = useState<LoadState<AppDto[]> | null>(null);

  const ready = state.status === 'ready';
  const loading = state.status === 'loading';
  const refreshing = refreshFrom !== null && refreshFrom === state;
  const apps = ready ? state.data : NO_APPS;
  const filtered = query.trim() !== '' || type !== null;
  const rows = useMemo(
    () => sortRows(filterAppList(apps, query, type), sort, APP_SORT_ACCESSORS),
    [apps, query, type, sort],
  );

  const refresh = () => {
    setRefreshFrom(state);
    reload();
  };
  const clearFilters = () => {
    setQuery('');
    setType(null);
  };

  const now = new Date();
  const columns: readonly DataTableColumn<AppDto>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      grow: true,
      cell: (app) => (
        <NameCell
          name={app.name}
          to={`/apps/${app.id}`}
          media={
            <span className="tx-app-icon-tile">
              <Icon icon={APP_TYPE_ICONS[app.content.type]} />
            </span>
          }
        />
      ),
    },
    {
      id: 'type',
      header: 'Type',
      sortable: true,
      nowrap: true,
      priority: 3,
      cell: (app) => APP_TYPE_LABELS[app.content.type],
    },
    {
      id: 'used',
      header: 'Used in',
      sortable: true,
      nowrap: true,
      priority: 2,
      cell: (app) => (
        <span className={app.usageCount === 0 ? 'tx-muted' : undefined}>
          {usedInLabel(app.usageCount)}
        </span>
      ),
    },
    {
      id: 'updated',
      header: 'Updated',
      sortable: true,
      numeric: true,
      priority: 4,
      cell: (app) => (
        <time dateTime={app.updatedAt} title={formatTimestamp(app.updatedAt)}>
          {modifiedLabel(app.updatedAt, now)}
        </time>
      ),
    },
  ];

  const rowMenu = (app: AppDto) => (
    <Menu
      placement="bottom-end"
      trigger={(props) => (
        <IconButton
          {...props}
          icon={Ellipsis}
          label={`Actions for ${app.name}`}
          data-testid="apps-row-menu"
        />
      )}
    >
      <MenuItem icon={SquarePen} to={`/apps/${app.id}`}>
        Edit
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={Trash}
        tone="danger"
        onSelect={() => {
          setDeleteTarget(app);
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
      data-testid="apps-create"
    >
      Create app
    </Button>
  );

  const dialogs = (
    <>
      <CreateAppDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
      />
      <DeleteAppDialog
        app={deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
        }}
        onDeleted={(app) => {
          reload();
          toast.success(`${app.name} deleted`);
        }}
      />
    </>
  );

  if (state.status === 'error') {
    return (
      <Page title="Apps">
        <ErrorNotice error={state.error} title="The apps could not be loaded" onRetry={reload} />
      </Page>
    );
  }

  if (ready && apps.length === 0) {
    return (
      <Page title="Apps">
        <div className="tx-stack" data-testid="apps-empty">
          {state.refreshError !== null && (
            <ErrorNotice
              error={state.refreshError}
              title="The apps could not be refreshed"
              onRetry={refresh}
            />
          )}
          <EmptyState icon={Blocks} title="No apps yet" action={createButton('lg')}>
            Apps show a clock, the date, a countdown, scrolling text, a QR code or a message, drawn
            by the screen itself.
          </EmptyState>
        </div>
        {dialogs}
      </Page>
    );
  }

  return (
    <Page title="Apps" subtitle={ready ? countLabel(apps.length, 'app') : undefined}>
      <div className="tx-stack">
        <div className="tx-filter-row">
          <div className="tx-filter-row__filters">
            <SearchField
              label="Search apps"
              value={query}
              onChange={setQuery}
              data-testid="apps-search"
            />
            <Select
              size="sm"
              aria-label="Type"
              value={type ?? ''}
              onChange={(event) => {
                setType(APP_TYPES.find((option) => option === event.target.value) ?? null);
              }}
              data-testid="apps-type"
            >
              <option value="">All types</option>
              {APP_TYPES.map((option) => (
                <option key={option} value={option}>
                  {APP_TYPE_LABELS[option]}
                </option>
              ))}
            </Select>
            <IconButton
              icon={RefreshCw}
              label="Refresh"
              aria-disabled={refreshing || loading || undefined}
              aria-busy={refreshing || undefined}
              onClick={refresh}
              data-testid="apps-refresh"
            />
          </div>
          <div className="tx-filter-row__end">{createButton('md')}</div>
        </div>

        {ready && state.refreshError !== null && (
          <ErrorNotice
            error={state.refreshError}
            title="The apps could not be refreshed"
            onRetry={refresh}
          />
        )}

        {/* The page subtitle says how many there are; this line is the live region for a
            search or filter, and shows only while one narrows the list. */}
        <span
          className={filtered ? 'tx-toolbar__count' : 'tx-toolbar__count tx-visually-hidden'}
          aria-live="polite"
          data-testid="apps-count"
        >
          {loading
            ? 'Loading apps'
            : filtered
              ? `${String(rows.length)} of ${countLabel(apps.length, 'app')}`
              : countLabel(apps.length, 'app')}
        </span>

        <DataTable
          caption="Apps"
          columns={columns}
          rows={rows}
          rowId={(app) => app.id}
          sort={sort}
          onSortChange={setSort}
          rowActions={rowMenu}
          rowTestId={(app) => `apps-row-${app.id}`}
          loading={loading || refreshing}
          empty={
            <EmptyState
              variant="inline"
              icon={SearchX}
              title="No app matches"
              action={<Button onClick={clearFilters}>Clear filters</Button>}
            >
              No app has that type or those words in its name or description.
            </EmptyState>
          }
        />
      </div>
      {dialogs}
    </Page>
  );
}
