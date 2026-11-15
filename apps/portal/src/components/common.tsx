import { useEffect, useId, useRef, type ReactNode } from 'react';
import { isApiRequestError } from '../api/client.ts';
import type { Tone } from '../lib/status.ts';

/** Shows an error with the API's code and message. Text only; nothing is rendered as HTML. */
export function ErrorNotice({
  error,
  title,
  onRetry,
}: {
  readonly error: unknown;
  readonly title?: string;
  readonly onRetry?: () => void;
}) {
  const api = isApiRequestError(error) ? error : null;
  const message =
    api?.message ?? (error instanceof Error ? error.message : 'An unexpected error occurred.');
  return (
    <div className="notice notice-bad" role="alert">
      <p className="notice-title">{title ?? 'The request did not succeed'}</p>
      <p>
        {message} {api !== null && <code className="code-tag">{api.code}</code>}
      </p>
      {api !== null && api.details.length > 0 && (
        <ul className="notice-details">
          {api.details.map((detail, index) => (
            <li key={index}>
              {detail.path !== '' && <span className="mono">{detail.path}: </span>}
              {detail.message}{' '}
              {detail.code !== undefined && <code className="code-tag">{detail.code}</code>}
            </li>
          ))}
        </ul>
      )}
      {api !== null && api.requestId !== null && (
        <p className="muted small">
          Request reference <span className="mono">{api.requestId}</span>
        </p>
      )}
      {onRetry !== undefined && (
        <p>
          <button type="button" className="button" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}

export function Notice({
  tone,
  title,
  children,
  live = false,
}: {
  readonly tone: Tone;
  readonly title?: string;
  readonly children: ReactNode;
  readonly live?: boolean;
}) {
  return (
    <div className={`notice notice-${tone}`} role={live ? 'status' : undefined}>
      {title !== undefined && <p className="notice-title">{title}</p>}
      {children}
    </div>
  );
}

export function Chip({ tone, children }: { readonly tone: Tone; readonly children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Loading({ label }: { readonly label: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function EmptyState({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  actions,
  children,
}: {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {children}
      </div>
      {actions !== undefined && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** A labelled control with optional hint and error, wired up for assistive technology. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly children: (ids: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
      .filter((value) => value !== null)
      .join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: error !== undefined })}
      {hint !== undefined && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Modal confirmation built on the native dialog element (focus trap and Escape included). */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  busy = false,
  danger = false,
  onConfirm,
  onCancel,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly confirmLabel: string;
  readonly busy?: boolean;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? 'button button-danger' : 'button button-primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** A full identifier in monospace; the whole value stays selectable. */
export function Id({ value }: { readonly value: string }) {
  return <span className="mono id">{value}</span>;
}
