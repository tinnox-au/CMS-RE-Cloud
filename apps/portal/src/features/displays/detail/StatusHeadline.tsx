import type { DeliveryStatusView } from '@tinnox/contracts';
import { formatTimestamp } from '../../../lib/format.ts';
import { screenStatus } from '../../../lib/screenStatus.ts';
import { StatusPill } from '../../../ui/index.ts';
import { useNow } from '../../shared/index.ts';

export interface StatusHeadlineProps {
  readonly view: DeliveryStatusView;
  /** `state.fetchedAt` of the status load, so the age of the last report keeps counting. */
  readonly fetchedAt: number;
}

/**
 * The status headline of a screen: the status (dot and words) in the approved wording, the M0 report badge
 * (`STALE`, `NO REPORT`, both from the API's flag), what the status means, and when the player
 * last reported. It carries the M0 test hooks: `data-testid="status-headline"` with
 * `data-summary` and `data-stale` exactly as the API sent them.
 */
export function StatusHeadline({ view, fetchedAt }: StatusHeadlineProps) {
  const now = useNow();
  const status = screenStatus(view, Math.max(0, now - fetchedAt));
  return (
    <div
      className="tx-screen-detail-headline"
      data-testid="status-headline"
      data-summary={view.summary}
      data-stale={view.stale ? 'true' : 'false'}
      data-kind={status.kind}
    >
      <p className="tx-screen-detail-headline__pills">
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        {status.reportBadge === 'stale' && <span className="tx-screen-detail-badge">STALE</span>}
        {status.reportBadge === 'no_report' && (
          <span className="tx-screen-detail-badge">NO REPORT</span>
        )}
      </p>
      <p className="tx-screen-detail-headline__text">{status.explanation}</p>
      <p className="tx-screen-detail-report" data-testid="screen-detail-last-report">
        <span className="tx-strong tx-screen-detail-report__age">{status.detail}</span>
        {view.lastHeartbeatAt !== null && (
          <span className="tx-muted">{formatTimestamp(view.lastHeartbeatAt)}</span>
        )}
      </p>
    </div>
  );
}
