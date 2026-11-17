import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { cx } from './cx.ts';
import { guardReturnedFocus } from './focusReturn.ts';
import { keepTabInside } from './focusWrap.ts';
import { IconButton } from './IconButton.tsx';
import { X } from './icons.ts';

export interface DialogProps {
  readonly open: boolean;
  /**
   * Called when the person asks to close: the close button, Escape, or a press on the
   * backdrop. The parent decides, by setting `open`.
   */
  readonly onClose: () => void;
  readonly title: string;
  /** One line under the title. */
  readonly description?: ReactNode;
  /** 480, 640 and 880 px wide. Under 560 px every dialog is a full-width sheet. */
  readonly size?: 'sm' | 'md' | 'lg';
  /** The scrolling body. Mounted only while the dialog is open, so its state starts fresh. */
  readonly children: ReactNode;
  /** Action buttons, secondary first: they sit at the right, the primary last. */
  readonly footer?: ReactNode;
  /** A note at the far left of the footer. */
  readonly footerStart?: ReactNode;
  /**
   * While true the dialog cannot be dismissed (no close button action, Escape or backdrop),
   * for the seconds a save is in flight.
   */
  readonly busy?: boolean;
  /** Drops the body padding, for a body that brings its own edge-to-edge layout. */
  readonly flush?: boolean;
  readonly className?: string;
  /** `data-testid` of the `<dialog>` element, so a test can scope body and footer together. */
  readonly testId?: string;
  /**
   * Where focus goes on close when the control that opened the dialog has gone, at once or
   * a moment later (the deleted row's "Actions" button, an emptied selection bar). Called
   * when it is needed, so it can look for the element that is there by then, such as the
   * next row. Returning null, or leaving it out, falls back to the page's `main` landmark.
   */
  readonly returnFocus?: () => HTMLElement | null;
}

/** Matches `--t` in tokens.css: how long the content stays mounted while the dialog fades out. */
const EXIT_MS = 200;

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function firstFocusable(root: Element | null): HTMLElement | null {
  return root === null ? null : root.querySelector<HTMLElement>(FOCUSABLE);
}

/** True when a press on the dialog element landed outside its box, that is, on the backdrop. */
function isOnBackdrop(event: {
  readonly target: EventTarget;
  readonly currentTarget: HTMLDialogElement;
  readonly clientX: number;
  readonly clientY: number;
}): boolean {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

/**
 * A modal dialog on the native `<dialog>` element, opened with `showModal()`: the browser
 * makes the rest of the page inert, closes on Escape and gives the element the dialog role.
 * Tab is kept inside by the component, not the browser (see focusWrap.ts).
 *
 * Focus on open goes to the first element marked `data-autofocus`, else the first control
 * in the body, else the first footer button, else the dialog itself. On close it returns
 * to the element that had focus before; when that element has gone, to `returnFocus()` or
 * the page's `main` landmark (see `guardReturnedFocus`).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'sm',
  children,
  footer,
  footerStart,
  busy = false,
  flush = false,
  className,
  testId,
  returnFocus,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const pressedBackdrop = useRef(false);
  const closedByCode = useRef(false);
  const returnFocusRef = useRef(returnFocus);
  const titleId = useId();
  const descriptionId = useId();
  // The content outlives `open` by the exit transition, so it does not vanish mid-fade.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    returnFocusRef.current = returnFocus;
  }, [returnFocus]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open) {
      if (dialog.open) return;
      opener.current = document.activeElement;
      dialog.showModal();
      const target =
        dialog.querySelector<HTMLElement>('[data-autofocus]') ??
        firstFocusable(bodyRef.current) ??
        firstFocusable(footerRef.current) ??
        dialog;
      target.focus();
      return;
    }
    if (!dialog.open) return;
    closedByCode.current = true;
    dialog.close();
    const previous = opener.current;
    opener.current = null;
    // The browser restores focus itself; this covers an opener it lost track of.
    if (
      previous instanceof HTMLElement &&
      previous.isConnected &&
      (document.activeElement === null || document.activeElement === document.body)
    ) {
      previous.focus();
    }
    // The opener may be gone now or once the page has read its list again.
    guardReturnedFocus(() => returnFocusRef.current?.() ?? null);
    const timer = window.setTimeout(() => {
      setMounted(false);
    }, EXIT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  // Leaving the page with the dialog open must not leave a modal behind.
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open === true) {
        closedByCode.current = true;
        dialog.close();
      }
    };
  }, []);

  const requestClose = () => {
    if (!busy) onClose();
  };

  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    // Escape. The parent owns `open`, so the element is not allowed to close itself.
    event.preventDefault();
    requestClose();
  };

  const onNativeClose = () => {
    // The close event arrives after the fact. One caused by this component is expected;
    // any other means the browser closed the element itself (a second Escape in Chromium),
    // and the parent has to hear about it.
    if (closedByCode.current) {
      closedByCode.current = false;
      return;
    }
    if (open) onClose();
  };

  const onPointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pressedBackdrop.current = isOnBackdrop(event);
  };

  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (pressedBackdrop.current && isOnBackdrop(event)) requestClose();
    pressedBackdrop.current = false;
  };

  return (
    <dialog
      ref={ref}
      className={cx('tx-dialog', size !== 'sm' && `tx-dialog--${size}`, className)}
      data-testid={testId}
      // The title and description exist only while the content is mounted.
      aria-labelledby={mounted ? titleId : undefined}
      aria-describedby={mounted && description !== undefined ? descriptionId : undefined}
      aria-busy={busy || undefined}
      tabIndex={-1}
      onCancel={onCancel}
      onClose={onNativeClose}
      onKeyDown={keepTabInside}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {mounted && (
        <>
          <div className="tx-dialog__header">
            <div className="tx-dialog__heading">
              <h2 id={titleId} className="tx-dialog__title">
                {title}
              </h2>
              {description !== undefined && (
                <p id={descriptionId} className="tx-dialog__description">
                  {description}
                </p>
              )}
            </div>
            <IconButton
              icon={X}
              label="Close"
              tooltip={false}
              onClick={requestClose}
              disabled={busy}
            />
          </div>
          <div ref={bodyRef} className={cx('tx-dialog__body', flush && 'tx-dialog__body--flush')}>
            {children}
          </div>
          {(footer !== undefined || footerStart !== undefined) && (
            <div ref={footerRef} className="tx-dialog__footer">
              {footerStart !== undefined && (
                <div className="tx-dialog__footer-start">{footerStart}</div>
              )}
              {footer}
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
