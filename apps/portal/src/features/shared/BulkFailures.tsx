import { isApiRequestError } from '../../api/client.ts';
import type { BulkFailure } from '../../lib/bulkOutcome.ts';
import { Banner } from '../../ui/index.ts';
import './shared.css';

export interface BulkFailuresProps {
  /** What did not happen: "2 of 5 files were not updated". */
  readonly title: string;
  readonly failures: readonly BulkFailure<{ readonly name: string }>[];
  /** What did happen, when anything did: "3 files were updated." */
  readonly note?: string;
}

/**
 * The items of a run that failed, each with the server's message and its error code as
 * text. An alert, so it is read out when it appears inside an open dialog.
 */
export function BulkFailures({ title, failures, note }: BulkFailuresProps) {
  return (
    <Banner tone="danger" live="assertive" title={title}>
      {note !== undefined && <p>{note}</p>}
      <ul className="tx-shared-failures">
        {failures.map(({ item, error }, index) => {
          const api = isApiRequestError(error) ? error : null;
          const message =
            api?.message ??
            (error instanceof Error ? error.message : 'An unexpected error occurred.');
          return (
            <li key={index}>
              <span className="tx-strong tx-break">{item.name}</span>: {message}{' '}
              {api !== null && <span className="tx-code">{api.code}</span>}
            </li>
          );
        })}
      </ul>
    </Banner>
  );
}
