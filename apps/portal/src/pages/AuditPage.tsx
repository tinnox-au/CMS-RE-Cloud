import type { AuditEventDto } from '@tinnox/contracts';
import { useCallback, useState } from 'react';
import { api } from '../api/index.ts';
import { Chip, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/common.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { formatTimestamp } from '../lib/format.ts';
import type { Tone } from '../lib/status.ts';

const PAGE_SIZE = 50;

const RESULT_TONE: Readonly<Record<AuditEventDto['result'], Tone>> = {
  success: 'neutral',
  failure: 'bad',
  denied: 'warn',
};

/** Compact, text-only rendering of the small structured context of an event. */
function detailText(detail: AuditEventDto['detail']): string {
  if (detail === null) return '';
  try {
    const text = JSON.stringify(detail);
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return '';
  }
}

export function AuditPage() {
  const load = useCallback(
    (signal: AbortSignal) => api.listAudit({ limit: PAGE_SIZE }, signal),
    [],
  );
  const { state, reload } = useLoad(load);
  const [older, setOlder] = useState<readonly AuditEventDto[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);

  const refresh = () => {
    setOlder([]);
    setCursor(undefined);
    setMoreError(null);
    reload();
  };

  if (state.status === 'loading') {
    return (
      <>
        <PageHeader title="Audit" />
        <Loading label="Loading audit events…" />
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        <PageHeader title="Audit" />
        <ErrorNotice
          error={state.error}
          title="Audit events could not be loaded"
          onRetry={reload}
        />
      </>
    );
  }

  const nextBefore = cursor === undefined ? state.data.nextBefore : cursor;
  const events = [...state.data.items, ...older];

  const loadMore = () => {
    if (nextBefore === null) return;
    setMoreBusy(true);
    setMoreError(null);
    api
      .listAudit({ limit: PAGE_SIZE, before: nextBefore })
      .then((page) => {
        setOlder((previous) => [...previous, ...page.items]);
        setCursor(page.nextBefore);
      })
      .catch((error: unknown) => {
        setMoreError(error);
      })
      .finally(() => {
        setMoreBusy(false);
      });
  };

  return (
    <>
      <PageHeader
        title="Audit"
        actions={
          <button type="button" className="button" onClick={refresh}>
            Refresh
          </button>
        }
      >
        <p className="muted">
          Recent security and operational events for this organisation, newest first. Records cannot
          be edited or deleted through the application.
        </p>
      </PageHeader>
      {state.refreshError !== null && (
        <ErrorNotice error={state.refreshError} title="The list could not be refreshed" />
      )}
      {events.length === 0 ? (
        <EmptyState title="No events recorded yet" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Action</th>
                <th scope="col">Result</th>
                <th scope="col">Actor</th>
                <th scope="col">Object</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="nowrap">{formatTimestamp(event.occurredAt)}</td>
                  <td className="mono">{event.action}</td>
                  <td>
                    <Chip tone={RESULT_TONE[event.result]}>{event.result}</Chip>
                  </td>
                  <td>
                    {event.actorType}
                    {event.actorId !== null && (
                      <span className="mono small muted break"> {event.actorId}</span>
                    )}
                  </td>
                  <td>
                    {event.objectType ?? <span className="muted">none</span>}
                    {event.objectId !== null && (
                      <span className="mono small muted break"> {event.objectId}</span>
                    )}
                  </td>
                  <td className="mono small break">{detailText(event.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {moreError !== null && <ErrorNotice error={moreError} title="Older events were not loaded" />}
      {nextBefore !== null && (
        <p>
          <button type="button" className="button" onClick={loadMore} disabled={moreBusy}>
            {moreBusy ? 'Loading…' : 'Load older events'}
          </button>
        </p>
      )}
    </>
  );
}
