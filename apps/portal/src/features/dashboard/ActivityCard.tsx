import type { AuditEventDto } from '@tinnox/contracts';
import { Link } from 'react-router-dom';
import type { LoadState } from '../../hooks/useLoad.ts';
import {
  activityTimeLabel,
  presentActivity,
  type ActivityItem,
  type ActivityNames,
  type ActivityObject,
} from '../../lib/activity.ts';
import { formatTimestamp } from '../../lib/format.ts';
import { useCan } from '../../session/AuthenticatedSession.tsx';
import {
  ButtonLink,
  Card,
  CardHeader,
  cx,
  EmptyState,
  ErrorNotice,
  Skeleton,
  SkeletonGroup,
  StatusPill,
} from '../../ui/index.ts';
import { ChevronRight, ScrollText } from '../../ui/icons.ts';
import { ACTIVITY_LIMIT } from './useDashboardData.ts';
import { useWallClock } from './parts.tsx';

const RELATED_LABELS: { readonly [K in ActivityObject['kind']]: string } = {
  display: 'Screen',
  playlist: 'Playlist',
  schedule: 'Schedule',
  layout: 'Layout',
  media: 'Media',
  tag: 'Tag',
  folder: 'Folder',
};

interface ActivityCardProps {
  readonly activity: LoadState<readonly AuditEventDto[]>;
  readonly names: ActivityNames;
  readonly onRetry: () => void;
}

/**
 * The last ten audit events in plain words, newest first, each with its time, who acted (the
 * person's name where the member list knows it) and a link to the object where that object
 * still exists and has a page. Without the full log (`audit.read`) the API returns content and
 * screen events only.
 */
export function ActivityCard({ activity, names, onRetry }: ActivityCardProps) {
  const now = useWallClock(15_000);
  const fullLog = useCan('audit.read');
  return (
    <Card
      as="section"
      aria-labelledby="dashboard-activity-title"
      className="tx-dashboard-card tx-dashboard-card--activity"
      data-testid="dashboard-activity"
    >
      <CardHeader
        id="dashboard-activity-title"
        title="Recent activity"
        size="title"
        description={
          fullLog
            ? `The last ${ACTIVITY_LIMIT} events in this organisation.`
            : 'Content and screen events in this organisation.'
        }
        actions={
          <ButtonLink
            to="/audit"
            variant="ghost"
            size="sm"
            trailingIcon={ChevronRight}
            data-testid="dashboard-activity-audit"
          >
            Audit log
          </ButtonLink>
        }
      />
      {activity.status === 'loading' && (
        <SkeletonGroup label="Loading recent activity" className="tx-dashboard-activity">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="tx-dashboard-activity__item">
              <div className="tx-stack tx-stack--tight">
                <Skeleton width={index % 2 === 0 ? '70%' : '52%'} />
                <Skeleton width="28%" />
              </div>
              <Skeleton width="72px" />
            </div>
          ))}
        </SkeletonGroup>
      )}
      {activity.status === 'error' && (
        <ErrorNotice
          error={activity.error}
          title="The recent activity could not be loaded"
          onRetry={onRetry}
        />
      )}
      {activity.status === 'ready' &&
        (activity.data.length === 0 ? (
          <EmptyState variant="inline" level={3} icon={ScrollText} title="No activity yet">
            What people and players do in this organisation is listed here as it happens.
          </EmptyState>
        ) : (
          <ol className="tx-dashboard-activity" aria-labelledby="dashboard-activity-title">
            {activity.data.map((event) => (
              <ActivityRow key={event.id} item={presentActivity(event, names)} now={now} />
            ))}
          </ol>
        ))}
    </Card>
  );
}

function ObjectName({
  object,
  testId,
}: {
  readonly object: ActivityObject;
  readonly testId: string;
}) {
  return object.href === null ? (
    <span className="tx-dashboard-activity__object">{object.name}</span>
  ) : (
    <Link to={object.href} className="tx-dashboard-activity__object" data-testid={testId}>
      {object.name}
    </Link>
  );
}

function ActivityRow({ item, now }: { readonly item: ActivityItem; readonly now: number }) {
  return (
    <li
      className={cx('tx-dashboard-activity__item', `tx-dashboard-activity__item--${item.tone}`)}
      data-testid="dashboard-activity-item"
      data-action={item.action}
      data-result={item.result}
    >
      <div className="tx-dashboard-activity__body">
        <p className="tx-dashboard-activity__sentence">
          {item.text}
          {item.subject !== null && (
            <>
              {': '}
              <ObjectName object={item.subject} testId="dashboard-activity-link" />
            </>
          )}
          {item.subjectGone && (
            <span className="tx-dashboard-activity__gone"> (since deleted)</span>
          )}
        </p>
        <p className="tx-dashboard-activity__meta tx-small">
          <span>{item.actor}</span>
          {item.related !== null && (
            <span>
              {item.relatedLabel ?? RELATED_LABELS[item.related.kind]}:{' '}
              <ObjectName object={item.related} testId="dashboard-activity-related" />
            </span>
          )}
          {item.reasonCodes.map((code) => (
            <span key={code} className="tx-code">
              {code}
            </span>
          ))}
          {!item.known && <span className="tx-code">{item.action}</span>}
        </p>
      </div>
      <div className="tx-dashboard-activity__end">
        {item.resultLabel !== null && (
          <StatusPill tone={item.tone === 'danger' ? 'danger' : 'warn'}>
            {item.resultLabel}
          </StatusPill>
        )}
        <time
          className="tx-dashboard-activity__time tx-nowrap"
          dateTime={item.occurredAt}
          title={formatTimestamp(item.occurredAt)}
        >
          {activityTimeLabel(item.occurredAt, now)}
        </time>
      </div>
    </li>
  );
}
