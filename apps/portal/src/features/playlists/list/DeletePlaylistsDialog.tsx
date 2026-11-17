import type { PlaylistSummaryDto } from '@tinnox/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../api/index.ts';
import { countOf, runInSequence, type BulkOutcome } from '../../../lib/bulkOutcome.ts';
import { assignedScreensLabel } from '../../../lib/playlistsList.ts';
import {
  deleteConfirmLabel,
  deletedNote,
  deletedToast,
  deleteFailureText,
  deleteFailureTitle,
  deleteQuestion,
  deleteRetryItems,
  mergeDeleteRetry,
} from '../../../lib/playlistsListActions.ts';
import { Banner, Button, ButtonLink, Dialog, useToast } from '../../../ui/index.ts';
import { CalendarDays, Monitor } from '../../../ui/icons.ts';
import { useRowFocusReturn, type RowFocusSource } from '../../shared/index.ts';
import './playlistsList.css';

type DeleteOutcome = BulkOutcome<PlaylistSummaryDto, null>;

export interface DeletePlaylistsDialogProps {
  /** The playlists to delete, one or many; null keeps the dialog closed. Read when it opens. */
  readonly targets: readonly PlaylistSummaryDto[] | null;
  /** Cancel, Escape, the close button, and after a delete that fully succeeded. */
  readonly onClose: () => void;
  /** Called after each attempt that deleted at least one playlist, with their ids. */
  readonly onDeleted: (ids: readonly string[]) => void;
  /** Where focus goes once the deleted rows have left the list. Read when it opens. */
  readonly rowFocus?: RowFocusSource;
}

interface Progress {
  readonly finished: number;
  readonly total: number;
}

/**
 * Confirms deleting one playlist or several, names them, and reports honestly: one request
 * per playlist, one after another, and every refusal listed with the server's reason and
 * error code. A playlist that a screen has assigned, or that a schedule uses, is refused by
 * the server (`playlist_in_use`); the dialog then says which screens or schedules and what to
 * do. "Try again" repeats only the ones that failed for another reason, and is not offered
 * when every failure is such a refusal: it could only be refused again.
 */
export function DeletePlaylistsDialog({
  targets,
  onClose,
  onDeleted,
  rowFocus,
}: DeletePlaylistsDialogProps) {
  const toast = useToast();
  const open = targets !== null;
  const returnFocus = useRowFocusReturn(
    open,
    (targets ?? []).map((playlist) => playlist.id),
    rowFocus,
  );
  // The list as it was when the dialog opened; it also stays while the dialog fades out.
  const [items, setItems] = useState<readonly PlaylistSummaryDto[]>(targets ?? []);
  const [outcome, setOutcome] = useState<DeleteOutcome | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const closeRef = useRef<HTMLButtonElement>(null);
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
  const failed = outcome?.failed ?? [];
  const assigned = items.filter((playlist) => playlist.assignedDisplayCount > 0);
  const retryable = outcome === null ? items : deleteRetryItems(outcome.failed);

  const run = async () => {
    if (busy) return;
    const pending = retryable;
    if (pending.length === 0) return;
    setProgress({ finished: 0, total: pending.length });
    const attempt = await runInSequence(
      pending,
      async (playlist) => {
        await api.deletePlaylist(playlist.id);
        return null;
      },
      (finished, of) => {
        setProgress({ finished, total: of });
      },
    );
    const merged = outcome === null ? attempt : mergeDeleteRetry(outcome, attempt);
    setProgress(null);
    if (attempt.done.length > 0) onDeleted(attempt.done.map((entry) => entry.item.id));
    if (merged.failed.length === 0) {
      onClose();
      toast.success(deletedToast(merged.done.map((entry) => entry.item.name)));
      return;
    }
    setOutcome(merged);
    if (deleteRetryItems(merged.failed).length === 0) {
      // The button that had focus leaves with "Try again"; Close takes it, inside the dialog.
      window.requestAnimationFrame(() => {
        closeRef.current?.focus();
      });
    }
  };

  const attempted = outcome !== null;
  const note = attempted ? deletedNote(outcome.done.length) : null;
  const refusals = failed.map((failure) =>
    deleteFailureText(failure.error, failure.item.assignedDisplayCount),
  );
  const anyByScreen = refusals.some((text) => text.inUse && !text.bySchedule);
  const anyBySchedule = refusals.some((text) => text.bySchedule);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={attempted ? deleteFailureTitle(failed.length, total) : deleteQuestion(total)}
      busy={busy}
      returnFocus={returnFocus}
      footerStart={
        busy && progress.total > 1 ? (
          <span role="status" data-testid="playlists-delete-progress">
            Deleting {Math.min(progress.finished + 1, progress.total)} of {progress.total}
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button
            ref={closeRef}
            onClick={onClose}
            aria-disabled={busy || undefined}
            data-autofocus
            data-testid="playlists-delete-cancel"
          >
            {attempted ? 'Close' : 'Cancel'}
          </Button>
          {retryable.length > 0 && (
            <Button
              variant={attempted ? 'secondary' : 'danger-solid'}
              busy={busy}
              onClick={() => {
                void run();
              }}
              data-testid={attempted ? 'playlists-delete-retry' : 'playlists-delete-confirm'}
            >
              {attempted ? 'Try again' : deleteConfirmLabel(total)}
            </Button>
          )}
        </>
      }
    >
      <div className="tx-stack" data-testid="playlists-delete-dialog">
        {!attempted && single !== undefined && (
          <p className="tx-break">
            <strong>{single.name}</strong> will be deleted with its sequence of items. The media in
            it stays in the library. This cannot be undone.
          </p>
        )}
        {!attempted && single === undefined && (
          <>
            <p>
              These {countOf(total, 'playlist')} will be deleted with their sequences of items. The
              media in them stays in the library. This cannot be undone.
            </p>
            <ul className="tx-playlists-list__names" aria-label="Playlists to delete">
              {items.map((playlist) => (
                <li key={playlist.id}>
                  <span className="tx-strong tx-break">{playlist.name}</span>
                  {playlist.assignedDisplayCount > 0 && (
                    <span className="tx-playlists-list__names-note">
                      Assigned to {assignedScreensLabel(playlist.assignedDisplayCount)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {!attempted && assigned.length > 0 && (
          <Banner
            tone="warn"
            icon={Monitor}
            title={
              single !== undefined
                ? `Assigned to ${assignedScreensLabel(single.assignedDisplayCount)}`
                : `${assigned.length} of these ${assigned.length === 1 ? 'is' : 'are'} assigned to screens`
            }
          >
            A playlist cannot be deleted while a screen has it assigned.{' '}
            {single !== undefined
              ? 'Assign other content there first, or this delete will be refused.'
              : 'Those will be refused and stay as they are; the others will be deleted.'}
          </Banner>
        )}
        {attempted && (
          <Banner
            tone="danger"
            live="assertive"
            actions={
              anyByScreen || anyBySchedule ? (
                <>
                  {anyByScreen && (
                    <ButtonLink size="sm" to="/screens" icon={Monitor}>
                      Go to Screens
                    </ButtonLink>
                  )}
                  {anyBySchedule && (
                    <ButtonLink size="sm" to="/schedules" icon={CalendarDays}>
                      Go to Schedules
                    </ButtonLink>
                  )}
                </>
              ) : undefined
            }
          >
            {note !== null && <p>{note}</p>}
            <ul className="tx-playlists-list__failures" data-testid="playlists-delete-failures">
              {failed.map(({ item, error }) => {
                const text = deleteFailureText(error, item.assignedDisplayCount);
                return (
                  <li key={item.id}>
                    <span className="tx-strong tx-break">{item.name}</span>:{' '}
                    <span className="tx-break">{text.message}</span>{' '}
                    {text.code !== null && <span className="tx-code">{text.code}</span>}
                    {text.hint !== null && (
                      <span className="tx-playlists-list__hint">{text.hint}</span>
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
