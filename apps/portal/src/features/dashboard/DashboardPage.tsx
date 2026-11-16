import { useMemo } from 'react';
import { anythingPushed, pluralCount, setupProgress } from '../../lib/dashboard.ts';
import { formatAge } from '../../lib/format.ts';
import { Page } from '../../shell/Page.tsx';
import { ErrorNotice, IconButton } from '../../ui/index.ts';
import { RefreshCw } from '../../ui/icons.ts';
import { usePush } from '../push/PushContext.tsx';
import { useNow } from '../shared/index.ts';
import { ActivityCard } from './ActivityCard.tsx';
import './dashboard.css';
import { LibraryCard } from './LibraryCard.tsx';
import { StaleNotice } from './parts.tsx';
import { PushCard } from './PushCard.tsx';
import { AttentionCard, ScreensCard } from './ScreensCard.tsx';
import { SetupCard } from './SetupCard.tsx';
import { useActivityNames } from './useActivityNames.ts';
import { useDashboardData } from './useDashboardData.ts';

/**
 * The dashboard (docs/portal-v2/stage-a.md, 3.1): "Get set up" until the first push, the
 * screens by status with those that need attention, the changes waiting to be pushed, the
 * recent activity and the library. Every figure comes from the API and is read again every
 * 15 seconds while the tab is visible; a refresh keeps the figures on screen and a refresh
 * that fails says so without taking them away.
 */
export function DashboardPage() {
  const data = useDashboardData();
  const { overview, displays, statuses, activity } = data;
  const { plan, planError } = usePush();

  const names = useActivityNames(
    activity.status === 'ready' ? activity.data : null,
    displays.status === 'ready' ? displays.data : null,
  );

  const statusViews = statuses.status === 'ready' ? statuses.data : null;
  const setup = useMemo(() => {
    if (overview.status !== 'ready') return null;
    const pushed = anythingPushed(statusViews, plan);
    if (pushed === null) return null;
    const { displays: screens, media, playlists } = overview.data;
    return setupProgress({
      screens: screens.total,
      paired: screens.paired,
      media: media.total,
      playlists: playlists.total,
      pushed,
      pending: plan?.pendingCount ?? null,
    });
  }, [overview, statusViews, plan]);

  // The oldest of the figures on screen, for "Updated 12 seconds ago".
  const readAt = [overview, displays, statuses, activity]
    .map((state) => (state.status === 'ready' ? state.fetchedAt : null))
    .filter((value): value is number => value !== null);
  const oldest = readAt.length === 0 ? null : Math.min(...readAt);
  const now = useNow(oldest !== null);
  const age = oldest === null ? null : formatAge((Math.max(now, oldest) - oldest) / 1000);

  const refreshError =
    [overview, displays, statuses, activity]
      .map((state) => (state.status === 'ready' ? state.refreshError : null))
      .find((error) => error !== null && error !== undefined) ?? (plan !== null ? planError : null);

  const total = overview.status === 'ready' ? overview.data.displays.total : null;
  const subtitle =
    total === null || total === 0
      ? 'What each player last reported.'
      : `${pluralCount(total, 'screen')}, as each player last reported.`;

  return (
    <Page
      title="Dashboard"
      subtitle={subtitle}
      actions={
        <div className="tx-dashboard-toolbar">
          <p className="tx-dashboard-toolbar__updated" data-testid="dashboard-updated">
            {overview.status === 'loading'
              ? 'Loading the latest figures'
              : age === null || overview.status === 'error'
                ? ''
                : `Updated ${age}`}
          </p>
          <IconButton
            icon={RefreshCw}
            label="Refresh the dashboard"
            size="sm"
            onClick={data.reloadAll}
            data-testid="dashboard-refresh"
          />
        </div>
      }
    >
      <div className="tx-stack tx-stack--loose tx-dashboard">
        {overview.status === 'error' && (
          <ErrorNotice
            error={overview.error}
            title="The dashboard figures could not be loaded"
            onRetry={data.reloadOverview}
            className="tx-dashboard-error"
          />
        )}
        {refreshError !== null && refreshError !== undefined && (
          <StaleNotice error={refreshError} age={age} onRetry={data.reloadAll} />
        )}

        {setup !== null && !setup.complete && <SetupCard progress={setup} />}

        <ScreensCard overview={overview} />

        <div className="tx-dashboard-grid">
          <PushCard />
          <LibraryCard overview={overview} />
          {total !== null && total > 0 && (
            <AttentionCard displays={displays} statuses={statuses} onRetry={data.reloadScreens} />
          )}
          <ActivityCard activity={activity} names={names} onRetry={data.reloadActivity} />
        </div>
      </div>
    </Page>
  );
}
