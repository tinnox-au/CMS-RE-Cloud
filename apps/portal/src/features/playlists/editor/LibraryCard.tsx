import type { Limits, MediaDto, MediaListResponse } from '@tinnox/contracts';
import { useId, useMemo, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { LoadResult } from '../../../hooks/useLoad.ts';
import { LIBRARY_ROOT_LABEL } from '../../../lib/folderChoice.ts';
import { mediaDisplayName } from '../../../lib/mediaName.ts';
import {
  ALL_FOLDERS,
  capacityMessage,
  filterLibrary,
  libraryCountLabel,
  libraryFiltersActive,
  libraryMetaLabel,
  NO_LIBRARY_FILTERS,
  notReadyNote,
  readyMedia,
  remainingCapacity,
  ROOT_FOLDER,
  usageInDraft,
  usageLabel,
  type EditorDraft,
  type KindFilter,
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
];

export interface LibraryCardProps {
  readonly media: LoadResult<MediaListResponse>;
  readonly draft: EditorDraft;
  readonly limits: DraftLimits;
  readonly dragSource: RefObject<DragSource | null>;
  /** Appends the item to the sequence; returns where it went, or null when refused. */
  readonly onAdd: (media: MediaDto) => number | null;
}

/**
 * The ready media of the library, to add to the sequence: search, kind, folder and tag
 * filters over a grid of cards. A card is one button: pressing it (or Enter or Space)
 * appends the file to the sequence; dragging it onto the filmstrip puts it where it is
 * dropped. Only ready media is listed; the files that are not ready are counted.
 */
export function LibraryCard({ media, draft, limits, dragSource, onAdd }: LibraryCardProps) {
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
        title="Add ready media"
        size="title"
        description="Choose a file to add it at the end, or drag it to a place in the sequence."
        actions={
          <IconButton
            icon={RefreshCw}
            label="Refresh library"
            onClick={() => {
              media.reload();
              tags.reload();
              folders.reload();
            }}
            data-testid="playlist-editor-library-refresh"
          />
        }
      />

      <div className="tx-playlist-editor-library__filters">
        <SearchField
          label="Search media"
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
          disabled={folders.status === 'loading'}
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
            {libraryCountLabel(matches.length, ready.length, filtered)}
          </p>

          {ready.length === 0 ? (
            <EmptyState
              variant="inline"
              icon={Images}
              title="No ready media"
              action={
                <ButtonLink to="/media" icon={Plus}>
                  Open the media library
                </ButtonLink>
              }
            >
              Upload files in the media library. They can be added here once they are ready.
            </EmptyState>
          ) : matches.length === 0 ? (
            <EmptyState
              variant="inline"
              icon={SearchX}
              title="No media matches"
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
                Adds the file at the end of the sequence.
              </p>
              <ul className="tx-playlist-editor__library-grid" aria-label="Ready media">
                {matches.slice(0, shown).map((item) => {
                  const name = mediaDisplayName(item);
                  const used = usageLabel(usage.get(item.id) ?? 0);
                  const metaId = `${hintId}-${item.id}`;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="tx-playlist-editor-media"
                        draggable={!full}
                        aria-disabled={full || undefined}
                        aria-label={`Add ${name}`}
                        aria-describedby={`${metaId} ${hintId}`}
                        data-media-id={item.id}
                        data-testid="playlist-editor-library-item"
                        onClick={() => {
                          if (!full) onAdd(item);
                        }}
                        onDragStart={(event) => {
                          dragSource.current = { kind: 'media', media: item };
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
                        <span className="tx-playlist-editor-media__name tx-truncate">{name}</span>
                        <span id={metaId} className="tx-playlist-editor-media__details">
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
              {matches.length > shown && (
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
                    Showing {Math.min(shown, matches.length)} of {matches.length}
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
