import { useState } from 'react';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { refusalNames, screenWording } from '../../lib/playlistsListActions.ts';
import { Banner, ConfirmDialog, ErrorNotice } from '../../ui/index.ts';

/** What the dialog needs of a schedule: a list row and the editor's schedule both fit. */
export interface ScheduleToDelete {
  readonly id: string;
  readonly name: string;
}

export interface DeleteScheduleDialogProps {
  /** The schedule to delete; null keeps the dialog closed. */
  readonly schedule: ScheduleToDelete | null;
  readonly onClose: () => void;
  /** After the server deleted it; the dialog has closed. */
  readonly onDeleted: (schedule: ScheduleToDelete) => void;
}

/**
 * Confirms deleting one schedule. A screen that has it assigned makes the server refuse
 * (`schedule_in_use`); the dialog then names those screens, so the operator knows where to
 * assign other content first. Any other refusal is shown with its error code.
 */
export function DeleteScheduleDialog({ schedule, onClose, onDeleted }: DeleteScheduleDialogProps) {
  // The schedule as it was when the dialog opened; it also stays while the dialog fades out.
  const [shown, setShown] = useState<ScheduleToDelete | null>(schedule);
  // The prop as last seen, null included, so reopening for the same schedule starts afresh.
  const [previous, setPrevious] = useState<ScheduleToDelete | null>(schedule);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (schedule !== previous) {
    setPrevious(schedule);
    if (schedule !== null) {
      setShown(schedule);
      setError(null);
      setBusy(false);
    }
  }

  const refusal = isApiRequestError(error) && error.code === 'schedule_in_use' ? error : null;
  const screens = refusal === null ? [] : refusalNames(refusal.details, 'display');

  const confirm = () => {
    if (busy || shown === null) return;
    const target = shown;
    setBusy(true);
    setError(null);
    api.deleteSchedule(target.id).then(
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
      open={schedule !== null}
      title={`Delete ${shown?.name ?? 'this schedule'}?`}
      confirmLabel="Delete schedule"
      tone="danger"
      busy={busy}
      onConfirm={confirm}
      onCancel={onClose}
      testId="schedules-delete-dialog"
    >
      <p>
        The schedule is removed for good. Screens that already show it keep it until their next
        push.
      </p>
      {refusal !== null ? (
        <Banner tone="danger" live="assertive" title="This schedule is assigned to a screen">
          <p>
            {screenWording(refusal.message)} <span className="tx-code">{refusal.code}</span>
          </p>
          {screens.length > 0 && (
            <ul data-testid="schedules-delete-screens">
              {screens.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </Banner>
      ) : (
        error !== null && <ErrorNotice error={error} title="The schedule was not deleted" />
      )}
    </ConfirmDialog>
  );
}
