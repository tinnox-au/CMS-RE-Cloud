import type { MediaKind, PlaylistSummaryDto } from '@tinnox/contracts';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAbort } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad, type LoadState } from '../../hooks/useLoad.ts';
import { formatTimestamp } from '../../lib/format.ts';
import { applyListView, DEFAULT_PAGE_SIZE, type SortState } from '../../lib/listView.ts';
import {
  playlistItemCountLabel,
  playlistLengthLabel,
  playlistSummaryLabel,
} from '../../lib/mediaName.ts';
import {
  assignedScreensLabel,
  DEFAULT_PLAYLIST_SORT,
  modifiedLabel,
  PLAYLIST_SORT_ACCESSORS,
  PLAYLIST_SORT_OPTIONS,
  playlistSearchTexts,
  playlistsCountLabel,
  playlistSortFromValue,
  playlistSortValue,
} from '../../lib/playlistsList.ts';
import { duplicatedToast } from '../../lib/playlistsListActions.ts';
import type { RowDeleteMode } from '../../lib/rowFocus.ts';
import { pruneSelection, selectedRows, setMany } from '../../lib/selection.ts';
import { Page } from '../../shell/Page.tsx';
import {
  LayoutGrid,
  List,
  ListVideo,
  Monitor,
  Plus,
  RefreshCw,
  SearchX,
  Trash,
} from '../../ui/icons.ts';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorNotice,
  Icon,
  IconButton,
  NameCell,
  Pagination,
  SearchField,
  Segmented,
  Select,
  SelectionBar,
  SkeletonGroup,
  Tile,
  TileGrid,
  TileSkeleton,
  useToast,
  VisuallyHidden,
  type DataTableColumn,
} from '../../ui/index.ts';
import { elementByTestId, PlaylistMosaic, rowByTestId } from '../shared/index.ts';
import { AssignToScreens } from './list/AssignToScreens.tsx';
import { DeletePlaylistsDialog } from './list/DeletePlaylistsDialog.tsx';
import { NewPlaylistDialog } from './list/NewPlaylistDialog.tsx';
import { PlaylistRowMenu } from './list/PlaylistRowMenu.tsx';
import './list/playlistsList.css';

type View = 'list' | 'grid';

interface PlaylistsData {
  readonly playlists: readonly PlaylistSummaryDto[];
  /**
   * The kind of each media item, read only when a playlist mixes images and videos: its
   * mosaic then asks for each thumbnail in the right form at once. Null when not needed or
   * not available; the mosaic then finds out by itself.
   */
  readonly kindById: ReadonlyMap<string, MediaKind> | null;
}

async function loadPlaylists(signal: AbortSignal): Promise<PlaylistsData> {
  const playlists = await api.listPlaylists(signal);
  const mixed = playlists.some(
    (playlist) => playlist.kinds.length > 1 && playlist.previewMediaIds.length > 0,
  );
  if (!mixed) return { playlists, kindById: null };
  try {
    const media = await api.listMedia(signal);
    return { playlists, kindById: new Map(media.items.map((item) => [item.id, item.kind])) };
  } catch (error) {
    if (isAbort(error)) throw error;
    // The list does not depend on it: thumbnails are then tried as a video first.
    return { playlists, kindById: null };
  }
}

interface ActionError {
  readonly title: string;
  readonly error: unknown;
}

const NO_PLAYLISTS: readonly PlaylistSummaryDto[] = [];
const NONE_SELECTED: ReadonlySet<string> = new Set();

/**
 * The playlists list (docs/portal-v2/stage-a.md, section 3.4): search, list or grid, sorting
 * and paging in the browser; per playlist Open, Assign to screens, Duplicate and Delete;
 * Delete for a selection; and "New playlist", which asks for a name and opens the editor.
 */
export function PlaylistsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { state, reload } = useLoad(loadPlaylists);

  const [view, setView] = useState<View>('list');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_PLAYLIST_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(NONE_SELECTED);

  const [creating, setCreating] = useState(false);
  const [assignTarget, setAssignTarget] = useState<PlaylistSummaryDto | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<readonly PlaylistSummaryDto[] | null>(null);
  const [deleteMode, setDeleteMode] = useState<RowDeleteMode>('row');
  const [duplicating, setDuplicating] = useState<ReadonlySet<string>>(NONE_SELECTED);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  // The state a refresh was asked from; a new state, good or bad, ends the refresh.
  const [refreshFrom, setRefreshFrom] = useState<LoadState<PlaylistsData> | null>(null);

  const ready = state.status === 'ready';
  const loading = state.status === 'loading';
  const playlists = ready ? state.data.playlists : NO_PLAYLISTS;
  const kindById = ready ? state.data.kindById : null;
  const refreshing = refreshFrom !== null && refreshFrom === state;

  const searching = query.trim() !== '';
  const list = useMemo(
    () =>
      applyListView(playlists, {
        search: { query, texts: playlistSearchTexts },
        sort,
        accessors: PLAYLIST_SORT_ACCESSORS,
        page,
        pageSize,
      }),
    [playlists, query, sort, page, pageSize],
  );

  // Rows that are no longer listed (deleted, or hidden by the search) leave the selection, so
  // a bulk action only ever acts on rows the search shows. Other pages of it keep theirs.
  const selected = useMemo(
    () =>
      pruneSelection(
        chosen,
        list.matched.map((playlist) => playlist.id),
      ),
    [chosen, list.matched],
  );

  const refresh = () => {
    setRefreshFrom(state);
    reload();
  };

  const kindOf = useCallback((mediaId: string) => kindById?.get(mediaId), [kindById]);

  const duplicate = (playlist: PlaylistSummaryDto) => {
    if (duplicating.has(playlist.id)) return;
    setDuplicating((current) => setMany(current, [playlist.id], true));
    setActionError(null);
    api
      .duplicatePlaylist(playlist.id)
      .then(
        (copy) => {
          reload();
          toast.success(duplicatedToast(copy.name), {
            action: {
              label: 'Open copy',
              onAction: () => {
                void navigate(`/playlists/${copy.id}`);
              },
            },
          });
        },
        (error: unknown) => {
          setActionError({ title: `“${playlist.name}” was not duplicated`, error });
        },
      )
      .finally(() => {
        setDuplicating((current) => setMany(current, [playlist.id], false));
      });
  };

  const rowMenu = (playlist: PlaylistSummaryDto) => (
    <PlaylistRowMenu
      playlist={playlist}
      onAssign={setAssignTarget}
      onDuplicate={duplicate}
      onDelete={(target) => {
        setDeleteMode('row');
        setDeleteTargets([target]);
      }}
      duplicating={duplicating.has(playlist.id)}
    />
  );

  const mosaic = (playlist: PlaylistSummaryDto, size: 'sm' | 'fill') => (
    <PlaylistMosaic
      size={size}
      mediaIds={playlist.previewMediaIds}
      kinds={playlist.kinds}
      kindOf={kindById === null ? undefined : kindOf}
    />
  );

  const now = new Date();
  // Items, Length and Screens leave together (priority 3): the name cell's second line then
  // repeats all three, so nothing is shown twice. Modified is said nowhere else and stays longer.
  const columns: readonly DataTableColumn<PlaylistSummaryDto>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      grow: true,
      cell: (playlist) => (
        <NameCell
          name={playlist.name}
          to={`/playlists/${playlist.id}`}
          media={mosaic(playlist, 'sm')}
          meta={
            <span className="tx-playlists-list__summary">
              {playlistSummaryLabel(playlist)} ·{' '}
              {assignedScreensLabel(playlist.assignedDisplayCount)}
            </span>
          }
        />
      ),
    },
    {
      id: 'description',
      header: 'Description',
      width: '260px',
      priority: 4,
      cell: (playlist) =>
        playlist.description === null ? (
          <span className="tx-playlists-list__none">
            <span aria-hidden="true">–</span>
            <VisuallyHidden>No description</VisuallyHidden>
          </span>
        ) : (
          <span className="tx-playlists-list__description" title={playlist.description}>
            {playlist.description}
          </span>
        ),
    },
    {
      id: 'items',
      header: 'Items',
      sortable: true,
      numeric: true,
      align: 'end',
      priority: 3,
      cell: (playlist) => (
        <>
          <span aria-hidden="true">{playlist.itemCount}</span>
          <VisuallyHidden>{playlistItemCountLabel(playlist.itemCount)}</VisuallyHidden>
        </>
      ),
    },
    {
      id: 'length',
      header: 'Length',
      sortable: true,
      numeric: true,
      align: 'end',
      priority: 3,
      cell: (playlist) => playlistLengthLabel(playlist.totalDurationMs),
    },
    {
      id: 'screens',
      header: 'Screens',
      sortable: true,
      numeric: true,
      align: 'end',
      priority: 3,
      cell: (playlist) => (
        <>
          <span
            aria-hidden="true"
            className={playlist.assignedDisplayCount === 0 ? 'tx-playlists-list__none' : undefined}
          >
            {playlist.assignedDisplayCount}
          </span>
          <VisuallyHidden>{assignedScreensLabel(playlist.assignedDisplayCount)}</VisuallyHidden>
        </>
      ),
    },
    {
      id: 'modified',
      header: 'Modified',
      sortable: true,
      numeric: true,
      priority: 2,
      cell: (playlist) => (
        <time dateTime={playlist.updatedAt} title={formatTimestamp(playlist.updatedAt)}>
          {modifiedLabel(playlist.updatedAt, now)}
        </time>
      ),
    },
  ];

  const newButton = (size: 'md' | 'lg') => (
    <Button
      variant="primary"
      size={size}
      icon={Plus}
      onClick={() => {
        setCreating(true);
      }}
      data-testid="playlists-new"
    >
      New playlist
    </Button>
  );

  const noMatch = (
    <EmptyState
      variant="inline"
      icon={SearchX}
      title="No playlist matches"
      action={
        <Button
          onClick={() => {
            setQuery('');
            setPage(1);
          }}
        >
          Clear search
        </Button>
      }
    >
      No playlist has those words in its name or description.
    </EmptyState>
  );

  const pagination = (
    <Pagination
      info={list.info}
      label="Playlists pages"
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );

  const dialogs = (
    <>
      <NewPlaylistDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
      />
      <AssignToScreens
        playlist={assignTarget}
        onClose={() => {
          setAssignTarget(null);
        }}
        onAssigned={reload}
      />
      <DeletePlaylistsDialog
        targets={deleteTargets}
        onClose={() => {
          setDeleteTargets(null);
        }}
        onDeleted={(ids) => {
          setChosen((current) => setMany(current, ids, false));
          reload();
        }}
        rowFocus={{
          mode: deleteMode,
          order: list.rows.map((playlist) => playlist.id),
          row: rowByTestId('playlists-row-', 'playlists-tile-'),
          primary: elementByTestId('playlists-new'),
        }}
      />
    </>
  );

  if (state.status === 'error') {
    return (
      <Page title="Playlists">
        <ErrorNotice
          error={state.error}
          title="The playlists could not be loaded"
          onRetry={reload}
        />
      </Page>
    );
  }

  if (ready && playlists.length === 0) {
    return (
      <Page title="Playlists">
        <div className="tx-stack tx-playlists-list" data-testid="playlists-empty">
          {state.refreshError !== null && (
            <ErrorNotice
              error={state.refreshError}
              title="The playlists could not be refreshed"
              onRetry={refresh}
            />
          )}
          <EmptyState icon={ListVideo} title="No playlists yet" action={newButton('lg')}>
            A playlist is an ordered set of images and videos. Create one, add media to it, then
            assign it to a screen and push.
          </EmptyState>
        </div>
        {dialogs}
      </Page>
    );
  }

  return (
    <Page title="Playlists">
      <div className="tx-stack tx-playlists-list">
        <div className="tx-filter-row">
          <div className="tx-filter-row__filters">
            <SearchField
              label="Search playlists"
              value={query}
              onChange={(next) => {
                setQuery(next);
                setPage(1);
              }}
              data-testid="playlists-search"
            />
          </div>
          <div className="tx-filter-row__end">{newButton('md')}</div>
        </div>

        {actionError !== null && (
          <ErrorNotice
            error={actionError.error}
            title={actionError.title}
            onDismiss={() => {
              setActionError(null);
            }}
          />
        )}
        {ready && state.refreshError !== null && (
          <ErrorNotice
            error={state.refreshError}
            title="The playlists could not be refreshed"
            onRetry={refresh}
          />
        )}

        <div className="tx-toolbar">
          <span className="tx-toolbar__count" aria-live="polite" data-testid="playlists-count">
            {loading
              ? 'Loading playlists'
              : playlistsCountLabel(list.matched.length, list.total, searching)}
          </span>
          <div className="tx-toolbar__end">
            {view === 'grid' && (
              <label className="tx-playlists-list__sort">
                <span className="tx-playlists-list__sort-label">Sort by</span>
                <Select
                  size="sm"
                  value={playlistSortValue(sort)}
                  onChange={(event) => {
                    setSort(playlistSortFromValue(event.target.value));
                    setPage(1);
                  }}
                  data-testid="playlists-sort"
                >
                  {PLAYLIST_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <Segmented
              label="View"
              iconOnly
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'List', icon: List },
                { value: 'grid', label: 'Grid', icon: LayoutGrid },
              ]}
            />
            <IconButton
              icon={RefreshCw}
              label="Refresh"
              aria-disabled={refreshing || loading || undefined}
              aria-busy={refreshing || undefined}
              onClick={refresh}
              data-testid="playlists-refresh"
            />
          </div>
        </div>

        {view === 'list' ? (
          <DataTable
            caption="Playlists"
            columns={columns}
            rows={list.rows}
            rowId={(playlist) => playlist.id}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            selection={{
              selected,
              onChange: setChosen,
              rowLabel: (playlist) => playlist.name,
            }}
            rowActions={rowMenu}
            rowTestId={(playlist) => `playlists-row-${playlist.id}`}
            loading={loading || refreshing}
            empty={noMatch}
            footer={list.matched.length > 0 ? pagination : undefined}
          />
        ) : loading ? (
          <SkeletonGroup label="Loading playlists">
            <TileGrid label="Playlists">
              {Array.from({ length: 8 }, (_, index) => (
                <TileSkeleton key={index} />
              ))}
            </TileGrid>
          </SkeletonGroup>
        ) : list.rows.length === 0 ? (
          <div className="tx-playlists-list__grid-empty">{noMatch}</div>
        ) : (
          <>
            <TileGrid label="Playlists" minTileWidth={240}>
              {list.rows.map((playlist) => (
                <Tile
                  key={playlist.id}
                  name={playlist.name}
                  to={`/playlists/${playlist.id}`}
                  media={mosaic(playlist, 'fill')}
                  meta={
                    <>
                      <span className="tx-playlists-list__tile-meta">
                        {playlistSummaryLabel(playlist)}
                      </span>
                      <span className="tx-playlists-list__tile-meta">
                        <Icon icon={Monitor} size={14} />
                        {assignedScreensLabel(playlist.assignedDisplayCount)}
                      </span>
                    </>
                  }
                  actions={rowMenu(playlist)}
                  selection={{
                    selected: selected.has(playlist.id),
                    label: playlist.name,
                    onChange: (on) => {
                      setChosen(setMany(selected, [playlist.id], on));
                    },
                  }}
                  testId={`playlists-tile-${playlist.id}`}
                />
              ))}
            </TileGrid>
            {pagination}
          </>
        )}

        <SelectionBar
          count={selected.size}
          label="Selected playlists"
          onClear={() => {
            setChosen(NONE_SELECTED);
          }}
        >
          <Button
            variant="danger"
            size="sm"
            icon={Trash}
            onClick={() => {
              setDeleteMode('bulk');
              setDeleteTargets(selectedRows(list.matched, selected, (playlist) => playlist.id));
            }}
            data-testid="playlists-bulk-delete"
          >
            Delete
          </Button>
        </SelectionBar>
      </div>
      {dialogs}
    </Page>
  );
}
