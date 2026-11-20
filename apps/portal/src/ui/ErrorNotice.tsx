import { isApiRequestError, isRoleRefusal } from '../api/client.ts';
import { Banner } from './Banner.tsx';
import { Button } from './Button.tsx';
import { RefreshCw } from './icons.ts';

export interface ErrorNoticeProps {
  /** Whatever was thrown. An API error shows its message, code, details and request reference. */
  readonly error: unknown;
  /** What did not happen: "The playlist could not be loaded". */
  readonly title?: string;
  /** Adds a "Try again" button, except after a refusal by role (trying again changes nothing). */
  readonly onRetry?: () => void;
  /** Adds a close button, for an error that is about one finished attempt. */
  readonly onDismiss?: () => void;
  readonly className?: string;
}

/**
 * An error as an alert banner: the title, the message, and for an API error its code as
 * text, the field details and the request reference. Text only; nothing is rendered as HTML.
 * The portal v2 form of the M0 `ErrorNotice`.
 */
export function ErrorNotice({ error, title, onRetry, onDismiss, className }: ErrorNoticeProps) {
  const api = isApiRequestError(error) ? error : null;
  const message =
    api?.message ?? (error instanceof Error ? error.message : 'An unexpected error occurred.');
  return (
    <Banner
      tone="danger"
      live="assertive"
      title={title ?? 'The request did not succeed'}
      className={className}
      onDismiss={onDismiss}
      actions={
        onRetry === undefined || isRoleRefusal(error) ? undefined : (
          <Button size="sm" icon={RefreshCw} onClick={onRetry}>
            Try again
          </Button>
        )
      }
    >
      <p>
        {message} {api !== null && <span className="tx-code">{api.code}</span>}
      </p>
      {api !== null && api.details.length > 0 && (
        <ul>
          {api.details.map((detail, index) => (
            <li key={index}>
              {detail.path !== '' && <span className="tx-mono">{detail.path}: </span>}
              {detail.message}{' '}
              {detail.code !== undefined && <span className="tx-code">{detail.code}</span>}
            </li>
          ))}
        </ul>
      )}
      {api !== null && api.requestId !== null && (
        <p className="tx-small tx-muted">
          Request reference <span className="tx-mono">{api.requestId}</span>
        </p>
      )}
    </Banner>
  );
}
