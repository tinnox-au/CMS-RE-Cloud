import type { DisplayDto } from '@tinnox/contracts';
import { isApiRequestError } from '../../../api/client.ts';
import { bulkFailureTitle, type BulkFailure } from '../../../lib/bulkOutcome.ts';
import { assignedDoneText } from '../../../lib/screensList.ts';
import { RefreshCw } from '../../../ui/icons.ts';
import { Banner, Button } from '../../../ui/index.ts';

function describe(error: unknown): { readonly message: string; readonly code: string | null } {
  if (isApiRequestError(error)) return { message: error.message, code: error.code };
  return {
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    code: null,
  };
}

export interface PartialNoticeProps {
  /** What is missing: "The sites could not be loaded". */
  readonly title: string;
  readonly error: unknown;
  /** What the list shows meanwhile. */
  readonly note: string;
  readonly onRetry: () => void;
  readonly testId: string;
}

/**
 * One part of the list could not be read while the screens themselves are showing: the
 * sites, the push state, or a refresh of the statuses. Quieter than an alert, because the
 * list is still usable, and worded the same on every repeat so that a failing ten-second
 * refresh is announced once, not every ten seconds. The server's message and its error code
 * are shown as text.
 */
export function PartialNotice({ title, error, note, onRetry, testId }: PartialNoticeProps) {
  const { message, code } = describe(error);
  return (
    <div data-testid={testId}>
      <Banner
        tone="warn"
        live="polite"
        title={title}
        actions={
          <Button size="sm" icon={RefreshCw} onClick={onRetry}>
            Try again
          </Button>
        }
      >
        <p>
          {note} {message} {code !== null && <span className="tx-code">{code}</span>}
        </p>
      </Banner>
    </div>
  );
}

export interface AssignFailure {
  /** The playlist that was being assigned; null when the assignment was being removed. */
  readonly playlist: { readonly id: string; readonly name: string } | null;
  readonly failed: readonly BulkFailure<DisplayDto>[];
  /** How many screens were changed, and how many were to be. */
  readonly doneCount: number;
  readonly total: number;
}

export interface AssignFailureNoticeProps {
  readonly failure: AssignFailure;
  readonly retrying: boolean;
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
}

/**
 * After assigning content to several screens where some were refused: each of those screens
 * with the server's message and error code, what was changed, and a way to try the rest again.
 */
export function AssignFailureNotice({
  failure,
  retrying,
  onRetry,
  onDismiss,
}: AssignFailureNoticeProps) {
  const { playlist, failed, doneCount, total } = failure;
  const done = assignedDoneText(playlist?.name ?? null, doneCount);
  return (
    <div data-testid="screens-assign-failures">
      <Banner
        tone="danger"
        live="assertive"
        title={bulkFailureTitle(failed.length, total, 'screen', 'updated')}
        onDismiss={retrying ? undefined : onDismiss}
        actions={
          <Button
            size="sm"
            icon={RefreshCw}
            busy={retrying}
            onClick={onRetry}
            data-testid="screens-assign-retry"
          >
            Try again
          </Button>
        }
      >
        <p>{done}</p>
        <ul className="tx-screens-failures">
          {failed.map(({ item, error }) => {
            const { message, code } = describe(error);
            return (
              <li key={item.id}>
                <span className="tx-strong tx-break">{item.name}</span>: {message}{' '}
                {code !== null && <span className="tx-code">{code}</span>}
              </li>
            );
          })}
        </ul>
      </Banner>
    </div>
  );
}
