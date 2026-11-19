import type { PushPlanResponse } from '@tinnox/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isAbort } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useCan } from '../../session/AuthenticatedSession.tsx';
import { PushDialog } from './PushDialog.tsx';

/** What a caller may ask the push dialog to start with. */
export interface PushRequest {
  /**
   * Show only these screens: the screens of one playlist, or one screen. Left out, every
   * screen of the push plan is listed. The operator can lift the limit inside the dialog.
   * The ids are display ids: the API and the contracts keep the M0 name.
   */
  readonly only?: readonly string[];
  /**
   * Tick exactly these screens when the dialog opens, where they have changes waiting.
   * Left out, every listed screen with changes waiting is ticked.
   */
  readonly preselect?: readonly string[];
  /** The earlier name of `preselect`; used when `preselect` is left out. */
  readonly displayIds?: readonly string[];
}

/**
 * The contract between the shell, the pages and the push feature
 * (docs/portal-v2/stage-a.md, 3.9). The header's "Push to screens" button, the dashboard,
 * the playlist editor and a screen's page all go through it, so there is one push plan,
 * one dialog and one pending count.
 */
export interface PushContextValue {
  /**
   * The push plan as last read from `GET /api/push`: one row per screen with its assigned
   * playlist and push state. `null` until the first answer. After a refresh that failed it
   * is still the last answer; `planError` then says so.
   */
  readonly plan: PushPlanResponse | null;
  /** What the latest attempt to read the plan failed with, or `null` when it succeeded. */
  readonly planError: unknown;
  /**
   * How many screens have changes waiting. `null` while it is not known (the plan has not
   * been read yet); the button then shows no badge.
   */
  readonly pendingCount: number | null;
  /**
   * Reads the plan again now. Call it after a save that can change what is waiting. While
   * the push dialog is open it does nothing, so the rows do not move under the operator; the
   * dialog reads the plan itself (its own refresh button, and after a push).
   */
  readonly refresh: () => void;
  /**
   * Opens the push dialog, for every screen or for the screens the request names. Does
   * nothing without `push.publish`.
   */
  readonly openDialog: (request?: PushRequest) => void;
  /** The same function as `openDialog`, under the name the shell's button uses. */
  readonly openPush: (request?: PushRequest) => void;
  /** The same function as `refresh`, under its earlier name. */
  readonly refreshPending: () => void;
}

export const PushContext = createContext<PushContextValue | null>(null);

/** The push plan and controls. Only usable below `PushProvider`, which `AppShell` renders. */
export function usePush(): PushContextValue {
  const value = useContext(PushContext);
  if (value === null) throw new Error('usePush must be used inside PushProvider');
  return value;
}

/** How often the plan is read again while the tab is visible and the dialog is closed. */
const REFRESH_MS = 30_000;

interface PlanState {
  readonly plan: PushPlanResponse | null;
  /** The number of the request that produced `plan`; 0 before the first answer. */
  readonly planSeq: number;
  /** `Date.now()` when `plan` arrived. */
  readonly loadedAt: number;
  /** The failure of the latest finished request, or null when it succeeded. */
  readonly error: unknown;
  readonly errorSeq: number;
}

const NO_PLAN: PlanState = { plan: null, planSeq: 0, loadedAt: 0, error: null, errorSeq: 0 };

interface Opening {
  /** Changes at every opening, so the dialog starts each one with fresh state and a new key. */
  readonly id: number;
  /** The first plan request that is recent enough for this opening. */
  readonly minSeq: number;
  readonly request: PushRequest;
}

/** The same answer as before keeps its identity, so readers of `plan` do not re-render. */
function samePlan(a: PushPlanResponse | null, b: PushPlanResponse): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Provides `PushContext` to the signed-in application. `AppShell` renders it inside the
 * router, the session and the `ToastProvider`.
 *
 * It reads the push plan when it mounts, every 30 seconds while the tab is visible, when
 * the tab becomes visible again after a longer pause, and on demand. While the push dialog
 * is open the timer rests: the dialog reads a fresh plan when it opens and after each push,
 * so the list never changes under the operator's hands.
 */
export function PushProvider({ children }: { readonly children: ReactNode }) {
  const [planState, setPlanState] = useState<PlanState>(NO_PLAN);
  const [opening, setOpening] = useState<Opening>({ id: 0, minSeq: 0, request: {} });
  const [open, setOpen] = useState(false);

  const seq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  const dialogOpen = useRef(false);
  const canPush = useCan('push.publish');

  /** Reads the plan. The latest request wins; the promise settles when this one is over. */
  const load = useCallback((): Promise<void> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    seq.current += 1;
    const mine = seq.current;
    startedAt.current = Date.now();
    return api.getPushPlan(controller.signal).then(
      (plan) => {
        if (seq.current !== mine) return;
        setPlanState((previous) => ({
          plan: samePlan(previous.plan, plan) ? previous.plan : plan,
          planSeq: mine,
          loadedAt: Date.now(),
          error: null,
          errorSeq: previous.errorSeq,
        }));
      },
      (error: unknown) => {
        if (seq.current !== mine || isAbort(error)) return;
        setPlanState((previous) => ({ ...previous, error, errorSeq: mine }));
      },
    );
  }, []);

  useEffect(() => {
    void load();
    const refreshIfDue = () => {
      if (document.visibilityState !== 'visible' || dialogOpen.current) return;
      if (Date.now() - startedAt.current >= REFRESH_MS) void load();
    };
    // Checked a little more often than the interval, so a tick never slips a whole period.
    const timer = window.setInterval(refreshIfDue, REFRESH_MS / 6);
    document.addEventListener('visibilitychange', refreshIfDue);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfDue);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [load]);

  const refresh = useCallback(() => {
    if (dialogOpen.current) return;
    void load();
  }, [load]);

  const openDialog = useCallback(
    (request: PushRequest = {}) => {
      // A dialog already open stays open if the key is lost meanwhile: its refusal shows, and
      // close() still clears dialogOpen. The plan poll runs for everyone (the waiting count).
      if (!canPush || dialogOpen.current) return;
      dialogOpen.current = true;
      // The dialog waits for a plan read at or after this moment.
      void load();
      setOpening((previous) => ({ id: previous.id + 1, minSeq: seq.current, request }));
      setOpen(true);
    },
    [canPush, load],
  );

  const close = useCallback(() => {
    dialogOpen.current = false;
    setOpen(false);
  }, []);

  const value = useMemo<PushContextValue>(
    () => ({
      plan: planState.plan,
      planError: planState.error,
      pendingCount: planState.plan?.pendingCount ?? null,
      refresh,
      openDialog,
      openPush: openDialog,
      refreshPending: refresh,
    }),
    [planState.plan, planState.error, refresh, openDialog],
  );

  const fresh = planState.planSeq >= opening.minSeq;
  const failed = planState.error !== null && planState.errorSeq >= opening.minSeq;

  return (
    <PushContext value={value}>
      {children}
      <PushDialog
        key={opening.id}
        open={open}
        onClose={close}
        only={opening.request.only}
        preselect={opening.request.preselect ?? opening.request.displayIds}
        plan={fresh ? planState.plan : null}
        planLoadedAt={planState.loadedAt}
        planError={failed ? planState.error : null}
        reload={load}
      />
    </PushContext>
  );
}
