import type { PushPlanResponse } from '@tinnox/contracts';
import { Link } from 'react-router-dom';
import { formatCount, pushOverview } from '../../lib/dashboard.ts';
import { Button, Card, CardHeader, cx, ErrorNotice, Icon } from '../../ui/index.ts';
import { CircleCheck, CircleDashed, Lock, Send } from '../../ui/icons.ts';
import { usePush } from '../push/PushContext.tsx';
import { PushStatePill } from '../shared/index.ts';
import { CardSkeleton } from './parts.tsx';

/**
 * "Changes waiting": how many screens would be given something new by a push, from the
 * push plan of `PushContext`, and the button that opens the push dialog. Nothing changes on
 * a screen until the operator pushes.
 */
export function PushCard() {
  const { plan, planError, refresh, openDialog } = usePush();

  return (
    <Card
      as="section"
      aria-labelledby="dashboard-push-title"
      className="tx-dashboard-card tx-dashboard-card--push"
      data-testid="dashboard-push"
    >
      <CardHeader id="dashboard-push-title" title="Changes waiting" size="title" />
      {plan === null && planError === null && <CardSkeleton label="Loading changes waiting" />}
      {plan === null && planError !== null && (
        <ErrorNotice
          error={planError}
          title="The changes waiting could not be loaded"
          onRetry={refresh}
        />
      )}
      {plan !== null && <PushSummary plan={plan} onReview={openDialog} />}
    </Card>
  );
}

interface PushSummaryProps {
  readonly plan: PushPlanResponse;
  readonly onReview: () => void;
}

function PushSummary({ plan, onReview }: PushSummaryProps) {
  const summary = pushOverview(plan);
  const icon =
    summary.state === 'changes'
      ? Send
      : summary.state === 'up_to_date'
        ? CircleCheck
        : summary.state === 'blocked_only'
          ? Lock
          : CircleDashed;
  return (
    <div className="tx-dashboard-push" data-state={summary.state}>
      {summary.state === 'changes' ? (
        <p className="tx-dashboard-push__headline">
          <span className="tx-dashboard-push__count tx-num" data-testid="dashboard-push-count">
            {formatCount(summary.pending)}
          </span>
          <span className="tx-dashboard-push__words">{summary.headline}</span>
        </p>
      ) : (
        <p
          className={cx(
            'tx-dashboard-push__status',
            summary.state === 'up_to_date' && 'tx-dashboard-push__status--ok',
          )}
          data-testid="dashboard-push-count"
          data-count={0}
        >
          <Icon icon={icon} size={20} />
          {summary.headline}
        </p>
      )}
      <p className="tx-dashboard-push__text">{summary.text}</p>

      {summary.waiting.length > 0 && (
        <ul className="tx-dashboard-push__list" aria-label="Screens with changes waiting">
          {summary.waiting.map((row) => (
            <li
              key={row.display.id}
              className="tx-dashboard-push__row"
              data-testid={`dashboard-push-row-${row.display.id}`}
            >
              <span className="tx-dashboard-push__names">
                <Link to={`/screens/${row.display.id}`} className="tx-truncate">
                  {row.display.name}
                </Link>
                {row.playlist !== null && (
                  <span className="tx-dashboard-push__playlist tx-truncate">
                    {row.playlist.name}
                  </span>
                )}
              </span>
              <PushStatePill state={row.state} testId="dashboard-push-state" />
            </li>
          ))}
          {summary.moreWaiting > 0 && (
            <li className="tx-dashboard-push__more">and {formatCount(summary.moreWaiting)} more</li>
          )}
        </ul>
      )}

      {summary.blockedText !== null && (
        <p className="tx-dashboard-push__blocked" data-testid="dashboard-push-blocked">
          <Icon icon={Lock} size={16} />
          {summary.blockedText}
        </p>
      )}

      {(summary.pending > 0 || summary.blocked > 0) && (
        <div className="tx-dashboard-push__action">
          <Button
            variant="secondary"
            icon={Send}
            onClick={() => {
              onReview();
            }}
            data-testid="dashboard-push-review"
          >
            {summary.pending > 0 ? 'Review and push' : 'Review screens'}
          </Button>
        </div>
      )}
    </div>
  );
}
