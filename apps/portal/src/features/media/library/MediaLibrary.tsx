import type { FolderDto, MediaDto, MediaListResponse, MediaStatus } from '@tinnox/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { api } from '../../../api/index.ts';
import { useLoad, type LoadState } from '../../../hooks/useLoad.ts';
import { formatBytes, formatTimestamp } from '../../../lib/format.ts';
import { applyListView } from '../../../lib/listView.ts';
import { meterFraction, meterTone } from '../../../lib/meter.ts';
import {
  folderCounts,
  LIBRARY_COLUMN_PRIORITY,
  LIBRARY_SORT_ACCESSORS,
  LIBRARY_TITLES,
  libraryCountLabel,
  libraryEmptyState,
  libraryFilters,
  libraryNoun,
  librarySearchTexts,
  matchesKind,
  modifiedLabel,
  type LibraryKind,
} from '../../../lib/mediaLibraryList.ts';
import {
  clearLibraryFilters,
  isFiltering,
  LIBRARY_ROOT_FILTER,
  LIBRARY_SORT_CHOICES,
  parseSortParam,
  sortParam,
  toggleStatus,
} from '../../../lib/mediaLibraryQuery.ts';
import {
  backgroundFinishedToast,
  backgroundUploads,
  summariseUploads,
} from '../../../lib/mediaLibraryUploads.ts';
import {
  mediaDetailsLabel,
  mediaDisplayName,
  mediaKindLabel,
  mediaSizeLabel,
} from '../../../lib/mediaName.ts';
import type { RowDeleteMode } from '../../../lib/rowFocus.ts';
import { pruneSelection, selectedRows, setMany } from '../../../lib/selection.ts';
import { useCan, useSession } from '../../../session/AuthenticatedSession.tsx';
import { Page } from '../../../shell/Page.tsx';
import {
  CloudUpload,
  Folder,
  FolderInput,
  Images,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  SearchX,
  Tags,
  Trash,
  TriangleExclamationPoint,
} from '../../../ui/icons.ts';
import {
  Banner,
  Button,
  Chip,
  ConfirmDialog,
  cx,
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
  Spinner,
  Tile,
  TileGrid,
  TileSkeleton,
  useToast,
  VisuallyHidden,
  type DataTableColumn,
} from '../../../ui/index.ts';
import {
  elementByTestId,
  MediaThumb,
  MoveToFolderDialog,
  rowByTestId,
  TagChips,
  TagFilter,
  TagsDialog,
  useFolders,
  useTags,
} from '../../shared/index.ts';
import { AddMediaDialog } from './AddMediaDialog.tsx';
import { AddToPlaylist } from './AddToPlaylist.tsx';
import { DeleteMediaDialog } from './DeleteMediaDialog.tsx';
import { DeleteFolderDialog, FolderNameDialog, type FolderNameTarget } from './FolderDialogs.tsx';
import { FolderChips } from './FolderChips.tsx';
import { MediaFailureNote, MediaKindLabel, MediaStatusPill } from './MediaParts.tsx';
import { MediaRowMenu } from './MediaRowMenu.tsx';
import './mediaLibrary.css';
import { useFileDrop } from './useFileDrop.ts';
import { useLibraryQuery } from './useLibraryQuery.ts';
import { useUploadQueue } from './useUploadQueue.ts';

/** Refresh rhythm while the server is still checking a file (M0: 2 s). */
const PROCESSING_POLL_MS = 2000;

const STATUS_CHOICES: readonly { readonly status: MediaStatus; readonly label: string }[] = [
  { status: 'ready', label: 'Ready' },
  { status: 'processing', label: 'Processing' },
  { status: 'failed', label: 'Failed' },
];

const LIBRARY_PATHS = new Set(['/media', '/media/images', '/media/videos']);

function loadMedia(signal: AbortSignal): Promise<MediaListResponse> {
  return api.listMedia(signal);
}

function pollWhileProcessing(list: MediaListResponse): number | null {
  return list.items.some((item) => item.status === 'processing') ? PROCESSING_POLL_MS : null;
}

const NO_MEDIA: readonly MediaDto[] = [];
const NONE_SELECTED: ReadonlySet<string> = new Set();

/** Takes a file drop and does nothing with it: the browser must not open the file instead. */
const IGNORE_FILES = (): void => undefined;

/**
 * The media library (docs/portal-v2/stage-a.md, section 3.2): every file of the
 * organisation, or only its images or videos, with search, folder, tag and status filters
 * kept in the address; a table or a grid sorted and paged in the browser; per file Open, Add
 * to playlist, Move to folder, Edit tags and Delete; the same for a selection; folders made,
 * renamed and deleted from the chip row; and the Add media dialog with the M0 upload queue.
 */
export function MediaLibrary({ kind }: { readonly kind: LibraryKind }) {
  const { limits } = useSession();
  const canWrite = useCan('content.write');
  const canDeleteMedia = useCan('media.delete');
  const canDeleteFolder = useCan('content.delete');
  // Selection and the row menu exist only while one of their actions is left.
  const canSelect = canWrite || canDeleteMedia;
  const toast = useToast();
  const { query, change, replace } = useLibraryQuery();
  const tags = useTags('media');
  const folders = useFolders();
  const { state, reload } = useLoad(loadMedia, pollWhileProcessing);

  const [chosen, setChosen] = useState<ReadonlySet<string>>(NONE_SELECTED);
  const [refreshFrom, setRefreshFrom] = useState<LoadState<MediaListResponse> | null>(null);
  const [adding, setAdding] = useState(false);
  const [playlistTarget, setPlaylistTarget] = useState<MediaDto | null>(null);
  const [moveTarget, setMoveTarget] = useState<readonly MediaDto[] | null>(null);
  const [tagTarget, setTagTarget] = useState<readonly MediaDto[] | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<readonly MediaDto[] | null>(null);
  const [deleteMode, setDeleteMode] = useState<RowDeleteMode>('row');
  const [folderName, setFolderName] = useState<FolderNameTarget | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<FolderDto | null>(null);

  const ready = state.status === 'ready';
  const loading = state.status === 'loading';
  const refreshing = refreshFrom !== null && refreshFrom === state;
  const items = ready ? state.data.items : NO_MEDIA;
  const kindItems = useMemo(() => items.filter((media) => matchesKind(media, kind)), [items, kind]);
  const listed = useMemo(() => new Map(items.map((media) => [media.id, media])), [items]);

  // ---------- Uploads ----------

  const queue = useUploadQueue(limits, reload);
  const uploads = summariseUploads(queue.entries);
  const background = adding ? null : backgroundUploads(uploads);
  const carriedOn = useRef(false);

  const openAdd = useCallback(
    (files: readonly File[] = []) => {
      carriedOn.current = false;
      queue.addFiles(files);
      setAdding(true);
    },
    [queue],
  );
  // Stays mounted without content.write, so a dropped file never makes the browser leave.
  const dragging = useFileDrop(canWrite ? openAdd : IGNORE_FILES);

  const closeAdd = () => {
    carriedOn.current = uploads.active > 0;
    setAdding(false);
    queue.clearFinished();
    reload();
  };

  // Uploads that carried on after the dialog closed: say how they ended, once.
  useEffect(() => {
    if (adding || !carriedOn.current || uploads.active > 0) return;
    carriedOn.current = false;
    const ended = backgroundFinishedToast(uploads);
    if (ended !== null) toast.show(ended.tone, ended.message);
  }, [adding, uploads, toast]);

  // Leaving the library stops the queue: ask first while files are still going up.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      uploads.active > 0 &&
      currentLocation.pathname !== nextLocation.pathname &&
      !LIBRARY_PATHS.has(nextLocation.pathname),
  );
  const uploading = uploads.active > 0;
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [uploading]);

  // ---------- The list ----------

  const tagIds = useMemo(
    () => (tags.status === 'ready' ? query.tags.filter((id) => tags.byId.has(id)) : query.tags),
    [query.tags, tags.status, tags.byId],
  );
  const tagSelection = useMemo<ReadonlySet<string>>(() => new Set(tagIds), [tagIds]);
  const list = applyListView(kindItems, {
    search: { query: query.search, texts: librarySearchTexts },
    filters: libraryFilters({ folder: query.folder, tags: tagIds, statuses: query.statuses }),
    sort: query.sort,
    accessors: LIBRARY_SORT_ACCESSORS,
    page: query.page,
    pageSize: query.pageSize,
  });
  const filtering = isFiltering(query);
  const counts = useMemo(() => (ready ? folderCounts(kindItems) : null), [ready, kindItems]);
  const folderKnown =
    folders.status !== 'ready' ||
    query.folder === null ||
    query.folder === LIBRARY_ROOT_FILTER ||
    folders.byId.has(query.folder);
  const processing = kindItems.some((media) => media.status === 'processing');

  // Rows that are no longer listed (deleted, filtered out, another kind) leave the selection.
  const selected = useMemo(
    () =>
      pruneSelection(
        chosen,
        list.matched.map((media) => media.id),
      ),
    [chosen, list.matched],
  );
  const selectedItems = () => selectedRows(list.matched, selected, (media) => media.id);

  const refresh = () => {
    setRefreshFrom(state);
    reload();
    tags.reload();
    folders.reload();
  };

  const afterChange = () => {
    reload();
    folders.reload();
  };

  // ---------- Parts ----------

  const now = new Date();
  const rowMenu = (media: MediaDto) => (
    <MediaRowMenu
      media={media}
      onAddToPlaylist={canWrite ? setPlaylistTarget : undefined}
      onMove={
        canWrite
          ? (target) => {
              setMoveTarget([target]);
            }
          : undefined
      }
      onEditTags={
        canWrite
          ? (target) => {
              setTagTarget([target]);
            }
          : undefined
      }
      onDelete={
        canDeleteMedia
          ? (target) => {
              setDeleteMode('row');
              setDeleteTargets([target]);
            }
          : undefined
      }
    />
  );

  /** Under a tile's name: "Image · 640 × 360 px" (the thumbnail's badge shows the kind too). */
  const tileCaption = (media: MediaDto) =>
    [mediaKindLabel(media.kind), mediaDetailsLabel(media)]
      .filter((part) => part !== null)
      .join(' · ');

  const summaryLine = (media: MediaDto) =>
    [mediaDetailsLabel(media), mediaSizeLabel(media)].filter((part) => part !== null).join(' · ');

  const columns: readonly DataTableColumn<MediaDto>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      grow: true,
      cell: (media) => (
        <NameCell
          name={mediaDisplayName(media)}
          to={`/media/${media.id}`}
          media={<MediaThumb media={media} size="sm" />}
          meta={
            media.status === 'failed' ? (
              <MediaFailureNote media={media} />
            ) : summaryLine(media) === '' ? undefined : (
              <span className="tx-media-library__summary">{summaryLine(media)}</span>
            )
          }
        />
      ),
    },
    {
      id: 'kind',
      header: 'Kind',
      width: '88px',
      priority: LIBRARY_COLUMN_PRIORITY.kind,
      cell: (media) => <MediaKindLabel media={media} />,
    },
    {
      id: 'details',
      header: 'Details',
      priority: LIBRARY_COLUMN_PRIORITY.details,
      nowrap: true,
      cell: (media) => <span className="tx-num">{mediaDetailsLabel(media) ?? <None />}</span>,
    },
    {
      id: 'size',
      header: 'Size',
      sortable: true,
      numeric: true,
      align: 'end',
      priority: LIBRARY_COLUMN_PRIORITY.size,
      cell: (media) => mediaSizeLabel(media) ?? <None />,
    },
    {
      id: 'tags',
      header: 'Tags',
      width: '160px',
      priority: LIBRARY_COLUMN_PRIORITY.tags,
      cell: (media) => <TagChips tags={tags} tagIds={media.tagIds} />,
    },
    {
      id: 'modified',
      header: 'Modified',
      sortable: true,
      numeric: true,
      priority: LIBRARY_COLUMN_PRIORITY.modified,
      cell: (media) => (
        <time dateTime={media.updatedAt} title={formatTimestamp(media.updatedAt)}>
          {modifiedLabel(media.updatedAt, now)}
        </time>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: '116px',
      cell: (media) => <MediaStatusPill media={media} />,
    },
  ];

  const addButton = (size: 'md' | 'lg') =>
    canWrite ? (
      <Button
        variant="primary"
        size={size}
        icon={Plus}
        onClick={() => {
          openAdd();
        }}
        data-testid="media-library-add"
      >
        Add media
      </Button>
    ) : undefined;

  const empty = () => {
    const which = libraryEmptyState({
      libraryTotal: items.length,
      kindTotal: kindItems.length,
      query,
      folderKnown,
    });
    const clear = (label: string) => (
      <Button
        onClick={() => {
          replace(clearLibraryFilters(query));
        }}
        data-testid="media-library-clear-filters"
      >
        {label}
      </Button>
    );
    switch (which) {
      case 'library_empty':
        return (
          <EmptyState variant="inline" icon={Images} title="No media yet" action={addButton('md')}>
            {canWrite
              ? 'Upload an image or a video to start building a playlist. You can also drop files anywhere on this page.'
              : 'An editor adds media.'}
          </EmptyState>
        );
      case 'kind_empty':
        return (
          <EmptyState
            variant="inline"
            icon={Images}
            title={`No ${libraryNoun(kind, 2)} yet`}
            action={addButton('md')}
          >
            {!canWrite
              ? 'An editor adds media.'
              : kind === 'video'
                ? 'Upload an MP4 video (H.264) and it appears here once the server has checked it.'
                : 'Upload a JPEG or PNG image and it appears here once the server has checked it.'}
          </EmptyState>
        );
      case 'folder_missing':
        return (
          <EmptyState
            variant="inline"
            icon={Folder}
            title="This folder no longer exists"
            action={clear('Show all media')}
          >
            It may have been deleted. Its files are now in the library root.
          </EmptyState>
        );
      case 'folder_empty':
        return (
          <EmptyState
            variant="inline"
            icon={Folder}
            title={`No ${libraryNoun(kind, 2)} in this folder`}
            action={clear('Show all folders')}
          >
            {canWrite
              ? 'Choose files in the library and use Move to folder to put them here.'
              : undefined}
          </EmptyState>
        );
      case 'no_match':
        return (
          <EmptyState
            variant="inline"
            icon={SearchX}
            title={`No ${libraryNoun(kind)} matches`}
            action={clear('Clear filters')}
          >
            Nothing matches this search and these filters.
          </EmptyState>
        );
    }
  };

  const pagination = (
    <Pagination
      info={list.info}
      label="Media pages"
      onPageChange={(page) => {
        change({ page });
      }}
      onPageSizeChange={(pageSize) => {
        change({ pageSize, page: 1 });
      }}
    />
  );

  const title = LIBRARY_TITLES[kind];

  // The header's line: the count (announced when a filter changes it) and the storage used.
  const storage = ready ? state.data.storage : null;
  const storageTone =
    storage === null ? 'ok' : meterTone(meterFraction(storage.usedBytes, storage.limitBytes));
  const subtitle = (
    <>
      <span aria-live="polite" data-testid="media-library-count">
        {loading
          ? 'Loading media'
          : libraryCountLabel(list.matched.length, kindItems.length, filtering, kind)}
      </span>
      {storage !== null && (
        <span data-testid="media-library-storage">
          {' · '}
          {formatBytes(storage.usedBytes)} of {formatBytes(storage.limitBytes)} used
        </span>
      )}
    </>
  );

  if (state.status === 'error') {
    return (
      <Page title={title}>
        <ErrorNotice error={state.error} title="Media could not be loaded" onRetry={reload} />
      </Page>
    );
  }

  return (
    <Page title={title} subtitle={subtitle}>
      <div className="tx-stack tx-media-library" data-testid="media-library">
        <div className="tx-filter-row">
          <div className="tx-filter-row__filters">
            <SearchField
              label={kind === 'all' ? 'Search media' : `Search ${libraryNoun(kind, 2)}`}
              value={query.search}
              onChange={(search) => {
                change({ search });
              }}
              data-testid="media-library-search"
            />
            <div
              className="tx-media-library__statuses"
              role="group"
              aria-label="Status"
              data-testid="media-library-status-filter"
            >
              {STATUS_CHOICES.map((choice) => (
                <Chip
                  key={choice.status}
                  selected={query.statuses.includes(choice.status)}
                  onToggle={(on) => {
                    change({ statuses: toggleStatus(query.statuses, choice.status, on) });
                  }}
                >
                  {choice.label}
                </Chip>
              ))}
            </div>
            <TagFilter
              tags={tags}
              selected={tagSelection}
              onChange={(next) => {
                change({ tags: [...next] });
              }}
              testId="media-library-tag-filter"
            />
          </div>
          {canWrite && <div className="tx-filter-row__end">{addButton('md')}</div>}
        </div>

        <div className="tx-media-library__browse">
          <FolderChips
            folders={folders}
            value={query.folder}
            counts={counts}
            onChange={(folder) => {
              change({ folder });
            }}
            onCreate={
              canWrite
                ? () => {
                    setFolderName({ mode: 'create' });
                  }
                : undefined
            }
            onRename={
              canWrite
                ? (folder) => {
                    setFolderName({ mode: 'rename', folder });
                  }
                : undefined
            }
            onDelete={canDeleteFolder ? setFolderToDelete : undefined}
          />
          <div className="tx-media-library__view">
            {/*
              Grid view has no column headers, so it always offers the Sort select. List view
              shows it only once the table has dropped a column (Size leaves first), so that
              sorting by size stays reachable; mediaLibrary.css does the showing.
            */}
            <label
              className={cx(
                'tx-media-library__sort',
                query.view === 'list' && 'tx-media-library__sort--list',
              )}
            >
              Sort by
              <Select
                size="sm"
                value={sortParam(query.sort)}
                onChange={(event) => {
                  change({ sort: parseSortParam(event.target.value) });
                }}
                data-testid="media-library-sort"
              >
                {LIBRARY_SORT_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </label>
            <Segmented
              label="View"
              iconOnly
              value={query.view}
              onChange={(view) => {
                change({ view });
              }}
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
              data-testid="media-library-refresh"
            />
          </div>
        </div>

        {storageTone !== 'ok' && (
          <Banner
            tone={storageTone === 'danger' ? 'danger' : 'warn'}
            title={storageTone === 'danger' ? 'Storage is nearly full' : 'Storage is filling up'}
          >
            {storageTone === 'danger'
              ? 'Delete media you no longer use to make room for uploads.'
              : 'Delete media you no longer use before it runs out.'}
          </Banner>
        )}

        {(processing || background !== null) && (
          <div className="tx-media-library__notes">
            {processing && (
              <span
                className="tx-media-library__checking-note"
                role="status"
                data-testid="media-library-processing-note"
              >
                <Spinner />
                Files are being checked. This list refreshes automatically.
              </span>
            )}
            {background !== null && (
              <Button
                size="sm"
                variant="ghost"
                icon={background.tone === 'busy' ? CloudUpload : TriangleExclamationPoint}
                className={
                  background.tone === 'warn' ? 'tx-media-library__uploads-warn' : undefined
                }
                onClick={() => {
                  openAdd();
                }}
                data-testid="media-library-uploads-status"
              >
                {background.label}
              </Button>
            )}
          </div>
        )}

        {ready && state.refreshError !== null && (
          <ErrorNotice
            error={state.refreshError}
            title="The list could not be refreshed"
            onRetry={refresh}
          />
        )}

        {query.view === 'list' ? (
          <DataTable
            caption={title}
            columns={columns}
            rows={list.rows}
            rowId={(media) => media.id}
            sort={query.sort}
            onSortChange={(sort) => {
              change({ sort });
            }}
            selection={
              canSelect
                ? {
                    selected,
                    onChange: setChosen,
                    rowLabel: (media) => mediaDisplayName(media),
                  }
                : undefined
            }
            rowActions={canSelect ? rowMenu : undefined}
            rowTestId={(media) => `media-library-row-${media.id}`}
            loading={loading || refreshing}
            empty={ready ? empty() : undefined}
            footer={list.matched.length > 0 ? pagination : undefined}
          />
        ) : loading ? (
          <SkeletonGroup label="Loading media">
            <TileGrid label={title}>
              {Array.from({ length: 8 }, (_, index) => (
                <TileSkeleton key={index} />
              ))}
            </TileGrid>
          </SkeletonGroup>
        ) : list.rows.length === 0 ? (
          <div className="tx-media-library__grid-empty">{empty()}</div>
        ) : (
          <>
            <TileGrid label={title} minTileWidth={220}>
              {list.rows.map((media) => (
                <Tile
                  key={media.id}
                  name={mediaDisplayName(media)}
                  to={`/media/${media.id}`}
                  media={<MediaThumb media={media} />}
                  meta={
                    <span className="tx-media-library__tile-meta">
                      <span className="tx-media-library__tile-line">
                        <span className="tx-media-library__tile-caption">{tileCaption(media)}</span>
                        {media.status !== 'ready' && <MediaStatusPill media={media} />}
                      </span>
                      <MediaFailureNote media={media} compact />
                    </span>
                  }
                  actions={canSelect ? rowMenu(media) : undefined}
                  selection={
                    canSelect
                      ? {
                          selected: selected.has(media.id),
                          label: mediaDisplayName(media),
                          onChange: (on) => {
                            setChosen(setMany(selected, [media.id], on));
                          },
                        }
                      : undefined
                  }
                  testId={`media-library-tile-${media.id}`}
                />
              ))}
            </TileGrid>
            <div className="tx-media-library__grid-footer">{pagination}</div>
          </>
        )}

        {canSelect && (
          <SelectionBar
            count={selected.size}
            label="Selected files"
            onClear={() => {
              setChosen(NONE_SELECTED);
            }}
          >
            {canWrite && (
              <Button
                variant="ghost"
                size="sm"
                icon={FolderInput}
                onClick={() => {
                  setMoveTarget(selectedItems());
                }}
                data-testid="media-library-bulk-move"
              >
                Move to folder
              </Button>
            )}
            {canWrite && (
              <Button
                variant="ghost"
                size="sm"
                icon={Tags}
                onClick={() => {
                  setTagTarget(selectedItems());
                }}
                data-testid="media-library-bulk-tags"
              >
                Add tags
              </Button>
            )}
            {canDeleteMedia && (
              <Button
                variant="danger"
                size="sm"
                icon={Trash}
                onClick={() => {
                  setDeleteMode('bulk');
                  setDeleteTargets(selectedItems());
                }}
                data-testid="media-library-bulk-delete"
              >
                Delete
              </Button>
            )}
          </SelectionBar>
        )}
      </div>

      {canWrite && dragging && !adding && (
        <div className="tx-media-library__drop-overlay" aria-hidden="true">
          <div className="tx-media-library__drop-card">
            <span className="tx-media-library__dropzone-icon">
              <Icon icon={CloudUpload} size={28} />
            </span>
            <p className="tx-media-library__dropzone-title">Drop the files to upload them</p>
            <p className="tx-small tx-muted">They go into the library, one at a time.</p>
          </div>
        </div>
      )}

      <AddMediaDialog
        open={adding}
        onClose={closeAdd}
        queue={queue}
        listed={listed}
        maxUploadBytes={limits.maxUploadBytes}
        dragging={dragging}
      />
      <AddToPlaylist
        media={playlistTarget}
        onClose={() => {
          setPlaylistTarget(null);
        }}
        onAdded={reload}
      />
      <MoveToFolderDialog
        open={moveTarget !== null}
        onClose={() => {
          setMoveTarget(null);
        }}
        items={(moveTarget ?? []).map((media) => ({ ...media, name: mediaDisplayName(media) }))}
        folders={folders}
        allowCreate={canWrite}
        onMoved={(ids) => {
          setChosen((current) => setMany(current, ids, false));
          reload();
        }}
        testId="media-library-move-dialog"
      />
      <TagsDialog
        open={tagTarget !== null}
        onClose={() => {
          setTagTarget(null);
        }}
        items={(tagTarget ?? []).map((media) => ({ ...media, name: mediaDisplayName(media) }))}
        tags={tags}
        allowCreate={canWrite}
        onSaved={reload}
        testId="media-library-tags-dialog"
      />
      <DeleteMediaDialog
        targets={deleteTargets}
        onClose={() => {
          setDeleteTargets(null);
        }}
        onDeleted={(ids) => {
          setChosen((current) => setMany(current, ids, false));
          afterChange();
          tags.reload();
        }}
        rowFocus={{
          mode: deleteMode,
          order: list.rows.map((media) => media.id),
          row: rowByTestId('media-library-row-', 'media-library-tile-'),
          primary: elementByTestId('media-library-add'),
        }}
      />
      <FolderNameDialog
        target={folderName}
        folders={folders}
        onClose={() => {
          setFolderName(null);
        }}
        onDone={(folder, mode) => {
          if (mode === 'create') change({ folder: folder.id });
        }}
      />
      <DeleteFolderDialog
        folder={folderToDelete}
        folders={folders}
        onClose={() => {
          setFolderToDelete(null);
        }}
        onDeleted={(folder) => {
          if (query.folder === folder.id) change({ folder: null });
          reload();
        }}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave while files are uploading?"
        confirmLabel="Leave and cancel uploads"
        cancelLabel="Stay"
        tone="danger"
        onConfirm={() => {
          blocker.proceed?.();
        }}
        onCancel={() => {
          blocker.reset?.();
        }}
      >
        <p>
          {uploads.active === 1
            ? 'A file is still being uploaded. Leaving the media library cancels it.'
            : `${uploads.active} files are still waiting or being uploaded. Leaving the media library cancels them.`}{' '}
          Files that have finished stay in the library.
        </p>
      </ConfirmDialog>
    </Page>
  );
}

/** An empty cell: a dash for the eye, words for assistive technology. */
function None() {
  return (
    <span className="tx-media-library__none">
      <span aria-hidden="true">–</span>
      <VisuallyHidden>Not known yet</VisuallyHidden>
    </span>
  );
}
