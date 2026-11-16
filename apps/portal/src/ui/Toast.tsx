import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { pushToast, toastDuration } from '../lib/toastQueue.ts';
import { Button } from './Button.tsx';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import {
  CircleCheck,
  CircleExclamationPoint,
  Info,
  TriangleExclamationPoint,
  X,
  type IconComponent,
} from './icons.ts';

export type ToastTone = 'ok' | 'info' | 'warn' | 'danger';

export interface ToastOptions {
  /** A second, quieter line, for example an API error code. */
  readonly detail?: string;
  /** One follow-up action, for example "Undo" or "View". */
  readonly action?: { readonly label: string; readonly onAction: () => void };
  /**
   * Milliseconds before the toast leaves by itself. `null` keeps it until dismissed.
   * Default: 5000, except for `danger`, which stays.
   */
  readonly durationMs?: number | null;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  readonly show: (tone: ToastTone, message: string, options?: ToastOptions) => string;
  readonly success: (message: string, options?: ToastOptions) => string;
  readonly info: (message: string, options?: ToastOptions) => string;
  readonly warn: (message: string, options?: ToastOptions) => string;
  /** An error toast stays until it is dismissed. */
  readonly error: (message: string, options?: ToastOptions) => string;
  readonly dismiss: (id: string) => void;
}

interface ToastEntry extends ToastOptions {
  readonly id: string;
  readonly tone: ToastTone;
  readonly message: string;
  /** Stays until it is dismissed: an error, or a toast raised with `durationMs: null`. */
  readonly sticky: boolean;
}

const MAX_VISIBLE = 3;
/** The announcement text is cleared after this, so it is not read again out of context. */
const ANNOUNCEMENT_MS = 8000;
/**
 * A toast is announced this long after it is raised. By then a dialog closed in the same
 * update has stopped making the page (and the live regions in it) inert, and a region emptied
 * for a repeated message has been seen empty, so the same words count as a change again.
 */
const ANNOUNCE_DELAY_MS = 150;

interface PendingAnnouncements {
  polite: string[];
  assertive: string[];
  timer: number | undefined;
}

const TONE_ICON: { readonly [K in ToastTone]: IconComponent } = {
  ok: CircleCheck,
  info: Info,
  warn: TriangleExclamationPoint,
  danger: CircleExclamationPoint,
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast must be used inside a ToastProvider');
  return api;
}

function ToastItem({
  toast,
  paused,
  onDismiss,
}: {
  readonly toast: ToastEntry;
  readonly paused: boolean;
  readonly onDismiss: (id: string) => void;
}) {
  const duration = toastDuration(toast.tone === 'danger', toast.durationMs);

  useEffect(() => {
    if (duration === null || paused) return;
    const timer = window.setTimeout(() => {
      onDismiss(toast.id);
    }, duration);
    return () => {
      window.clearTimeout(timer);
    };
  }, [duration, paused, onDismiss, toast.id]);

  return (
    <div className={cx('tx-toast', `tx-toast--${toast.tone}`)}>
      <Icon icon={TONE_ICON[toast.tone]} className="tx-toast__icon" />
      <div className="tx-toast__text">
        {toast.message}
        {toast.detail !== undefined && <span className="tx-toast__detail">{toast.detail}</span>}
      </div>
      {toast.action !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            toast.action?.onAction();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton
        icon={X}
        size="sm"
        label="Dismiss"
        tooltip={false}
        onClick={() => {
          onDismiss(toast.id);
        }}
      />
    </div>
  );
}

/**
 * Holds the toasts and the live regions that announce them. Render it once, around the
 * application. Toasts appear bottom centre; hovering or focusing the stack pauses the timers.
 *
 * Two visually hidden regions do the announcing (polite, and assertive for errors); they are
 * always in the document, which is what screen readers need to notice a change. The visible
 * stack is not a live region, so nothing is read twice.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const stackRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const pending = useRef<PendingAnnouncements>({ polite: [], assertive: [], timer: undefined });

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((tone: ToastTone, message: string, options: ToastOptions = {}) => {
    sequence.current += 1;
    const id = `toast-${sequence.current}`;
    const sticky = toastDuration(tone === 'danger', options.durationMs) === null;
    // An error is not pushed off the screen by the messages that follow it (lib/toastQueue.ts).
    setToasts((current) =>
      pushToast(current, { ...options, id, tone, message, sticky }, MAX_VISIBLE),
    );
    const spoken = options.detail === undefined ? message : `${message} ${options.detail}`;
    const queue = pending.current;
    if (tone === 'danger') {
      queue.assertive.push(spoken);
      setAssertive('');
    } else {
      queue.polite.push(spoken);
      setPolite('');
    }
    queue.timer ??= window.setTimeout(() => {
      queue.timer = undefined;
      if (queue.polite.length > 0) setPolite(queue.polite.join(' '));
      if (queue.assertive.length > 0) setAssertive(queue.assertive.join(' '));
      queue.polite = [];
      queue.assertive = [];
    }, ANNOUNCE_DELAY_MS);
    return id;
  }, []);

  useEffect(() => {
    const queue = pending.current;
    return () => {
      window.clearTimeout(queue.timer);
      queue.timer = undefined;
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (message, options) => show('ok', message, options),
      info: (message, options) => show('info', message, options),
      warn: (message, options) => show('warn', message, options),
      error: (message, options) => show('danger', message, options),
    }),
    [show, dismiss],
  );

  useEffect(() => {
    if (polite === '' && assertive === '') return;
    const timer = window.setTimeout(() => {
      setPolite('');
      setAssertive('');
    }, ANNOUNCEMENT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [polite, assertive]);

  // Each new toast re-enters the top layer, so it is drawn above a dialog that opened earlier.
  const newest = toasts[toasts.length - 1]?.id;
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (stack === null || typeof stack.showPopover !== 'function') return;
    try {
      if (stack.matches(':popover-open')) stack.hidePopover();
      if (newest !== undefined) stack.showPopover();
    } catch {
      // The Popover API is missing or refused: the stack stays a fixed-position element.
    }
  }, [newest]);

  // Dismissing a toast from the keyboard removes the button that had focus. Focus then goes
  // to the next toast, or back to where it was before it entered the stack, instead of being
  // dropped to the top of the page.
  const focusWithin = useRef(false);
  const cameFrom = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!focusWithin.current) return;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    const next = stackRef.current?.querySelector<HTMLElement>('button');
    if (next !== null && next !== undefined) {
      next.focus();
      return;
    }
    focusWithin.current = false;
    setPaused(false);
    const origin = cameFrom.current;
    cameFrom.current = null;
    if (origin?.isConnected === true) origin.focus();
  }, [toasts]);

  if (paused && toasts.length === 0) setPaused(false);

  return (
    <ToastContext value={api}>
      {children}
      <div className="tx-visually-hidden" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="tx-visually-hidden" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
      <div
        ref={stackRef}
        className="tx-toasts"
        popover="manual"
        role="region"
        aria-label="Notifications"
        onPointerEnter={() => {
          setPaused(true);
        }}
        onPointerLeave={() => {
          setPaused(false);
        }}
        onFocus={(event) => {
          setPaused(true);
          const from: unknown = event.relatedTarget;
          if (!focusWithin.current && from instanceof HTMLElement) cameFrom.current = from;
          focusWithin.current = true;
        }}
        onBlur={(event) => {
          const to: unknown = event.relatedTarget;
          if (to instanceof Node && event.currentTarget.contains(to)) return;
          focusWithin.current = false;
          setPaused(false);
        }}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} paused={paused} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  );
}
