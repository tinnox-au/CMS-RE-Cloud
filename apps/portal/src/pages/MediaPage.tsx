import {
  MEDIA_ERROR_MESSAGES,
  MEDIA_MIME_TYPES,
  type MediaDto,
  type MediaListResponse,
} from '@tinnox/contracts';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { isAbort } from '../api/client.ts';
import { api, apiClient } from '../api/index.ts';
import { uploadMedia, type UploadHandle } from '../api/upload.ts';
import {
  Chip,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  Loading,
  PageHeader,
} from '../components/common.tsx';
import { MediaThumb } from '../components/MediaThumb.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { formatBytes, formatDurationMs, formatTimestamp } from '../lib/format.ts';
import {
  isFinished,
  newEntry,
  nextToStart,
  patchEntry,
  type UploadEntry,
} from '../lib/uploadQueue.ts';
import { useSession } from '../session/SessionContext.tsx';

const PROCESSING_POLL_MS = 2000;

function pollWhileProcessing(list: MediaListResponse): number | null {
  return list.items.some((item) => item.status === 'processing') ? PROCESSING_POLL_MS : null;
}

export function MediaStatusChip({ media }: { readonly media: MediaDto }) {
  if (media.status === 'ready') return <Chip tone="good">Ready</Chip>;
  if (media.status === 'failed') return <Chip tone="bad">Failed</Chip>;
  return <Chip tone="warn">Processing</Chip>;
}

/** The actionable explanation for a failed file, from the shared message table. */
export function MediaFailure({ media }: { readonly media: MediaDto }) {
  if (media.status !== 'failed') return null;
  return (
    <p className="field-error">
      {media.errorCode !== null
        ? MEDIA_ERROR_MESSAGES[media.errorCode]
        : 'The file was rejected. No reason was recorded.'}{' '}
      {media.errorCode !== null && <code className="code-tag">{media.errorCode}</code>}
      {media.errorDetail !== null && <span className="small muted"> {media.errorDetail}</span>}
    </p>
  );
}

function UploadRow({
  entry,
  onCancel,
  onRetry,
}: {
  readonly entry: UploadEntry;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
}) {
  const percent = entry.size > 0 ? Math.min(100, Math.round((entry.loaded / entry.size) * 100)) : 0;
  return (
    <li className="upload-row">
      <div className="upload-main">
        <span className="upload-name">{entry.name}</span>
        <span className="small muted">{formatBytes(entry.size)}</span>
      </div>
      {entry.status === 'queued' && <Chip tone="neutral">Waiting</Chip>}
      {entry.status === 'uploading' && (
        <span className="upload-progress">
          <progress max={100} value={percent} aria-label={`Upload progress for ${entry.name}`} />
          <span className="small">
            {percent >= 100 ? 'Sent, waiting for the server…' : `${percent}%`}
          </span>
        </span>
      )}
      {entry.status === 'done' && (
        <Chip tone="neutral">Uploaded; see its status in the list below</Chip>
      )}
      {entry.status === 'cancelled' && <Chip tone="neutral">Cancelled</Chip>}
      {entry.status === 'rejected' && (
        <span className="field-error">Not sent. {entry.localMessage}</span>
      )}
      {(entry.status === 'queued' || entry.status === 'uploading') && (
        <button type="button" className="button button-small" onClick={onCancel}>
          Cancel<span className="visually-hidden"> upload of {entry.name}</span>
        </button>
      )}
      {(entry.status === 'failed' || entry.status === 'cancelled') && (
        <button type="button" className="button button-small" onClick={onRetry}>
          Try again<span className="visually-hidden"> for {entry.name}</span>
        </button>
      )}
      {entry.status === 'failed' && (
        <div className="upload-error">
          <ErrorNotice error={entry.error} title="Upload failed" />
        </div>
      )}
    </li>
  );
}

export function MediaPage() {
  const { limits } = useSession();
  const [uploads, setUploads] = useState<readonly UploadEntry[]>([]);
  const files = useRef(new Map<string, File>());
  const active = useRef<{ id: string; handle: UploadHandle } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback((signal: AbortSignal) => api.listMedia(signal), []);
  // Refresh automatically only while the server says something is still being checked.
  const { state, reload } = useLoad(load, pollWhileProcessing);

  const anyProcessing =
    state.status === 'ready' && state.data.items.some((item) => item.status === 'processing');

  // Start the next queued upload whenever nothing is in flight. One at a time keeps
  // progress honest and the server's per-organisation storage accounting simple.
  useEffect(() => {
    if (active.current !== null) return;
    const next = nextToStart(uploads);
    if (next === null) return;
    const file = files.current.get(next.id);
    if (file === undefined) {
      setUploads((previous) => patchEntry(previous, next.id, { status: 'cancelled' }));
      return;
    }
    const id = next.id;
    const handle = uploadMedia(apiClient, file, (loaded) => {
      setUploads((previous) => patchEntry(previous, id, { loaded: Math.min(loaded, file.size) }));
    });
    active.current = { id, handle };
    setUploads((previous) => patchEntry(previous, id, { status: 'uploading', loaded: 0 }));
    handle.done
      .then(() => {
        files.current.delete(id);
        setUploads((previous) => patchEntry(previous, id, { status: 'done', loaded: file.size }));
        reload();
      })
      .catch((error: unknown) => {
        setUploads((previous) =>
          patchEntry(
            previous,
            id,
            isAbort(error) ? { status: 'cancelled' } : { status: 'failed', error },
          ),
        );
        // The outcome on the server may be unknown; show its current list.
        reload();
      })
      .finally(() => {
        if (active.current?.id === id) active.current = null;
        // Wake this effect so the next queued file starts.
        setUploads((previous) => [...previous]);
      });
  }, [uploads, reload]);

  // Abort an upload in flight if the operator leaves the page.
  useEffect(
    () => () => {
      active.current?.handle.cancel();
    },
    [],
  );

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    if (chosen.length === 0) return;
    const entries = chosen.map((file) => {
      const id = crypto.randomUUID();
      const entry = newEntry(id, file, limits);
      if (entry.status === 'queued') files.current.set(id, file);
      return entry;
    });
    setUploads((previous) => [...previous, ...entries]);
    // Allow choosing the same file again later.
    event.target.value = '';
  };

  const cancel = (id: string) => {
    if (active.current?.id === id) {
      active.current.handle.cancel();
      return;
    }
    setUploads((previous) => patchEntry(previous, id, { status: 'cancelled' }));
  };

  const retry = (id: string) => {
    if (!files.current.has(id)) return;
    setUploads((previous) =>
      patchEntry(previous, id, { status: 'queued', loaded: 0, error: null }),
    );
  };

  const clearFinished = () => {
    setUploads((previous) => {
      for (const entry of previous) if (isFinished(entry)) files.current.delete(entry.id);
      return previous.filter((entry) => !isFinished(entry));
    });
  };

  const [toDelete, setToDelete] = useState<MediaDto | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const confirmDelete = () => {
    if (toDelete === null) return;
    setDeleteBusy(true);
    setDeleteError(null);
    api
      .deleteMedia(toDelete.id)
      .then(() => {
        reload();
      })
      .catch((error: unknown) => {
        setDeleteError(error);
      })
      .finally(() => {
        setDeleteBusy(false);
        setToDelete(null);
      });
  };

  return (
    <>
      <PageHeader title="Media library">
        <p className="muted">
          JPEG and PNG images and MP4 video (H.264), up to {formatBytes(limits.maxUploadBytes)} per
          file. Every file is inspected before it can be used; video plays muted.
        </p>
      </PageHeader>

      <section className="panel" aria-labelledby="upload-heading">
        <h2 id="upload-heading">Upload</h2>
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          Choose files to upload
        </button>
        <input
          ref={inputRef}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          type="file"
          multiple
          accept={MEDIA_MIME_TYPES.join(',')}
          onChange={addFiles}
        />
        {uploads.length > 0 && (
          <>
            <ul className="upload-list" aria-label="Uploads">
              {uploads.map((entry) => (
                <UploadRow
                  key={entry.id}
                  entry={entry}
                  onCancel={() => {
                    cancel(entry.id);
                  }}
                  onRetry={() => {
                    retry(entry.id);
                  }}
                />
              ))}
            </ul>
            {uploads.some(isFinished) && (
              <button type="button" className="button button-small" onClick={clearFinished}>
                Clear finished uploads
              </button>
            )}
          </>
        )}
      </section>

      {deleteError !== null && <ErrorNotice error={deleteError} title="The file was not deleted" />}

      {state.status === 'loading' && <Loading label="Loading media…" />}
      {state.status === 'error' && (
        <ErrorNotice error={state.error} title="Media could not be loaded" onRetry={reload} />
      )}
      {state.status === 'ready' && (
        <section aria-labelledby="library-heading">
          <div className="panel-head">
            <h2 id="library-heading">Files</h2>
            <p className="small muted storage">
              <meter
                min={0}
                max={state.data.storage.limitBytes}
                high={state.data.storage.limitBytes * 0.9}
                value={Math.min(state.data.storage.usedBytes, state.data.storage.limitBytes)}
                aria-label="Storage used"
              />{' '}
              {formatBytes(state.data.storage.usedBytes)} of{' '}
              {formatBytes(state.data.storage.limitBytes)} used
            </p>
          </div>
          {state.refreshError !== null && (
            <ErrorNotice error={state.refreshError} title="The list could not be refreshed" />
          )}
          {anyProcessing && (
            <p className="small muted" role="status">
              Files are being checked. This list refreshes automatically.
            </p>
          )}
          {state.data.items.length === 0 ? (
            <EmptyState title="No media yet">
              <p>Upload an image or a video to start building a playlist.</p>
            </EmptyState>
          ) : (
            <ul className="media-grid">
              {state.data.items.map((media) => (
                <li key={media.id} className="media-card">
                  <MediaThumb media={media} />
                  <div className="media-body">
                    <p className="media-name">{media.originalName}</p>
                    <p>
                      <MediaStatusChip media={media} />{' '}
                      <span className="small muted">
                        {media.kind}
                        {media.width !== null &&
                          media.height !== null &&
                          `, ${media.width} × ${media.height}`}
                        {media.durationMs !== null && `, ${formatDurationMs(media.durationMs)}`}
                        {media.bytes !== null && `, ${formatBytes(media.bytes)}`}
                      </span>
                    </p>
                    <MediaFailure media={media} />
                    <p className="small muted">Uploaded {formatTimestamp(media.createdAt)}</p>
                    <button
                      type="button"
                      className="button button-small button-danger"
                      onClick={() => {
                        setDeleteError(null);
                        setToDelete(media);
                      }}
                    >
                      Delete<span className="visually-hidden"> {media.originalName}</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this file?"
        confirmLabel="Delete file"
        danger
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => {
          setToDelete(null);
        }}
      >
        <p>
          “{toDelete?.originalName ?? ''}” will be removed from the library. Publications that are
          already live are snapshots and are not changed by this. If a playlist still uses the file
          the server refuses the deletion.
        </p>
      </ConfirmDialog>
    </>
  );
}
