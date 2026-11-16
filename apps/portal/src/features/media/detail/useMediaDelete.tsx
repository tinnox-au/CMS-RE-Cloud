import type { MediaDto, MediaUsageResponse } from '@tinnox/contracts';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/index.ts';
import { deleteConsequence } from '../../../lib/mediaDetailFacts.ts';
import { deletedMessage } from '../../../lib/mediaDetailState.ts';
import { ConfirmDialog, ErrorNotice, useToast } from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';

interface DeleteState {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: unknown;
}

const CLOSED: DeleteState = { open: false, busy: false, error: null };

export interface MediaDelete {
  /** Opens the confirmation. */
  readonly ask: () => void;
  /** True from the moment the server confirmed the deletion: the page is about to leave. */
  readonly deleted: boolean;
  /** The confirmation dialog; render it always. */
  readonly dialog: ReactNode;
}

export interface UseMediaDeleteOptions {
  readonly media: MediaDto;
  /** Where the file is used, when known: the confirmation says what the server will decide. */
  readonly usage: MediaUsageResponse | null;
  /** Runs before the page leaves, so a guard against unsaved changes lets it go. */
  readonly onDeleted?: () => void;
  /** After a refusal, for example to read again where the file is used. */
  readonly onRefused?: () => void;
}

/**
 * Deleting the file from the details page, as M0 deletes it: a confirmation that names the
 * file and what happens, the server's refusal (`media_in_use`) shown as text inside the
 * dialog, and back to the library with a toast once the server has confirmed it.
 */
export function useMediaDelete({
  media,
  usage,
  onDeleted,
  onRefused,
}: UseMediaDeleteOptions): MediaDelete {
  const [state, setState] = useState<DeleteState>(CLOSED);
  const [deleted, setDeleted] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const push = usePush();

  const confirm = () => {
    if (state.busy) return;
    setState({ open: true, busy: true, error: null });
    api.deleteMedia(media.id).then(
      () => {
        setDeleted(true);
        onDeleted?.();
        setState(CLOSED);
        toast.success(deletedMessage(media.name));
        push.refresh();
        void navigate('/media', { replace: true });
      },
      (error: unknown) => {
        setState({ open: true, busy: false, error });
        onRefused?.();
      },
    );
  };

  const dialog = (
    <ConfirmDialog
      open={state.open}
      title="Delete this file?"
      confirmLabel="Delete file"
      tone="danger"
      busy={state.busy}
      onConfirm={confirm}
      onCancel={() => {
        if (!state.busy) setState(CLOSED);
      }}
    >
      <div className="tx-media-detail-confirm" data-testid="media-detail-delete-dialog">
        {state.error !== null && (
          <ErrorNotice error={state.error} title="The file was not deleted" />
        )}
        <p>
          <strong className="tx-break">“{media.name}”</strong> will be removed from the library.{' '}
          {media.status === 'ready' ? deleteConsequence(usage) : null}
        </p>
        <p className="tx-muted">
          What screens were already pushed is a snapshot and does not change.
        </p>
      </div>
    </ConfirmDialog>
  );

  return {
    ask: () => {
      setState({ open: true, busy: false, error: null });
    },
    deleted,
    dialog,
  };
}
