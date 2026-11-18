import { useState } from 'react';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { refusalNames, screenWording } from '../../lib/playlistsListActions.ts';
import { Banner, ConfirmDialog, ErrorNotice } from '../../ui/index.ts';

/** What the dialog needs of a layout: a list row and the editor's layout both fit. */
export interface LayoutToDelete {
  readonly id: string;
  readonly name: string;
}

export interface DeleteLayoutDialogProps {
  /** The layout to delete; null keeps the dialog closed. */
  readonly layout: LayoutToDelete | null;
  readonly onClose: () => void;
  /** After the server deleted it; the dialog has closed. */
  readonly onDeleted: (layout: LayoutToDelete) => void;
}

/**
 * Confirms deleting one layout. A screen that has it assigned makes the server refuse
 * (`layout_in_use`); the dialog then names those screens, so the operator knows where to
 * assign other content first. Any other refusal is shown with its error code.
 */
export function DeleteLayoutDialog({ layout, onClose, onDeleted }: DeleteLayoutDialogProps) {
  // The layout as it was when the dialog opened; it also stays while the dialog fades out.
  const [shown, setShown] = useState<LayoutToDelete | null>(layout);
  // The prop as last seen, null included, so reopening for the same layout starts afresh.
  const [previous, setPrevious] = useState<LayoutToDelete | null>(layout);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (layout !== previous) {
    setPrevious(layout);
    if (layout !== null) {
      setShown(layout);
      setError(null);
      setBusy(false);
    }
  }

  const refusal = isApiRequestError(error) && error.code === 'layout_in_use' ? error : null;
  const screens = refusal === null ? [] : refusalNames(refusal.details, 'display');

  const confirm = () => {
    if (busy || shown === null) return;
    const target = shown;
    setBusy(true);
    setError(null);
    api.deleteLayout(target.id).then(
      () => {
        setBusy(false);
        onClose();
        onDeleted(target);
      },
      (reason: unknown) => {
        setBusy(false);
        setError(reason);
      },
    );
  };

  return (
    <ConfirmDialog
      open={layout !== null}
      title={`Delete ${shown?.name ?? 'this layout'}?`}
      confirmLabel="Delete layout"
      tone="danger"
      busy={busy}
      onConfirm={confirm}
      onCancel={onClose}
      testId="layouts-delete-dialog"
    >
      <p>
        The layout is removed for good. Screens that already show it keep it until their next push.
      </p>
      {refusal !== null ? (
        <Banner tone="danger" live="assertive" title="This layout is assigned to a screen">
          <p>
            {screenWording(refusal.message)} <span className="tx-code">{refusal.code}</span>
          </p>
          {screens.length > 0 && (
            <ul data-testid="layouts-delete-screens">
              {screens.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </Banner>
      ) : (
        error !== null && <ErrorNotice error={error} title="The layout was not deleted" />
      )}
    </ConfirmDialog>
  );
}
