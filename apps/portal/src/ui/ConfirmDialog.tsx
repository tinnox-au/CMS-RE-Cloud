import type { ReactNode } from 'react';
import { Button } from './Button.tsx';
import { Dialog } from './Dialog.tsx';

export interface ConfirmDialogProps {
  readonly open: boolean;
  /** A question that names the action: "Delete this file?". */
  readonly title: string;
  /** Names the object and says what will happen, including what cannot be undone. */
  readonly children: ReactNode;
  /** The verb and the object: "Delete file", "Revoke player". */
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /** `danger` fills the confirming button red. */
  readonly tone?: 'default' | 'danger';
  /** The action is running: both buttons hold, and the dialog cannot be dismissed. */
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** `data-testid` of the dialog; the buttons get `<testId>-cancel` and `<testId>-confirm`. */
  readonly testId?: string;
  /** Passed to `Dialog`: where focus goes when the opener is gone after the action. */
  readonly returnFocus?: () => HTMLElement | null;
}

/**
 * Asks before an action that is destructive or hard to undo. Focus starts on Cancel, so
 * Enter never confirms by accident, and the confirming button is never the default.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
  testId,
  returnFocus,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      busy={busy}
      testId={testId}
      returnFocus={returnFocus}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onCancel}
            aria-disabled={busy || undefined}
            data-autofocus
            data-testid={testId === undefined ? undefined : `${testId}-cancel`}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger-solid' : 'primary'}
            onClick={onConfirm}
            busy={busy}
            data-testid={testId === undefined ? undefined : `${testId}-confirm`}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
