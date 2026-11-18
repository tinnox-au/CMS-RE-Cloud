import type { LayoutDto } from '@tinnox/contracts';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/index.ts';
import { useLoad, type LoadState } from '../../hooks/useLoad.ts';
import { formatTimestamp } from '../../lib/format.ts';
import {
  bandLabel,
  DEFAULT_LAYOUT_SORT,
  filterLayoutList,
  LAYOUT_SORT_ACCESSORS,
} from '../../lib/layouts.ts';
import { countLabel, sortRows, type SortState } from '../../lib/listView.ts';
import { assignedScreensLabel, modifiedLabel } from '../../lib/playlistsList.ts';
import { Page } from '../../shell/Page.tsx';
import {
  Ellipsis,
  LayoutTemplate,
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
import { CreateLayoutDialog } from './CreateLayoutDialog.tsx';
import { DeleteLayoutDialog } from './DeleteLayoutDialog.tsx';
import './layouts.css';

const loadLayouts = (signal: AbortSignal) => api.listLayouts(signal);
const NO_LAYOUTS: readonly LayoutDto[] = [];

/**
 * The layouts list (docs/portal-v2/stage-b.md, slice 4, section 7): search, sorting in the
 * browser, per layout Edit and Delete, and "Create layout", which asks for a name and the two
 * playlists of the preset and opens the editor.
 */
// shortcut: no grid, bulk selection or pagination; add when an organisation has over 100 layouts.
export function LayoutsPage() {
  const toast = useToast();
  const { state, reload } = useLoad(loadLayouts);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_LAYOUT_SORT);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LayoutDto | null>(null);
  // The state a refresh was asked from; a new state, good or bad, ends the refresh.
  const [refreshFrom, setRefreshFrom] = useState<LoadState<LayoutDto[]> | null>(null);

  const ready = state.status === 'ready';
  const loading = state.status === 'loading';
  const refreshing = refreshFrom !== null && refreshFrom === state;
  const layouts = ready ? state.data : NO_LAYOUTS;
  const searching = query.trim() !== '';
  const rows = useMemo(
    () => sortRows(filterLayoutList(layouts, query), sort, LAYOUT_SORT_ACCESSORS),
    [layouts, query, sort],
  );

  const refresh = () => {
    setRefreshFrom(state);
    reload();
  };

  const now = new Date();
  const columns: readonly DataTableColumn<LayoutDto>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      grow: true,
      cell: (layout) => (
        <NameCell
          name={layout.name}
          to={`/layouts/${layout.id}`}
          media={
            <span className="tx-layout-icon-tile">
              <Icon icon={LayoutTemplate} />
            </span>
          }
          meta={layout.description ?? undefined}
        />
      ),
    },
    {
      id: 'playlist',
      header: 'Main zone',
      sortable: true,
      priority: 2,
      cell: (layout) => {
        const main = layout.zones[0]?.playlist;
        return main === undefined ? null : (
          <Link className="tx-layout-list__link" to={`/playlists/${main.id}`} title={main.name}>
            {main.name}
          </Link>
        );
      },
    },
    {
      id: 'band',
      header: 'Band',
      sortable: true,
      nowrap: true,
      priority: 3,
      cell: (layout) => bandLabel(layout),
    },
    {
      id: 'screens',
      header: 'Screens',
      sortable: true,
      nowrap: true,
      priority: 2,
      cell: (layout) => (
        <span className={layout.assignedDisplayCount === 0 ? 'tx-muted' : undefined}>
          {assignedScreensLabel(layout.assignedDisplayCount)}
        </span>
      ),
    },
    {
      id: 'updated',
      header: 'Updated',
      sortable: true,
      numeric: true,
      priority: 4,
      cell: (layout) => (
        <time dateTime={layout.updatedAt} title={formatTimestamp(layout.updatedAt)}>
          {modifiedLabel(layout.updatedAt, now)}
        </time>
      ),
    },
  ];

  const rowMenu = (layout: LayoutDto) => (
    <Menu
      placement="bottom-end"
      trigger={(props) => (
        <IconButton
          {...props}
          icon={Ellipsis}
          label={`Actions for ${layout.name}`}
          data-testid="layouts-row-menu"
        />
      )}
    >
      <MenuItem icon={SquarePen} to={`/layouts/${layout.id}`}>
        Edit
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={Trash}
        tone="danger"
        onSelect={() => {
          setDeleteTarget(layout);
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
      data-testid="layouts-create"
    >
      Create layout
    </Button>
  );

  const dialogs = (
    <>
      <CreateLayoutDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
      />
      <DeleteLayoutDialog
        layout={deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
        }}
        onDeleted={(layout) => {
          reload();
          toast.success(`${layout.name} deleted`);
        }}
      />
    </>
  );

  if (state.status === 'error') {
    return (
      <Page title="Layouts">
        <ErrorNotice error={state.error} title="The layouts could not be loaded" onRetry={reload} />
      </Page>
    );
  }

  if (ready && layouts.length === 0) {
    return (
      <Page title="Layouts">
        <div className="tx-stack" data-testid="layouts-empty">
          {state.refreshError !== null && (
            <ErrorNotice
              error={state.refreshError}
              title="The layouts could not be refreshed"
              onRetry={refresh}
            />
          )}
          <EmptyState icon={LayoutTemplate} title="No layouts yet" action={createButton('lg')}>
            A layout splits a screen into a main zone and a band along the bottom, each with its own
            playlist.
          </EmptyState>
        </div>
        {dialogs}
      </Page>
    );
  }

  return (
    <Page title="Layouts" subtitle={ready ? countLabel(layouts.length, 'layout') : undefined}>
      <div className="tx-stack">
        <div className="tx-filter-row">
          <div className="tx-filter-row__filters">
            <SearchField
              label="Search layouts"
              value={query}
              onChange={setQuery}
              data-testid="layouts-search"
            />
            <IconButton
              icon={RefreshCw}
              label="Refresh"
              aria-disabled={refreshing || loading || undefined}
              aria-busy={refreshing || undefined}
              onClick={refresh}
              data-testid="layouts-refresh"
            />
          </div>
          <div className="tx-filter-row__end">{createButton('md')}</div>
        </div>

        {ready && state.refreshError !== null && (
          <ErrorNotice
            error={state.refreshError}
            title="The layouts could not be refreshed"
            onRetry={refresh}
          />
        )}

        {/* The page subtitle says how many there are; this line is the live region for a
            search, and shows only while one narrows the list. */}
        <span
          className={searching ? 'tx-toolbar__count' : 'tx-toolbar__count tx-visually-hidden'}
          aria-live="polite"
          data-testid="layouts-count"
        >
          {loading
            ? 'Loading layouts'
            : searching
              ? `${String(rows.length)} of ${countLabel(layouts.length, 'layout')}`
              : countLabel(layouts.length, 'layout')}
        </span>

        <div data-testid="layouts-table">
          <DataTable
            caption="Layouts"
            columns={columns}
            rows={rows}
            rowId={(layout) => layout.id}
            sort={sort}
            onSortChange={setSort}
            rowActions={rowMenu}
            rowTestId={(layout) => `layouts-row-${layout.id}`}
            loading={loading || refreshing}
            empty={
              <EmptyState
                variant="inline"
                icon={SearchX}
                title="No layout matches"
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
                No layout has those words in its name, its description or the playlist of a zone.
              </EmptyState>
            }
          />
        </div>
      </div>
      {dialogs}
    </Page>
  );
}
