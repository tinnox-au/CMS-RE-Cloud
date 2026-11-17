import type { AppDto, Limits, MediaListResponse } from '@tinnox/contracts';
import { useId, useMemo, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { LoadResult } from '../../../hooks/useLoad.ts';
import { LIBRARY_ROOT_LABEL } from '../../../lib/folderChoice.ts';
import { mediaDisplayName } from '../../../lib/mediaName.ts';
import {
  ALL_FOLDERS,
  appMetaLabel,
  capacityMessage,
  filterApps,
  filterLibrary,
  libraryCountLabel,
  libraryFiltersActive,
  libraryMetaLabel,
  mediaOnlyFilters,
  NO_LIBRARY_FILTERS,
  notReadyNote,
  readyMedia,
  remainingCapacity,
  ROOT_FOLDER,
  usageInDraft,
  usageLabel,
  type EditorDraft,
  type KindFilter,
  type LibraryEntry,
  type LibraryFilters,
} from '../../../lib/playlistEditor.ts';
import { pruneSelection } from '../../../lib/selection.ts';
import { Check, Images, Plus, RefreshCw, SearchX } from '../../../ui/icons.ts';
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorNotice,
  Icon,
  IconButton,
  SearchField,
  Select,
  Skeleton,
  SkeletonGroup,
} from '../../../ui/index.ts';
import { MediaThumb, TagFilter, useFolders, useTags } from '../../shared/index.ts';
import { APP_TYPE_ICONS } from '../../apps/appIcons.ts';
import { MEDIA_DRAG_TYPE, type DragSource } from './dragSource.ts';
import './playlistEditor.css';

type DraftLimits = Pick<
  Limits,
  'minImageItemDurationMs' | 'maxImageItemDurationMs' | 'maxPlaylistItems'
>;

/** Cards shown at first, and added by each "Show more". */
const PAGE = 30;

const KIND_CHOICES: readonly { readonly value: KindFilter; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'app', label: 'Apps' },
];

const NO_APPS: readonly AppDto[] = [];

export interface LibraryCardProps {
  readonly media: LoadResult<MediaListResponse>;
  readonly apps: LoadResult<AppDto[]>;
  readonly draft: EditorDraft;
  readonly limits: DraftLimits;
  readonly dragSource: RefObject<DragSource | null>;
  /** Appends the item to the sequence; returns where it went, or null when refused. */
  readonly onAdd: (entry: LibraryEntry) => number | null;
}

/**
 * The ready media of the library and the apps, to add to the sequence: search, kind, folder
 * and tag filters over a grid of cards. A card is one button: pressing it (or Enter or Space)
 * appends the file or app to the sequence; dragging it onto the filmstrip puts it where it
 * is dropped. Only ready media is listed; the files that are not ready are counted. Apps have
 * no folder or tag, so "All" lists them after the media only while neither filter is on.
 */
export function LibraryCard({ media, apps, draft, limits, dragSource, onAdd }: LibraryCardProps) {
  const tags = useTags('media');
  const folders = useFolders();
  const [filters, setFilters] = useState<LibraryFilters>(NO_LIBRARY_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const hintId = useId();

  const all = media.state.status === 'ready' ? media.state.data.items : null;
  const ready = useMemo(() => (all === null ? [] : readyMedia(all)), [all]);
  // A tag deleted elsewhere no longer filters anything.
  const tagFilter = useMemo(
    () =>
      tags.status === 'ready'
        ? pruneSelection(
            filters.tags,
            tags.tags.map((tag) => tag.id),
          )
        : filters.tags,
    [filters.tags, tags.status, tags.tags],
  );
  const effective = useMemo(() => ({ ...filters, tags: tagFilter }), [filters, tagFilter]);
  const matches = useMemo(() => filterLibrary(ready, effective), [ready, effective]);
  const appList = apps.state.status === 'ready' ? apps.state.data : NO_APPS;
  const appMatches = useMemo(() => filterApps(appList, effective), [appList, effective]);
  const entries = useMemo<readonly LibraryEntry[]>(
    () => [
      ...matches.map((item) => ({ kind: 'media' as const, media: item })),
      ...appMatches.map((app) => ({ kind: 'app' as const, app })),
    ],
    [matches, appMatches],
  );
  const appsOnly = filters.kind === 'app';
  const usage = useMemo(() => usageInDraft(draft), [draft]);
  const filtered = libraryFiltersActive(effective);
  const full = remainingCapacity(draft, limits) === 0;
  const notReady = all === null ? null : notReadyNote(all.length - ready.length);

  const setFilter = (change: Partial<LibraryFilters>) => {
    setFilters((previous) => ({ ...previous, ...change }));
    setShown(PAGE);
  };

  const folderOptions = folders.status === 'ready' ? folders.folders : [];

  return (
    <Card
      as="section"
      aria-labelledby="tx-playlist-editor-library"
      className="tx-playlist-editor-library"
      data-testid="playlist-editor-library"
    >
      <CardHeader
        id="tx-playlist-editor-library"
        title="Add media or apps"
        size="title"
        description="Choose a file or an app to add it at the end, or drag it to a place in the sequence."
        actions={
          <IconButton
            icon={RefreshCw}
            label="Refresh library"
            onClick={() => {
              media.reload();
              apps.reload();
              tags.reload();
              folders.reload();
            }}
            data-testid="playlist-editor-library-refresh"
          />
        }
      />

      <div className="tx-playlist-editor-library__filters">
        <SearchField
          label="Search media and apps"
          value={filters.query}
          onChange={(query) => {
            setFilter({ query });
          }}
          className="tx-playlist-editor-library__search"
          data-testid="playlist-editor-library-search"
        />
        <div className="tx-cluster" role="group" aria-label="Kind">
          {KIND_CHOICES.map((choice) => (
            <Chip
              key={choice.value}
              selected={filters.kind === choice.value}
              onToggle={() => {
                setFilter({ kind: choice.value });
              }}
            >
              {choice.label}
            </Chip>
          ))}
        </div>
        <Select
          size="sm"
          aria-label="Folder"
          value={filters.folder}
          disabled={folders.status === 'loading' || appsOnly}
          onChange={(event) => {
            setFilter({ folder: event.target.value });
          }}
          data-testid="playlist-editor-library-folder"
        >
          <option value={ALL_FOLDERS}>
            {folders.status === 'loading' ? 'Loading folders' : 'All folders'}
          </option>
          <option value={ROOT_FOLDER}>{LIBRARY_ROOT_LABEL}</option>
          {folderOptions.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </Select>
        <TagFilter
          tags={tags}
          disabled={appsOnly}
          selected={tagFilter}
          onChange={(next) => {
            setFilter({ tags: next });
          }}
          testId="playlist-editor-library-tags"
        />
      </div>

      {folders.status === 'error' && (
        <ErrorNotice
          error={folders.error}
          title="The folders could not be loaded"
          onRetry={folders.reload}
        />
      )}

      {full && (
        <div data-testid="playlist-editor-library-full">
          <Banner tone="warn" live="polite">
            {capacityMessage(limits)}
          </Banner>
        </div>
      )}

      {media.state.status === 'loading' && (
        <SkeletonGroup label="Loading media" className="tx-playlist-editor__library-grid">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="tx-stack tx-stack--tight">
              <Skeleton variant="block" height="96px" />
              <Skeleton width="70%" />
              <Skeleton width="45%" />
            </div>
          ))}
        </SkeletonGroup>
      )}

      {media.state.status === 'error' && (
        <ErrorNotice
          error={media.state.error}
          title="Media could not be loaded"
          onRetry={media.reload}
        />
      )}

      {apps.state.status === 'error' && (
        <ErrorNotice
          error={apps.state.error}
          title="Apps could not be loaded"
          onRetry={apps.reload}
        />
      )}

      {media.state.status === 'ready' && (
        <>
          {media.state.refreshError !== null && (
            <ErrorNotice
              error={media.state.refreshError}
              title="The list could not be refreshed"
              onRetry={media.reload}
            />
          )}

          <p
            className="tx-toolbar__count"
            aria-live="polite"
            data-testid="playlist-editor-library-count"
          >
            {libraryCountLabel(
              entries.length,
              ready.length + appList.length,
              filtered,
              appList.length > 0 ? 'item' : 'file',
            )}
          </p>

          {ready.length === 0 && appList.length === 0 ? (
            <EmptyState
              variant="inline"
              icon={Images}
              title="No ready media or apps"
              action={
                <ButtonLink to="/media" icon={Plus}>
                  Open the media library
                </ButtonLink>
              }
            >
              Upload files in the media library, or create an app under Apps. They can be added here
              once they are ready.
            </EmptyState>
          ) : entries.length === 0 ? (
            <EmptyState
              variant="inline"
              icon={SearchX}
              title="Nothing matches"
              action={
                <Button
                  onClick={() => {
                    setFilters(NO_LIBRARY_FILTERS);
                    setShown(PAGE);
                  }}
                >
                  Clear filters
                </Button>
              }
            >
              Nothing ready matches the search and filters.
            </EmptyState>
          ) : (
            <>
              <p id={hintId} className="tx-visually-hidden">
                Adds it at the end of the sequence.
              </p>
              {mediaOnlyFilters(effective) && filters.kind === 'all' && appList.length > 0 && (
                <p className="tx-small tx-muted">
                  Apps have no folder or tags, so they are not listed while those filters are on.
                </p>
              )}
              <ul className="tx-playlist-editor__library-grid" aria-label="Ready media and apps">
                {entries.slice(0, shown).map((entry) => {
                  if (entry.kind === 'app') {
                    const { app } = entry;
                    const used = usageLabel(usage.get(app.id) ?? 0);
                    return (
                      <li key={app.id}>
                        <button
                          type="button"
                          className="tx-playlist-editor-media"
                          draggable={!full}
                          aria-disabled={full || undefined}
                          aria-describedby={hintId}
                          data-app-id={app.id}
                          data-testid="playlist-editor-library-app"
                          onClick={() => {
                            if (!full) onAdd(entry);
                          }}
                          onDragStart={(event) => {
                            dragSource.current = entry;
                            event.dataTransfer.effectAllowed = 'copy';
                            event.dataTransfer.setData(MEDIA_DRAG_TYPE, app.id);
                            event.dataTransfer.setData('text/plain', app.name);
                          }}
                          onDragEnd={() => {
                            dragSource.current = null;
                          }}
                        >
                          <span className="tx-playlist-editor-media__thumb">
                            <span className="tx-playlist-editor-app-thumb">
                              <Icon icon={APP_TYPE_ICONS[app.content.type]} size={28} />
                            </span>
                            <span className="tx-playlist-editor-media__add" aria-hidden="true">
                              <Icon icon={Plus} size={16} />
                            </span>
                          </span>
                          {/* The name comes from the content, so it holds every word shown (WCAG 2.5.3). */}
                          <span className="tx-visually-hidden">Add </span>
                          <span
                            className="tx-playlist-editor-media__name tx-truncate"
                            title={app.name}
                          >
                            {app.name}
                          </span>
                          <span className="tx-visually-hidden">, </span>
                          <span className="tx-playlist-editor-media__details">
                            <span className="tx-playlist-editor-media__meta">
                              {appMetaLabel(app)}
                            </span>
                            {used !== null && (
                              <span className="tx-playlist-editor-media__used">
                                <Icon icon={Check} size={14} />
                                <span className="tx-visually-hidden">, </span>
                                {used}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  }
                  const item = entry.media;
                  const name = mediaDisplayName(item);
                  const used = usageLabel(usage.get(item.id) ?? 0);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="tx-playlist-editor-media"
                        draggable={!full}
                        aria-disabled={full || undefined}
                        aria-describedby={hintId}
                        data-media-id={item.id}
                        data-testid="playlist-editor-library-item"
                        onClick={() => {
                          if (!full) onAdd(entry);
                        }}
                        onDragStart={(event) => {
                          dragSource.current = entry;
                          event.dataTransfer.effectAllowed = 'copy';
                          event.dataTransfer.setData(MEDIA_DRAG_TYPE, item.id);
                          event.dataTransfer.setData('text/plain', name);
                        }}
                        onDragEnd={() => {
                          dragSource.current = null;
                        }}
                      >
                        <span className="tx-playlist-editor-media__thumb">
                          <MediaThumb media={item} size="fill" ratio="wide" />
                          <span className="tx-playlist-editor-media__add" aria-hidden="true">
                            <Icon icon={Plus} size={16} />
                          </span>
                        </span>
                        {/* The name comes from the content, so it holds every word shown (WCAG 2.5.3). */}
                        <span className="tx-visually-hidden">Add </span>
                        <span className="tx-playlist-editor-media__name tx-truncate" title={name}>
                          {name}
                        </span>
                        <span className="tx-visually-hidden">, </span>
                        <span className="tx-playlist-editor-media__details">
                          <span className="tx-playlist-editor-media__meta">
                            {libraryMetaLabel(item)}
                          </span>
                          {used !== null && (
                            <span className="tx-playlist-editor-media__used">
                              <Icon icon={Check} size={14} />
                              <span className="tx-visually-hidden">, </span>
                              {used}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {entries.length > shown && (
                <div className="tx-cluster tx-playlist-editor-library__more">
                  <Button
                    onClick={() => {
                      setShown((previous) => previous + PAGE);
                    }}
                    data-testid="playlist-editor-library-more"
                  >
                    Show more
                  </Button>
                  <span className="tx-small tx-muted">
                    Showing {Math.min(shown, entries.length)} of {entries.length}
                  </span>
                </div>
              )}
            </>
          )}

          {notReady !== null && (
            <p className="tx-small tx-muted">
              {notReady} See the <Link to="/media">media library</Link>.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
