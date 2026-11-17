import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router-dom';
import { ConfirmDialog } from '../../ui/index.ts';

export interface LeaveGuard {
  /** Lets the next navigation through without asking, for example after a deletion. */
  readonly release: () => void;
  /** The confirmation dialog; render it always. */
  readonly dialog: ReactNode;
}

/**
 * Asks before leaving while there are unsaved changes, as the M0 playlist editor did: the
 * router's blocker for links inside the portal (a confirmation dialog) and the browser's own
 * prompt for reloading or closing the tab. A change of the query or the fragment alone is not
 * leaving. Used by every editor page (media details, playlist editor, screen details, the
 * Add screen wizard) so the question and its buttons read the same everywhere.
 */
/**
 * `objectName` names what is being edited; null when it has no name yet. Pass `saving` while a
 * save is still running: the changes count as unsaved until its answer arrives, because a
 * save can still fail (FCX-04 in docs/reviews/2026-11-17-frontend-round-2), and the
 * question then says so.
 */
export function useLeaveGuard(
  dirty: boolean,
  objectName: string | null,
  saving = false,
): LeaveGuard {
  const released = useRef(false);
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirty && !released.current && currentLocation.pathname !== nextLocation.pathname,
    [dirty],
  );
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (released.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  const dialog = (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title="Leave without saving?"
      confirmLabel="Leave and discard changes"
      cancelLabel="Stay on this page"
      tone="danger"
      testId="leave-dialog"
      onConfirm={() => {
        blocker.proceed?.();
      }}
      onCancel={() => {
        blocker.reset?.();
      }}
    >
      {saving ? (
        <p>
          {objectName === null ? (
            'Your changes are still being saved.'
          ) : (
            <>
              The changes to <strong className="tx-break">“{objectName}”</strong> are still being
              saved.
            </>
          )}{' '}
          If you leave now and the save fails, they will be lost.
        </p>
      ) : objectName === null ? (
        <p>Your changes are not saved. They will be lost if you leave this page.</p>
      ) : (
        <p>
          The changes to <strong className="tx-break">“{objectName}”</strong> are not saved. They
          will be lost if you leave this page.
        </p>
      )}
    </ConfirmDialog>
  );

  return {
    release: () => {
      released.current = true;
    },
    dialog,
  };
}
