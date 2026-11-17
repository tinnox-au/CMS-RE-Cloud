import type { DisplayDto, PlaylistSummaryDto } from '@tinnox/contracts';
import { useState } from 'react';
import { api } from '../../../api/index.ts';
import { mergeBulkOutcomes, runInSequence, type BulkOutcome } from '../../../lib/bulkOutcome.ts';
import {
  assignConfirmLabel,
  assignPushView,
  assignResultNote,
  assignResultTitle,
  canPushAfterAssign,
  failureText,
} from '../../../lib/playlistsListActions.ts';
import { anyHasSchedule, SCHEDULE_REPLACED_NOTE } from '../../../lib/screensList.ts';
import { CircleCheck, Monitor, Send } from '../../../ui/icons.ts';
import {
  Banner,
  Button,
  Dialog,
  Icon,
  Skeleton,
  StatusPill,
  VisuallyHidden,
} from '../../../ui/index.ts';
import { usePush } from '../../push/PushContext.tsx';
import { PushStatePill, ScreenPickerDialog } from '../../shared/index.ts';
import './playlistsList.css';

type AssignOutcome = BulkOutcome<DisplayDto, DisplayDto>;

export interface AssignToScreensProps {
  /** The playlist to assign; null keeps both dialogs closed. */
  readonly playlist: PlaylistSummaryDto | null;
  /** Cancel in the picker, and Close, "Push now" or Escape in the result. */
  readonly onClose: () => void;
  /** Called after each attempt that assigned the playlist to at least one screen. */
  readonly onAssigned: () => void;
}

/**
 * "Assign to screens" of a playlist, in two steps. First the shared screen picker, with
 * several screens choosable. Then the result: one `PATCH` per chosen screen, one after
 * another, each reported by itself with the server's message and error code when it failed,
 * and "Try again" for the failed ones only. Assigning changes nothing on a screen
 * (assign, then push), so the result offers "Push now", which opens the push dialog on
 * exactly the screens that were assigned.
 */
export function AssignToScreens({ playlist, onClose, onAssigned }: AssignToScreensProps) {
  const push = usePush();
  const open = playlist !== null;
  // The playlist of this opening; it stays while a dialog fades out.
  const [shown, setShown] = useState<PlaylistSummaryDto | null>(playlist);
  const [outcome, setOutcome] = useState<AssignOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (playlist !== null) {
      setShown(playlist);
      setOutcome(null);
      setBusy(false);
    }
  }

  const assign = async (displays: readonly DisplayDto[], earlier: AssignOutcome | null) => {
    if (shown === null || busy || displays.length === 0) return;
    setBusy(true);
    const attempt = await runInSequence(displays, (display) =>
      api.patchDisplay(display.id, { assignedPlaylistId: shown.id }),
    );
    setBusy(false);
    setOutcome(earlier === null ? attempt : mergeBulkOutcomes(earlier, attempt));
    if (attempt.done.length > 0) {
      // What is waiting to be pushed has changed, and so has the list's "Screens" count.
      push.refresh();
      onAssigned();
    }
  };

  const done = outcome?.done ?? [];
  const failed = outcome?.failed ?? [];
  const doneIds = done.map((entry) => entry.item.id);
  const pushView = assignPushView(doneIds, push.plan, shown?.id ?? '');
  const canPush = canPushAfterAssign(done.length, pushView);
  const note = assignResultNote(shown?.name ?? '', done.length);
  const nothingWaiting = done.length > 0 && !canPush;

  const openPush = () => {
    onClose();
    push.openDialog({ only: doneIds, preselect: doneIds });
  };

  return (
    <>
      <ScreenPickerDialog
        open={open && outcome === null}
        onClose={onClose}
        multiple
        title="Assign to screens"
        description={
          shown === null
            ? undefined
            : (chosen) => (
                <>
                  <strong className="tx-break">{shown.name}</strong> replaces the playlist that each
                  chosen screen has now. Nothing changes on a screen until you push.
                  {anyHasSchedule(chosen) && ` ${SCHEDULE_REPLACED_NOTE}`}
                  {shown.itemCount === 0 &&
                    ' This playlist has no items yet, so it cannot be pushed until it has some.'}
                </>
              )
        }
        confirmLabel={assignConfirmLabel}
        disabledReason={(display) =>
          shown !== null && display.assignedPlaylist?.id === shown.id
            ? 'Already has this playlist'
            : null
        }
        busy={busy}
        onConfirm={(displays) => {
          void assign(displays, null);
        }}
        testId="playlists-assign-picker"
      />

      <Dialog
        open={open && outcome !== null}
        onClose={onClose}
        title={assignResultTitle(done.length, failed.length)}
        size="md"
        busy={busy}
        footer={
          <>
            <Button
              onClick={onClose}
              aria-disabled={busy || undefined}
              data-testid="playlists-assign-close"
            >
              Close
            </Button>
            {failed.length > 0 && (
              <Button
                variant={done.length === 0 ? 'primary' : 'secondary'}
                busy={busy}
                onClick={() => {
                  void assign(
                    failed.map((failure) => failure.item),
                    outcome,
                  );
                }}
                data-testid="playlists-assign-retry"
              >
                Try again
              </Button>
            )}
            {done.length > 0 && (
              <Button
                variant={canPush ? 'primary' : 'secondary'}
                icon={Send}
                aria-disabled={busy || undefined}
                onClick={openPush}
                data-autofocus
                data-testid="playlists-assign-push"
              >
                {canPush ? 'Push now' : 'Open Push to screens'}
              </Button>
            )}
          </>
        }
      >
        <div className="tx-stack" data-testid="playlists-assign-result">
          {note !== null && (
            <Banner tone="ok" live="polite">
              <span className="tx-break">{note}</span>
            </Banner>
          )}
          {failed.length > 0 && (
            <Banner tone="danger" live="assertive">
              {done.length === 0
                ? 'No screen was changed. The reason is next to each screen below.'
                : `${failed.length === 1 ? '1 screen was' : `${failed.length} screens were`} not changed. The reason is next to each one below.`}
            </Banner>
          )}
          <ul className="tx-playlists-list__results" aria-label="Result for each screen">
            {done.map(({ item }) => {
              const state = pushView.stateById.get(item.id);
              return (
                <li
                  key={item.id}
                  className="tx-playlists-list__result"
                  data-outcome="assigned"
                  data-testid={`playlists-assign-row-${item.id}`}
                >
                  <span className="tx-playlists-list__result-icon">
                    <Icon icon={Monitor} />
                  </span>
                  <span className="tx-playlists-list__result-text">
                    <span className="tx-strong tx-break">{item.name}</span>
                    <span className="tx-playlists-list__result-meta">
                      <Icon icon={CircleCheck} size={14} /> Assigned
                    </span>
                  </span>
                  <span className="tx-playlists-list__result-end">
                    {state !== undefined ? (
                      <PushStatePill state={state} />
                    ) : push.planError === null ? (
                      <>
                        <Skeleton variant="pill" width="112px" height="24px" />
                        <VisuallyHidden>Checking what is waiting to be pushed</VisuallyHidden>
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
            {failed.map(({ item, error }) => {
              const text = failureText(error);
              return (
                <li
                  key={item.id}
                  className="tx-playlists-list__result"
                  data-outcome="failed"
                  data-testid={`playlists-assign-row-${item.id}`}
                >
                  <span className="tx-playlists-list__result-icon">
                    <Icon icon={Monitor} />
                  </span>
                  <span className="tx-playlists-list__result-text">
                    <span className="tx-strong tx-break">{item.name}</span>
                    <span className="tx-playlists-list__result-meta tx-playlists-list__result-meta--failed">
                      <span className="tx-break">{text.message}</span>{' '}
                      {text.code !== null && <span className="tx-code">{text.code}</span>}
                    </span>
                  </span>
                  <span className="tx-playlists-list__result-end">
                    <StatusPill tone="danger">Not assigned</StatusPill>
                  </span>
                </li>
              );
            })}
          </ul>
          {nothingWaiting && (
            <p className="tx-small tx-muted" data-testid="playlists-assign-nothing-waiting">
              None of these screens has changes waiting, so there is nothing to push now. Push to
              screens says why for each one.
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
