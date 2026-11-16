import type { MediaDto } from '@tinnox/contracts';
import { useState } from 'react';
import { isApiRequestError } from '../../../api/client.ts';
import { api } from '../../../api/index.ts';
import {
  bulkFailureTitle,
  countOf,
  mergeBulkOutcomes,
  runInSequence,
  type BulkOutcome,
} from '../../../lib/bulkOutcome.ts';
import {
  deletedNote,
  deletedToast,
  deleteUsageWarning,
  deleteWording,
} from '../../../lib/mediaLibraryActions.ts';
import { mediaDisplayName } from '../../../lib/mediaName.ts';
import { ListVideo } from '../../../ui/icons.ts';
import { Banner, Button, Dialog, ErrorNotice, useToast } from '../../../ui/index.ts';
import { useRowFocusReturn, type RowFocusSource } from '../../shared/index.ts';
import './mediaLibrary.css';

type DeleteOutcome = BulkOutcome<MediaDto, null>;

export interface DeleteMediaDialogProps {
  /** The files to delete, one or many; null keeps the dialog closed. Read when it opens. */
  readonly targets: readonly MediaDto[] | null;
  /** Cancel, Escape, the close button, and after a delete that fully succeeded. */
  readonly onClose: () => void;
  /** After each attempt that deleted at least one file, with their ids. */
  readonly onDeleted: (ids: readonly string[]) => void;
  /** Where focus goes once the deleted rows have left the list. Read when it opens. */
  readonly rowFocus?: RowFocusSource;
}

interface Progress {
  readonly finished: number;
  readonly total: number;
}

/** The playlists a `media_in_use` refusal names in its details. */
function playlistsNamed(error: unknown): string[] {
  if (!isApiRequestError(error) || error.code !== 'media_in_use') return [];
  return error.details.filter((detail) => detail.path === 'playlist').map((d) => d.message);
}

function failureMessage(error: unknown): { message: string; code: string | null } {
  if (isApiRequestError(error)) return { message: error.message, code: error.code };
  return {
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    code: null,
  };
}

/**
 * Confirms deleting one file (M0's "Delete this file?" and "Delete file") or several, then
 * deletes them one request at a time and reports honestly: every refusal is listed with the
 * server's message and error code as text, a file still in a playlist (`media_in_use`) with
 * the playlists the server named, and "Try again" repeats only the files that failed.
 */
export function DeleteMediaDialog({
  targets,
  onClose,
  onDeleted,
  rowFocus,
}: DeleteMediaDialogProps) {
  const toast = useToast();
  const open = targets !== null;
  const returnFocus = useRowFocusReturn(
    open,
    (targets ?? []).map((media) => media.id),
    rowFocus,
  );
  // The files as they were when the dialog opened; they also stay while it fades out.
  const [items, setItems] = useState<readonly MediaDto[]>(targets ?? []);
  const [outcome, setOutcome] = useState<DeleteOutcome | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (targets !== null) {
      setItems(targets);
      setOutcome(null);
      setProgress(null);
    }
  }

  const busy = progress !== null;
  const total = items.length;
  const single = total === 1 ? items[0] : undefined;
  const wording = deleteWording(total);
  const failed = outcome?.failed ?? [];
  const attempted = outcome !== null;
  const warning = attempted ? null : deleteUsageWarning(items);

  const run = async () => {
    if (busy) return;
    const pending = outcome === null ? items : outcome.failed.map((failure) => failure.item);
    if (pending.length === 0) return;
    setProgress({ finished: 0, total: pending.length });
    const attempt = await runInSequence(
      pending,
      async (media) => {
        await api.deleteMedia(media.id);
        return null;
      },
      (finished, of) => {
        setProgress({ finished, total: of });
      },
    );
    const merged = outcome === null ? attempt : mergeBulkOutcomes(outcome, attempt);
    setProgress(null);
    if (attempt.done.length > 0) onDeleted(attempt.done.map((entry) => entry.item.id));
    if (merged.failed.length === 0) {
      onClose();
      toast.success(deletedToast(merged.done.map((entry) => mediaDisplayName(entry.item))));
      return;
    }
    setOutcome(merged);
  };

  const singleFailure = single !== undefined ? failed[0] : undefined;
  const note = attempted ? deletedNote(outcome) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={wording.title}
      busy={busy}
      returnFocus={returnFocus}
      footerStart={
        busy && progress.total > 1 ? (
          <span role="status" className="tx-media-library__progress-note">
            Deleting {Math.min(progress.finished + 1, progress.total)} of {progress.total}
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button
            onClick={onClose}
            aria-disabled={busy || undefined}
            data-autofocus
            data-testid="media-library-delete-cancel"
          >
            {attempted ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant={attempted ? 'secondary' : 'danger-solid'}
            busy={busy}
            onClick={() => {
              void run();
            }}
            data-testid={attempted ? 'media-library-delete-retry' : 'media-library-delete-confirm'}
          >
            {attempted ? 'Try again' : wording.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="tx-stack" data-testid="media-library-delete-dialog">
        {single !== undefined ? (
          <p className="tx-break">
            <strong>{mediaDisplayName(single)}</strong> will be removed from the library. What
            screens were last pushed is a snapshot and is not changed by this. If a playlist still
            uses the file, the server refuses the deletion.
          </p>
        ) : (
          <>
            <p>
              These {countOf(total, 'file')} will be removed from the library. What screens were
              last pushed is a snapshot and is not changed by this. The server refuses to delete a
              file that a playlist still uses.
            </p>
            <ul className="tx-media-library__names" aria-label="Files to delete">
              {items.map((media) => (
                <li key={media.id}>
                  <span className="tx-strong tx-break">{mediaDisplayName(media)}</span>
                  {media.usageCount > 0 && (
                    <span className="tx-media-library__names-note">
                      In {countOf(media.usageCount, 'playlist')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {warning !== null && (
          <Banner tone="warn" icon={ListVideo} title="Used in a playlist">
            {warning}
          </Banner>
        )}

        {singleFailure !== undefined && (
          <ErrorNotice error={singleFailure.error} title="The file was not deleted" />
        )}

        {attempted && single === undefined && failed.length > 0 && (
          <Banner
            tone="danger"
            live="assertive"
            title={bulkFailureTitle(failed.length, total, 'file', 'deleted')}
          >
            {note !== null && <p>{note}</p>}
            <ul className="tx-media-library__failures" data-testid="media-library-delete-failures">
              {failed.map(({ item, error }) => {
                const { message, code } = failureMessage(error);
                const playlists = playlistsNamed(error);
                return (
                  <li key={item.id}>
                    <span className="tx-strong tx-break">{mediaDisplayName(item)}</span>:{' '}
                    <span className="tx-break">{message}</span>{' '}
                    {code !== null && <span className="tx-code">{code}</span>}
                    {playlists.length > 0 && (
                      <span className="tx-media-library__hint tx-break">
                        Used in {playlists.join(', ')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Banner>
        )}
      </div>
    </Dialog>
  );
}
