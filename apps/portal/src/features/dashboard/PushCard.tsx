import { Link } from 'react-router-dom';
import { formatCount, pushOverview, type PushOverview } from '../../lib/dashboard.ts';
import { Button, Card, CardHeader, cx, ErrorNotice, Icon } from '../../ui/index.ts';
import { ChevronRight, CircleCheck, CircleDashed, Lock } from '../../ui/icons.ts';
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
  const summary = plan === null ? null : pushOverview(plan);

  return (
    <Card
      as="section"
      aria-labelledby="dashboard-push-title"
      className="tx-dashboard-card tx-dashboard-card--push"
      data-testid="dashboard-push"
    >
      <CardHeader
        id="dashboard-push-title"
        title="Changes waiting"
        size="title"
        description={summary?.text}
        actions={
          summary !== null && (summary.pending > 0 || summary.blocked > 0) ? (
            <Button
              variant="ghost"
              size="sm"
              trailingIcon={ChevronRight}
              onClick={() => {
                openDialog();
              }}
              data-testid="dashboard-push-review"
            >
              {summary.pending > 0 ? 'Review and push' : 'Review screens'}
            </Button>
          ) : undefined
        }
      />
      {plan === null && planError === null && <CardSkeleton label="Loading changes waiting" />}
      {plan === null && planError !== null && (
        <ErrorNotice
          error={planError}
          title="The changes waiting could not be loaded"
          onRetry={refresh}
        />
      )}
      {summary !== null && <PushSummary summary={summary} />}
    </Card>
  );
}

function PushSummary({ summary }: { readonly summary: PushOverview }) {
  const icon =
    summary.state === 'up_to_date'
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
          </span>{' '}
          {summary.headline}
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
          <Icon icon={icon} size={18} />
          {summary.headline}
        </p>
      )}

      {summary.waiting.length > 0 && (
        <ul className="tx-dashboard-list" aria-label="Screens with changes waiting">
          {summary.waiting.map((row) => (
            <li
              key={row.display.id}
              className="tx-dashboard-row"
              data-testid={`dashboard-push-row-${row.display.id}`}
            >
              <span className="tx-dashboard-row__text">
                <Link
                  to={`/screens/${row.display.id}`}
                  className="tx-dashboard-row__title tx-row-title tx-truncate"
                  title={row.display.name}
                >
                  {row.display.name}
                </Link>
                {(row.schedule ?? row.playlist) !== null && (
                  <span
                    className="tx-dashboard-row__caption tx-small tx-truncate"
                    title={row.schedule?.name ?? row.playlist?.name}
                  >
                    {row.schedule?.name ?? row.playlist?.name}
                  </span>
                )}
              </span>
              <PushStatePill
                state={row.state}
                testId="dashboard-push-state"
                className="tx-dashboard-row__end"
              />
            </li>
          ))}
          {summary.moreWaiting > 0 && (
            <li className="tx-dashboard-row tx-dashboard-row--more tx-small">
              and {formatCount(summary.moreWaiting)} more
            </li>
          )}
        </ul>
      )}

      {summary.blockedText !== null && (
        <p className="tx-dashboard-push__blocked tx-small" data-testid="dashboard-push-blocked">
          <Icon icon={Lock} size={16} />
          {summary.blockedText}
        </p>
      )}
    </div>
  );
}
