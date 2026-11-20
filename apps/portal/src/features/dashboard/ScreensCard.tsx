import type { DeliveryStatusView, DisplayDto, OverviewResponse } from '@tinnox/contracts';
import { Link } from 'react-router-dom';
import type { LoadState } from '../../hooks/useLoad.ts';
import {
  formatCount,
  screenCounters,
  screensNeedingAttention,
  screensEmptyText,
  screensPath,
  type ScreenCounter,
} from '../../lib/dashboard.ts';
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
import { ArrowRight, ChevronRight, CircleCheck, Monitor } from '../../ui/icons.ts';
import { ScreenStatusPill } from '../shared/index.ts';

interface ScreensCardProps {
  readonly overview: LoadState<OverviewResponse>;
  /** The role sets up screens (`screen.setup`): the empty card says what to do, else who does it. */
  readonly canSetup: boolean;
}

/**
 * The screens by status: four cards across the page, each opening the screens list filtered
 * to its screens. The number of screens is the page subtitle.
 */
export function ScreensCard({ overview, canSetup }: ScreensCardProps) {
  return (
    <section
      aria-labelledby="dashboard-screens-title"
      className="tx-dashboard-screens"
      data-testid="dashboard-screens"
    >
      <h2 id="dashboard-screens-title" className="tx-visually-hidden">
        Screens
      </h2>
      {overview.status === 'loading' && <CounterSkeletons />}
      {overview.status === 'error' && (
        <Card>
          <p className="tx-dashboard-unavailable">The counts are not available.</p>
        </Card>
      )}
      {overview.status === 'ready' &&
        (overview.data.displays.total === 0 ? (
          <Card>
            <EmptyState variant="inline" level={3} icon={Monitor} title="No screens yet">
              {screensEmptyText(canSetup)}
            </EmptyState>
          </Card>
        ) : (
          <ul className="tx-dashboard-counters" aria-label="Screens by status">
            {screenCounters(overview.data.displays.bySummary).map((counter) => (
              <li key={counter.group}>
                <CounterTile counter={counter} />
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function CounterTile({ counter }: { readonly counter: ScreenCounter }) {
  return (
    <Link
      to={counter.href}
      className={cx(
        'tx-dashboard-counter',
        `tx-dashboard-counter--${counter.group}`,
        counter.count > 0 && 'has-count',
      )}
      data-testid={`dashboard-counter-${counter.status}`}
      data-count={counter.count}
    >
      <span className="tx-dashboard-counter__label">
        <span className="tx-dashboard-counter__dot" aria-hidden="true" />
        {counter.label}
      </span>
      <span className="tx-dashboard-counter__count tx-numeral">{formatCount(counter.count)}</span>
      <span className="tx-dashboard-counter__hint tx-small">{counter.hint}</span>
    </Link>
  );
}

function CounterSkeletons() {
  return (
    <SkeletonGroup label="Loading screen counts" className="tx-dashboard-counters">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="tx-dashboard-counter tx-dashboard-counter--skeleton">
          <Skeleton width="60%" />
          <Skeleton width="40%" height="44px" />
          <Skeleton width="80%" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

interface AttentionCardProps {
  readonly displays: LoadState<DisplayDto[]>;
  readonly statuses: LoadState<DeliveryStatusView[]>;
  readonly onRetry: () => void;
}

/**
 * The screens whose player reports an error or has stopped reporting, with their status,
 * and the way to the whole screens list.
 */
export function AttentionCard({ displays, statuses, onRetry }: AttentionCardProps) {
  return (
    <Card
      as="section"
      aria-labelledby="dashboard-attention-title"
      className="tx-dashboard-card tx-dashboard-card--attention"
      data-testid="dashboard-attention"
    >
      <CardHeader
        id="dashboard-attention-title"
        title="Needs attention"
        size="title"
        actions={
          <ButtonLink
            to="/screens"
            variant="ghost"
            size="sm"
            trailingIcon={ChevronRight}
            data-testid="dashboard-screens-all"
          >
            All screens
          </ButtonLink>
        }
      />
      <Attention displays={displays} statuses={statuses} onRetry={onRetry} />
    </Card>
  );
}

function Attention({ displays, statuses, onRetry }: AttentionCardProps) {
  if (displays.status === 'error' || statuses.status === 'error') {
    const error =
      displays.status === 'error'
        ? displays.error
        : statuses.status === 'error'
          ? statuses.error
          : null;
    return (
      <ErrorNotice
        error={error}
        title="The screens that need attention could not be loaded"
        onRetry={onRetry}
      />
    );
  }

  if (displays.status === 'loading' || statuses.status === 'loading') {
    return (
      <SkeletonGroup
        label="Loading screens that need attention"
        className="tx-dashboard-list tx-dashboard-attention"
      >
        {[0, 1, 2].map((index) => (
          <div key={index} className="tx-dashboard-row">
            <Skeleton width="45%" />
            <Skeleton width="112px" />
          </div>
        ))}
      </SkeletonGroup>
    );
  }

  const list = screensNeedingAttention(displays.data, statuses.data);
  if (list.total === 0) {
    return (
      <p className="tx-dashboard-calm" data-testid="dashboard-attention-none">
        <Icon icon={CircleCheck} size={16} />
        No player reports an error, and none has stopped reporting.
      </p>
    );
  }

  return (
    <>
      <ul
        className="tx-dashboard-list tx-dashboard-attention"
        aria-labelledby="dashboard-attention-title"
        data-testid="dashboard-attention-list"
      >
        {list.rows.map((row) => (
          <li
            key={row.display.id}
            className="tx-dashboard-row"
            data-testid={`dashboard-attention-row-${row.display.id}`}
          >
            <Link
              to={`/screens/${row.display.id}`}
              className="tx-dashboard-row__title tx-row-title tx-truncate"
              title={row.display.name}
            >
              {row.display.name}
            </Link>
            <ScreenStatusPill
              view={row.view}
              fetchedAt={statuses.fetchedAt}
              detail="below"
              testId="dashboard-attention-status"
              className="tx-dashboard-row__end"
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
    </>
  );
}
