import type { DeliveryStatusView, DisplayDto, SiteDto } from '@tinnox/contracts';
import { useCallback, useEffect, useRef } from 'react';
import { api } from '../../../api/index.ts';
import { useLoad, type LoadState } from '../../../hooks/useLoad.ts';
import { hasUnlistedScreen } from '../../../lib/screensList.ts';

/** How often the statuses are read again while the tab is visible (stage-a.md, 3.6). */
export const STATUS_REFRESH_MS = 10_000;

function loadDisplays(signal: AbortSignal): Promise<DisplayDto[]> {
  return api.listDisplays(signal);
}

function loadSites(signal: AbortSignal): Promise<SiteDto[]> {
  return api.listSites(signal);
}

function loadStatuses(signal: AbortSignal): Promise<DeliveryStatusView[]> {
  return api.listDisplayStatuses(signal);
}

export interface ScreensData {
  readonly displays: LoadState<DisplayDto[]>;
  readonly sites: LoadState<SiteDto[]>;
  readonly statuses: LoadState<DeliveryStatusView[]>;
  readonly reloadDisplays: () => void;
  readonly reloadSites: () => void;
  readonly reloadStatuses: () => void;
  /** Puts screens the API just answered with into the list, without another request. */
  readonly mergeDisplays: (updated: readonly DisplayDto[]) => void;
}

/**
 * The three reads behind the screens list. Each fails by itself: without the sites or the
 * statuses the screens are still listed, and the page says what is missing. The statuses are
 * read again every ten seconds; when they name a screen the list does not hold (one was
 * added somewhere else), the list is read again too.
 */
export function useScreensData(): ScreensData {
  const displays = useLoad(loadDisplays);
  const sites = useLoad(loadSites);
  const statuses = useLoad(loadStatuses, STATUS_REFRESH_MS);

  const displaysState = displays.state;
  const statusesState = statuses.state;
  const reloadDisplays = displays.reload;
  const setDisplays = displays.setData;

  // One list reload per status answer at most, so a mismatch can never spin.
  const askedFor = useRef<readonly DeliveryStatusView[] | null>(null);
  useEffect(() => {
    if (displaysState.status !== 'ready' || statusesState.status !== 'ready') return;
    const views = statusesState.data;
    if (askedFor.current === views) return;
    if (hasUnlistedScreen(displaysState.data, views)) {
      askedFor.current = views;
      reloadDisplays();
    }
  }, [displaysState, statusesState, reloadDisplays]);

  const current = useRef<readonly DisplayDto[] | null>(null);
  useEffect(() => {
    current.current = displaysState.status === 'ready' ? displaysState.data : null;
  }, [displaysState]);

  const mergeDisplays = useCallback(
    (updated: readonly DisplayDto[]) => {
      const list = current.current;
      if (list === null || updated.length === 0) return;
      const byId = new Map(updated.map((display) => [display.id, display]));
      const next = list.map((display) => byId.get(display.id) ?? display);
      current.current = next;
      setDisplays(next);
    },
    [setDisplays],
  );

  return {
    displays: displaysState,
    sites: sites.state,
    statuses: statusesState,
    reloadDisplays,
    reloadSites: sites.reload,
    reloadStatuses: statuses.reload,
    mergeDisplays,
  };
}
