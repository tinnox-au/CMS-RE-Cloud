import type { DeliveryStatusView, DisplayDto, OverviewResponse } from '@tinnox/contracts';
import { Link } from 'react-router-dom';
import type { LoadState } from '../../hooks/useLoad.ts';
import {
  formatCount,
  pluralCount,
  screenCounters,
  screensNeedingAttention,
  screensPath,
  type ScreenCounter,
} from '../../lib/dashboard.ts';
import type { ScreenStatusGroup } from '../../lib/screenStatus.ts';
import {
  ButtonLink,
  Card,
  CardHeader,
  cx,
  EmptyState,
  ErrorNotice,
  Icon,
  Skeleton,
  SkeletonGroup,
} from '../../ui/index.ts';
import {
  ArrowRight,
  CircleCheck,
  Monitor,
  RefreshCw,
  TriangleExclamationPoint,
  Unlink,
  type IconComponent,
} from '../../ui/icons.ts';
import { ScreenStatusPill } from '../shared/index.ts';

const COUNTER_ICONS: { readonly [K in ScreenStatusGroup]: IconComponent } = {
  in_sync: CircleCheck,
  pending: RefreshCw,
  attention: TriangleExclamationPoint,
  not_paired: Unlink,
};

interface ScreensCardProps {
  readonly overview: LoadState<OverviewResponse>;
  readonly displays: LoadState<DisplayDto[]>;
  readonly statuses: LoadState<DeliveryStatusView[]>;
  readonly onRetryScreens: () => void;
}

/**
 * The Screens card: four counters that open the screens list filtered to them, and the
 * screens whose player reports an error or has stopped reporting, with their status.
 */
export function ScreensCard({ overview, displays, statuses, onRetryScreens }: ScreensCardProps) {
  const total = overview.status === 'ready' ? overview.data.displays.total : null;
  return (
    <Card
      as="section"
      aria-labelledby="dashboard-screens-title"
      className="tx-dashboard-card tx-dashboard-card--screens"
      data-testid="dashboard-screens"
    >
      <CardHeader
        id="dashboard-screens-title"
        title="Screens"
        size="title"
        description={
          total === null || total === 0
            ? 'What each player last reported.'
            : `${pluralCount(total, 'screen')}, as each player last reported.`
        }
        actions={
          <ButtonLink
            to="/screens"
            variant="ghost"
            size="sm"
            trailingIcon={ArrowRight}
            data-testid="dashboard-screens-all"
          >
            All screens
          </ButtonLink>
        }
      />
      {overview.status === 'loading' && <CounterSkeletons />}
      {overview.status === 'error' && (
        <p className="tx-dashboard-unavailable">The counts are not available.</p>
      )}
      {overview.status === 'ready' &&
        (overview.data.displays.total === 0 ? (
          <EmptyState variant="inline" level={3} icon={Monitor} title="No screens yet">
            Add a screen and pair its player. What the player reports then shows here.
          </EmptyState>
        ) : (
          <>
            <ul className="tx-dashboard-counters" aria-label="Screens by status">
              {screenCounters(overview.data.displays.bySummary).map((counter) => (
                <li key={counter.group}>
                  <CounterTile counter={counter} />
                </li>
              ))}
            </ul>
            <Attention displays={displays} statuses={statuses} onRetry={onRetryScreens} />
          </>
        ))}
    </Card>
  );
}

function CounterTile({ counter }: { readonly counter: ScreenCounter }) {
  return (
    <Link
      to={counter.href}
      className={cx(
        'tx-dashboard-counter',
        counter.count > 0 && `tx-dashboard-counter--${counter.tone}`,
      )}
      data-testid={`dashboard-counter-${counter.status}`}
      data-count={counter.count}
    >
      <span className="tx-dashboard-counter__label">
        <Icon
          icon={COUNTER_ICONS[counter.group]}
          size={16}
          className="tx-dashboard-counter__icon"
        />
        {counter.label}
      </span>
      <span className="tx-dashboard-counter__count tx-num">{formatCount(counter.count)}</span>
      <span className="tx-dashboard-counter__hint">{counter.hint}</span>
    </Link>
  );
}

function CounterSkeletons() {
  return (
    <SkeletonGroup label="Loading screen counts" className="tx-dashboard-counters">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="tx-dashboard-counter tx-dashboard-counter--skeleton">
          <Skeleton width="60%" />
          <Skeleton width="40%" height="32px" />
          <Skeleton width="80%" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

interface AttentionProps {
  readonly displays: LoadState<DisplayDto[]>;
  readonly statuses: LoadState<DeliveryStatusView[]>;
  readonly onRetry: () => void;
}

function Attention({ displays, statuses, onRetry }: AttentionProps) {
  const heading = (
    <h3 className="tx-dashboard-subhead" id="dashboard-attention-title">
      Needs attention
    </h3>
  );

  if (displays.status === 'error' || statuses.status === 'error') {
    const error =
      displays.status === 'error'
        ? displays.error
        : statuses.status === 'error'
          ? statuses.error
          : null;
    return (
      <div className="tx-dashboard-attention">
        {heading}
        <ErrorNotice
          error={error}
          title="The screens that need attention could not be loaded"
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (displays.status === 'loading' || statuses.status === 'loading') {
    return (
      <div className="tx-dashboard-attention">
        {heading}
        <SkeletonGroup
          label="Loading screens that need attention"
          className="tx-dashboard-attention__list"
        >
          {[0, 1, 2].map((index) => (
            <div key={index} className="tx-dashboard-attention__row">
              <Skeleton width="45%" />
              <Skeleton variant="pill" width="112px" height="24px" />
            </div>
          ))}
        </SkeletonGroup>
      </div>
    );
  }

  const list = screensNeedingAttention(displays.data, statuses.data);
  if (list.total === 0) {
    return (
      <div className="tx-dashboard-attention">
        {heading}
        <p className="tx-dashboard-calm" data-testid="dashboard-attention-none">
          <Icon icon={CircleCheck} size={16} />
          No player reports an error, and none has stopped reporting.
        </p>
      </div>
    );
  }

  return (
    <div className="tx-dashboard-attention">
      {heading}
      <ul
        className="tx-dashboard-attention__list"
        aria-labelledby="dashboard-attention-title"
        data-testid="dashboard-attention-list"
      >
        {list.rows.map((row) => (
          <li
            key={row.display.id}
            className="tx-dashboard-attention__row"
            data-testid={`dashboard-attention-row-${row.display.id}`}
          >
            <Link
              to={`/screens/${row.display.id}`}
              className="tx-dashboard-attention__name tx-truncate"
            >
              {row.display.name}
            </Link>
            <ScreenStatusPill
              view={row.view}
              fetchedAt={statuses.fetchedAt}
              detail="below"
              testId="dashboard-attention-status"
              className="tx-dashboard-attention__status"
            />
          </li>
        ))}
      </ul>
      {list.total > list.rows.length && (
        <Link
          to={screensPath('attention')}
          className="tx-dashboard-more"
          data-testid="dashboard-attention-more"
        >
          Show all {formatCount(list.total)} screens that need attention
          <Icon icon={ArrowRight} size={16} />
        </Link>
      )}
    </div>
  );
}
