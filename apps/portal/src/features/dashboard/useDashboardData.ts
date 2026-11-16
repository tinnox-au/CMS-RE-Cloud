import type {
  AuditEventDto,
  DeliveryStatusView,
  DisplayDto,
  OverviewResponse,
} from '@tinnox/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/index.ts';
import { useLoad, type LoadState } from '../../hooks/useLoad.ts';
import { readPlanOnArrival } from '../../lib/dashboard.ts';
import { usePush } from '../push/PushContext.tsx';

/** How often the dashboard reads everything again while the tab is visible (stage-a.md, 3.1). */
export const DASHBOARD_REFRESH_MS = 15_000;

/** The number of audit events in "Recent activity". */
export const ACTIVITY_LIMIT = 10;

function loadOverview(signal: AbortSignal): Promise<OverviewResponse> {
  return api.getOverview(signal);
}

function loadDisplays(signal: AbortSignal): Promise<DisplayDto[]> {
  return api.listDisplays(signal);
}

function loadStatuses(signal: AbortSignal): Promise<DeliveryStatusView[]> {
  return api.listDisplayStatuses(signal);
}

async function loadActivity(signal: AbortSignal): Promise<readonly AuditEventDto[]> {
  const page = await api.listAudit({ limit: ACTIVITY_LIMIT }, signal);
  return page.items;
}

export interface DashboardData {
  readonly overview: LoadState<OverviewResponse>;
  readonly displays: LoadState<DisplayDto[]>;
  readonly statuses: LoadState<DeliveryStatusView[]>;
  readonly activity: LoadState<readonly AuditEventDto[]>;
  readonly reloadOverview: () => void;
  readonly reloadScreens: () => void;
  readonly reloadActivity: () => void;
  /** Reads everything again now, the push plan included, keeping what is shown meanwhile. */
  readonly reloadAll: () => void;
}

/**
 * The reads behind the dashboard. Each one fails by itself, so a card whose source answered
 * is drawn even when another card's source did not. Every read repeats every 15 seconds
 * while the tab is visible; a failed repeat keeps the last answer on screen (`useLoad`). The
 * push plan belongs to `PushContext`, which the dashboard asks to read again on the same
 * rhythm.
 */
export function useDashboardData(): DashboardData {
  const overview = useLoad(loadOverview, DASHBOARD_REFRESH_MS);
  const displays = useLoad(loadDisplays, DASHBOARD_REFRESH_MS);
  const statuses = useLoad(loadStatuses, DASHBOARD_REFRESH_MS);
  const activity = useLoad(loadActivity, DASHBOARD_REFRESH_MS);
  const { plan, planError, refresh: refreshPlan } = usePush();

  // The push plan is read by its provider every 30 s, and never while the push dialog is
  // open (the list must not change under the operator's hands). The dashboard reads it again
  // on arrival, unless the provider's first read is still under way (the portal opened on the
  // dashboard), and whenever the overview, read every 15 s, counts a different number of
  // screens with changes waiting than the plan does: then the plan is out of date.
  const [planOnArrival] = useState(() => readPlanOnArrival(plan, planError));
  useEffect(() => {
    if (planOnArrival) refreshPlan();
  }, [planOnArrival, refreshPlan]);

  const overviewPending =
    overview.state.status === 'ready' ? overview.state.data.pendingPushCount : null;
  const overviewReadAt = overview.state.status === 'ready' ? overview.state.fetchedAt : null;
  const planPending = plan?.pendingCount ?? null;
  useEffect(() => {
    if (overviewPending === null || planPending === null || overviewPending === planPending) {
      return;
    }
    refreshPlan();
    // Once per overview answer at most: `overviewReadAt` changes with every answer.
  }, [overviewPending, overviewReadAt, planPending, refreshPlan]);

  const reloadOverview = overview.reload;
  const reloadDisplays = displays.reload;
  const reloadStatuses = statuses.reload;
  const reloadActivity = activity.reload;

  const reloadScreens = useCallback(() => {
    reloadDisplays();
    reloadStatuses();
  }, [reloadDisplays, reloadStatuses]);

  const reloadAll = useCallback(() => {
    reloadOverview();
    reloadDisplays();
    reloadStatuses();
    reloadActivity();
    refreshPlan();
  }, [reloadOverview, reloadDisplays, reloadStatuses, reloadActivity, refreshPlan]);

  return {
    overview: overview.state,
    displays: displays.state,
    statuses: statuses.state,
    activity: activity.state,
    reloadOverview,
    reloadScreens,
    reloadActivity,
    reloadAll,
  };
}
