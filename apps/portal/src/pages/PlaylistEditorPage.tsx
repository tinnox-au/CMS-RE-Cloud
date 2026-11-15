import {
  FIT_MODES,
  type DisplayDto,
  type FitMode,
  type MediaDto,
  type PlaylistDto,
  type PublishResponse,
} from '@tinnox/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { isApiRequestError, isOutcomeUnknown } from '../api/client.ts';
import { api } from '../api/index.ts';
import {
  Chip,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  Field,
  Id,
  Loading,
  Notice,
  PageHeader,
} from '../components/common.tsx';
import { MediaThumb } from '../components/MediaThumb.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { formatDurationMs, formatTimestamp } from '../lib/format.ts';
import {
  appendMedia,
  draftFromPlaylist,
  draftLoopMs,
  isDirty,
  moveItem,
  removeItem,
  updateItem,
  validateDraft,
  type DraftErrors,
  type DraftItem,
  type PlaylistDraft,
} from '../lib/playlistDraft.ts';
import {
  intentAfter,
  intentFor,
  intentSignature,
  type PublishIntent,
} from '../lib/publishIntent.ts';
import { useSession } from '../session/SessionContext.tsx';
import { MediaFailure, MediaStatusChip } from './MediaPage.tsx';

const NO_ERRORS: DraftErrors = { name: null, form: null, items: {} };

function ItemRow({
  item,
  index,
  count,
  error,
  onMove,
  onRemove,
  onChange,
}: {
  readonly item: DraftItem;
  readonly index: number;
  readonly count: number;
  readonly error: string | undefined;
  readonly onMove: (delta: number) => void;
  readonly onRemove: () => void;
  readonly onChange: (change: Partial<Pick<DraftItem, 'durationText' | 'fit'>>) => void;
}) {
  const { media } = item;
  const position = index + 1;
  return (
    <li className="item-row">
      <span className="item-position" aria-hidden="true">
        {position}
      </span>
      <MediaThumb media={media} />
      <div className="item-main">
        <p className="media-name">{media.originalName}</p>
        <p className="small muted">
          {media.kind}
          {media.width !== null &&
            media.height !== null &&
            `, ${media.width} × ${media.height}`}{' '}
          {media.status !== 'ready' && <MediaStatusChip media={media} />}
        </p>
        {media.status !== 'ready' && (
          <p className="field-error">
            This file is not ready, so the playlist cannot be published with it.
          </p>
        )}
        <MediaFailure media={media} />
      </div>
      <div className="item-controls">
        {media.kind === 'image' ? (
          <Field label="Seconds on screen" error={error}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                type="text"
                inputMode="decimal"
                className="input-number"
                value={item.durationText}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => {
                  onChange({ durationText: event.target.value });
                }}
              />
            )}
          </Field>
        ) : (
          <div className="field">
            <span className="label">Duration</span>
            <p className="readonly-value">
              {media.durationMs === null ? 'Unknown' : formatDurationMs(media.durationMs)}
              <span className="small muted"> (length of the video)</span>
            </p>
          </div>
        )}
        <Field label="Fit">
          {({ id }) => (
            <select
              id={id}
              value={item.fit ?? ''}
              onChange={(event) => {
                const fit: FitMode | undefined = FIT_MODES.find(
                  (mode) => mode === event.target.value,
                );
                onChange({ fit: fit ?? null });
              }}
            >
              <option value="">Display default</option>
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
            </select>
          )}
        </Field>
      </div>
      <div className="item-actions">
        <button
          type="button"
          className="button button-small"
          disabled={index === 0}
          onClick={() => {
            onMove(-1);
          }}
        >
          Up<span className="visually-hidden">: move {media.originalName} earlier</span>
        </button>
        <button
          type="button"
          className="button button-small"
          disabled={index === count - 1}
          onClick={() => {
            onMove(1);
          }}
        >
          Down<span className="visually-hidden">: move {media.originalName} later</span>
        </button>
        <button type="button" className="button button-small button-danger" onClick={onRemove}>
          Remove
          <span className="visually-hidden">
            {' '}
            {media.originalName} from position {position}
          </span>
        </button>
      </div>
    </li>
  );
}

function PublishPanel({
  playlist,
  dirty,
  displays,
}: {
  readonly playlist: PlaylistDto;
  readonly dirty: boolean;
  readonly displays: readonly DisplayDto[];
}) {
  const [displayId, setDisplayId] = useState(() =>
    displays.length === 1 ? (displays[0]?.id ?? '') : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [result, setResult] = useState<{ response: PublishResponse; displayName: string } | null>(
    null,
  );
  // Survives re-renders but not a page reload: a reload is a new intent.
  const pending = useRef<PublishIntent | null>(null);

  const publish = () => {
    const display = displays.find((candidate) => candidate.id === displayId);
    if (display === undefined || busy || dirty) return;
    const signature = intentSignature(playlist.id, display.id, playlist.updatedAt);
    const intent = intentFor(pending.current, signature, () => crypto.randomUUID());
    pending.current = intent;
    setBusy(true);
    setError(null);
    setUnknownOutcome(false);
    setResult(null);
    api
      .publish(playlist.id, display.id, intent.key)
      .then((response) => {
        pending.current = intentAfter(intent, 'succeeded');
        setResult({ response, displayName: display.name });
      })
      .catch((reason: unknown) => {
        const unknown = isOutcomeUnknown(reason);
        pending.current = intentAfter(intent, unknown ? 'unknown' : 'refused');
        setUnknownOutcome(unknown);
        setError(reason);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const rejected = isApiRequestError(error) && error.code === 'publication_rejected';

  return (
    <section className="panel" aria-labelledby="publish-heading">
      <h2 id="publish-heading">Publish</h2>
      <p>
        Publishing takes a snapshot of the saved playlist for one display. Later edits to this draft
        do not change what is live until you publish again.
      </p>
      {displays.length === 0 ? (
        <p>
          There is no display to publish to. <Link to="/displays/new">Create a display</Link> first.
        </p>
      ) : (
        <div className="inline-form">
          <Field label="Display">
            {({ id }) => (
              <select
                id={id}
                value={displayId}
                onChange={(event) => {
                  setDisplayId(event.target.value);
                }}
              >
                <option value="">Choose a display</option>
                {displays.map((display) => (
                  <option key={display.id} value={display.id}>
                    {display.name} ({display.canvas.width} × {display.canvas.height})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button
            type="button"
            className="button button-primary"
            disabled={busy || dirty || displayId === ''}
            onClick={publish}
          >
            {busy ? 'Publishing…' : unknownOutcome ? 'Retry publish' : 'Publish to display'}
          </button>
        </div>
      )}
      {dirty && (
        <p className="field-error" role="status">
          Save the draft first. Only the saved playlist can be published.
        </p>
      )}
      {result !== null && (
        <Notice tone="good" title="Publication created" live>
          <p>
            Publication <Id value={result.response.publicationId} /> for “{result.displayName}”
            holds {result.response.manifest.assets.length}{' '}
            {result.response.manifest.assets.length === 1 ? 'item' : 'items'}, created{' '}
            {formatTimestamp(result.response.createdAt)}.
            {result.response.replayed &&
              ' The server recognised this as a repeat of an earlier request and returned the same publication.'}
          </p>
          <p>
            This is now the desired publication. Whether the player has downloaded and started it is
            shown under{' '}
            <Link to={`/displays/${result.response.displayId}`}>
              the display&apos;s live status
            </Link>
            .
          </p>
        </Notice>
      )}
      {error !== null && (
        <>
          <ErrorNotice
            error={error}
            title={rejected ? 'Publishing was refused' : 'Publishing did not complete'}
          />
          {rejected && <p>Nothing was published. What is live on the display has not changed.</p>}
          {unknownOutcome && (
            <p>
              It is not known whether the publication was created. Retrying is safe: the same
              request key is sent again, so at most one publication results.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Editor({
  initial,
  displays,
}: {
  readonly initial: PlaylistDto;
  readonly displays: readonly DisplayDto[];
}) {
  const { limits } = useSession();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<PlaylistDraft>(() => draftFromPlaylist(initial));
  const [errors, setErrors] = useState<DraftErrors>(NO_ERRORS);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const loadMedia = useCallback((signal: AbortSignal) => api.listMedia(signal), []);
  const media = useLoad(loadMedia);

  const dirty = isDirty(draft, saved);
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  const change = (next: PlaylistDraft) => {
    setDraft(next);
    setSavedAt(null);
  };

  const add = (item: MediaDto) => {
    change(appendMedia(draft, item, crypto.randomUUID()));
    setAnnouncement(`Added ${item.originalName} at position ${draft.items.length + 1}.`);
  };

  const move = (index: number, delta: number) => {
    const item = draft.items[index];
    const next = moveItem(draft, index, delta);
    if (next === draft || item === undefined) return;
    change(next);
    setAnnouncement(`Moved ${item.media.originalName} to position ${index + delta + 1}.`);
  };

  const save = () => {
    const result = validateDraft(draft, limits);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors(NO_ERRORS);
    setSaveError(null);
    setSaving(true);
    api
      .replacePlaylist(saved.id, result.value)
      .then((playlist) => {
        setSaved(playlist);
        setDraft(draftFromPlaylist(playlist));
        setSavedAt(playlist.updatedAt);
      })
      .catch((error: unknown) => {
        setSaveError(error);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const discard = () => {
    setDraft(draftFromPlaylist(saved));
    setErrors(NO_ERRORS);
    setSaveError(null);
  };

  const loopMs = draftLoopMs(draft, limits);
  const readyMedia =
    media.state.status === 'ready'
      ? media.state.data.items.filter((item) => item.status === 'ready')
      : [];
  const notReadyCount =
    media.state.status === 'ready' ? media.state.data.items.length - readyMedia.length : 0;
  const itemErrorCount = Object.keys(errors.items).length;

  return (
    <>
      <p className="breadcrumb">
        <Link to="/playlists">Playlists</Link> / <span>{saved.name}</span>
      </p>
      <PageHeader
        title={saved.name}
        actions={
          <>
            {dirty ? <Chip tone="warn">Unsaved changes</Chip> : <Chip tone="neutral">Saved</Chip>}
            <button type="button" className="button" onClick={discard} disabled={!dirty || saving}>
              Discard changes
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={save}
              disabled={!dirty || saving}
            >
              {saving ? 'Saving…' : 'Save draft'}
            </button>
          </>
        }
      >
        <p className="small muted">
          Draft last saved {formatTimestamp(saved.updatedAt)}. Saving replaces the whole item list.
        </p>
      </PageHeader>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {savedAt !== null && !dirty && (
        <Notice tone="good" live>
          <p>Draft saved. This did not change any display: publish to deliver the new version.</p>
        </Notice>
      )}
      {saveError !== null && <ErrorNotice error={saveError} title="The draft was not saved" />}
      {(errors.form !== null || itemErrorCount > 0) && (
        <div className="notice notice-bad" role="alert">
          <p className="notice-title">The draft was not saved.</p>
          {errors.form !== null && <p>{errors.form}</p>}
          {itemErrorCount > 0 && (
            <p>
              {itemErrorCount === 1
                ? 'One item has an invalid duration.'
                : `${itemErrorCount} items have an invalid duration.`}
            </p>
          )}
        </div>
      )}

      <section className="panel" aria-labelledby="items-heading">
        <Field label="Playlist name" error={errors.name ?? undefined}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              type="text"
              value={draft.name}
              maxLength={120}
              autoComplete="off"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                change({ ...draft, name: event.target.value });
              }}
            />
          )}
        </Field>

        <div className="panel-head">
          <h2 id="items-heading">Items</h2>
          <p className="small muted">
            {draft.items.length} {draft.items.length === 1 ? 'item' : 'items'}
            {loopMs !== null && draft.items.length > 0 && `, one pass ${formatDurationMs(loopMs)}`}.
            Images show for {limits.minImageItemDurationMs / 1000} to{' '}
            {limits.maxImageItemDurationMs / 1000} s; videos play muted for their own length.
          </p>
        </div>
        {draft.items.length === 0 ? (
          <EmptyState title="This playlist is empty">
            <p>Add ready media from the list below. An empty playlist cannot be published.</p>
          </EmptyState>
        ) : (
          <ol className="item-list">
            {draft.items.map((item, index) => (
              <ItemRow
                key={item.key}
                item={item}
                index={index}
                count={draft.items.length}
                error={errors.items[item.key]}
                onMove={(delta) => {
                  move(index, delta);
                }}
                onRemove={() => {
                  change(removeItem(draft, item.key));
                  setAnnouncement(`Removed ${item.media.originalName}.`);
                }}
                onChange={(itemChange) => {
                  change(updateItem(draft, item.key, itemChange));
                }}
              />
            ))}
          </ol>
        )}
      </section>

      <section className="panel" aria-labelledby="add-heading">
        <div className="panel-head">
          <h2 id="add-heading">Add ready media</h2>
          <button type="button" className="button button-small" onClick={media.reload}>
            Refresh list
          </button>
        </div>
        {media.state.status === 'loading' && <Loading label="Loading media…" />}
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
              />
            )}
            {readyMedia.length === 0 ? (
              <EmptyState title="No ready media">
                <p>
                  Upload files in the <Link to="/media">media library</Link>. They can be added here
                  once they are ready.
                </p>
              </EmptyState>
            ) : (
              <ul className="add-list">
                {readyMedia.map((item) => (
                  <li key={item.id} className="add-row">
                    <MediaThumb media={item} />
                    <span className="add-name">
                      {item.originalName}
                      <span className="small muted">
                        {' '}
                        {item.kind}
                        {item.durationMs !== null && `, ${formatDurationMs(item.durationMs)}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="button button-small"
                      disabled={draft.items.length >= limits.maxPlaylistItems}
                      onClick={() => {
                        add(item);
                      }}
                    >
                      Add
                      <span className="visually-hidden"> {item.originalName} to the playlist</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {notReadyCount > 0 && (
              <p className="small muted">
                {notReadyCount} {notReadyCount === 1 ? 'file is' : 'files are'} still processing or
                failed and cannot be added. See the <Link to="/media">media library</Link>.
              </p>
            )}
          </>
        )}
      </section>

      <PublishPanel playlist={saved} dirty={dirty} displays={displays} />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        confirmLabel="Leave and discard changes"
        danger
        onConfirm={() => {
          blocker.proceed?.();
        }}
        onCancel={() => {
          blocker.reset?.();
        }}
      >
        <p>This playlist has unsaved changes. They will be lost if you leave this page.</p>
      </ConfirmDialog>
    </>
  );
}

export function PlaylistEditorPage() {
  const { id } = useParams();
  const playlistId = id ?? '';
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [playlist, displays] = await Promise.all([
        api.getPlaylist(playlistId, signal),
        api.listDisplays(signal),
      ]);
      return { playlist, displays };
    },
    [playlistId],
  );
  const { state, reload } = useLoad(load);

  if (state.status === 'loading') return <Loading label="Loading playlist…" />;
  if (state.status === 'error') {
    return (
      <>
        <PageHeader title="Playlist" />
        <ErrorNotice
          error={state.error}
          title="The playlist could not be loaded"
          onRetry={reload}
        />
        <p>
          <Link to="/playlists">Back to playlists</Link>
        </p>
      </>
    );
  }
  return (
    <Editor
      key={state.data.playlist.id}
      initial={state.data.playlist}
      displays={state.data.displays}
    />
  );
}
