import type { AuthErrorCode, SessionResponse } from '@tinnox/contracts';
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
import { api, apiClient, onForbidden, onSessionChanged, onUnauthenticated } from '../api/index.ts';
import { takeAuthError } from '../lib/authError.ts';
import type { AuthenticatedSession } from './AuthenticatedSession.tsx';

// The signed-in part lives in AuthenticatedSession.tsx, which imports nothing from api/.
// Re-exported for the importers this build does not touch (AppShell.tsx and others).
export {
  AuthenticatedProvider,
  useCan,
  useCanAtMount,
  useSession,
  type AuthenticatedSession,
} from './AuthenticatedSession.tsx';

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'anonymous';
      readonly reason: 'signed_out' | 'ended' | 'none';
      /** Why the last sign-in failed (`?authError=` on the portal root), read once at load. */
      readonly authError: AuthErrorCode | null;
    }
  | { readonly status: 'authenticated'; readonly session: AuthenticatedSession };

interface SessionContextValue {
  readonly state: SessionState;
  /** Loads the session again from scratch: shows the session check and unmounts the router. */
  readonly retry: () => void;
  /**
   * Reloads the session silently while signed in: the same member's new session (role and
   * keys) replaces the old one and the router stays mounted. A failure keeps the state.
   */
  readonly refresh: () => Promise<void>;
  readonly signOut: () => Promise<void>;
}

/**
 * Focus and visibility refresh the session at most this often: each load records activity
 * on the server. A refusal by role always refreshes.
 */
export const SESSION_REFRESH_MIN_MS = 10_000;

const SessionContext = createContext<SessionContextValue | null>(null);

/** Only http(s) URLs are followed after sign-out; anything else is ignored. */
function safeRedirectTarget(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * After sign-out the identity provider sends the browser back to the portal root with this
 * `state` (apps/api/src/auth/oidc.ts). Only this exact value is acted on.
 */
const SIGNED_OUT_STATE = 'signed_out';

/**
 * Says whether the address carries `state=signed_out` and removes it from the address bar,
 * keeping the path, the other query parameters and the fragment.
 */
function takeSignedOutMarker(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get('state') !== SIGNED_OUT_STATE) return false;
  url.searchParams.delete('state');
  window.history.replaceState(window.history.state, '', url);
  return true;
}

function sameMember(a: AuthenticatedSession, b: AuthenticatedSession): boolean {
  return a.user.membershipId === b.user.membershipId && a.organization.id === b.organization.id;
}

const ENDED: SessionState = { status: 'anonymous', reason: 'ended', authError: null };

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // The latest state, for the refresh's answer (read outside a render).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  /** When a session load last started (`Date.now()`), for the focus throttle. */
  const lastLoadAt = useRef(Number.NEGATIVE_INFINITY);
  const refreshSeq = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  /** The refresh in flight, which a focus, visibility or forbidden trigger joins. */
  const refreshInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    lastLoadAt.current = Date.now();
    apiClient
      .loadSession(controller.signal)
      .then((session) => {
        if (disposed) return;
        // Read here, after the disposed check, so StrictMode's discarded first run never
        // consumes the markers. They are dropped when the session is authenticated too.
        const signedOut = takeSignedOutMarker();
        const authError = takeAuthError();
        setState(
          session.authenticated
            ? { status: 'authenticated', session }
            : { status: 'anonymous', reason: signedOut ? 'signed_out' : 'none', authError },
        );
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setState({ status: 'error', error });
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [attempt]);

  useEffect(
    () =>
      onUnauthenticated(() => {
        setState((previous) => (previous.status === 'authenticated' ? ENDED : previous));
      }),
    [],
  );

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  /** One silent load. The latest one wins; an earlier one still running is cancelled. */
  const reload = useCallback(async (): Promise<void> => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    refreshSeq.current += 1;
    const mine = refreshSeq.current;
    lastLoadAt.current = Date.now();
    let next: SessionResponse;
    try {
      next = await apiClient.loadSession(controller.signal);
    } catch {
      // Network, 5xx, 429, aborted, invalid_response: keep the session as it is.
      return;
    } finally {
      if (refreshController.current === controller) refreshController.current = null;
    }
    const current = stateRef.current;
    if (refreshSeq.current !== mine || current.status !== 'authenticated') return;
    if (!next.authenticated) {
      setState((previous) => (previous.status === 'authenticated' ? ENDED : previous));
    } else if (sameMember(current.session, next)) {
      setState((previous) =>
        previous.status === 'authenticated' ? { status: 'authenticated', session: next } : previous,
      );
    } else {
      // Another tab signed in as someone else: start again, so no page keeps the old member's data.
      // The new member's token is dropped until the new session check stores it, so no write
      // from the old member's page goes out as the new member before that page is gone.
      apiClient.clearSession();
      retry();
    }
  }, [retry]);

  const refresh = useCallback((): Promise<void> => {
    if (stateRef.current.status !== 'authenticated') return Promise.resolve();
    const running: Promise<void> = reload().finally(() => {
      if (refreshInFlight.current === running) refreshInFlight.current = null;
    });
    refreshInFlight.current = running;
    return running;
  }, [reload]);

  useEffect(() => {
    /** Joins the refresh in flight, so many refusals at once load the session once. */
    const trigger = () => {
      if (refreshInFlight.current === null) void refresh();
    };
    // shortcut: focus and visibility refresh at most every 10 s (SESSION_REFRESH_MIN_MS), so a
    // role change made elsewhere shows within that; push role changes to the tab if it must be instant.
    const triggerIfDue = () => {
      if (Date.now() - lastLoadAt.current < SESSION_REFRESH_MIN_MS) return;
      trigger();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') triggerIfDue();
    };
    const stopForbidden = onForbidden(trigger);
    const stopSessionChanged = onSessionChanged(trigger);
    window.addEventListener('focus', triggerIfDue);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopForbidden();
      stopSessionChanged();
      window.removeEventListener('focus', triggerIfDue);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  // A refresh in flight is cancelled when the provider goes away.
  useEffect(
    () => () => {
      refreshController.current?.abort();
    },
    [],
  );

  const signOut = useCallback(async () => {
    const { redirectTo } = await api.logout();
    apiClient.clearSession();
    const target = safeRedirectTarget(redirectTo);
    if (target !== null) {
      // Ends the identity-provider session too; the provider sends the browser back here
      // with state=signed_out, which the session load above turns into the signed-out notice.
      window.location.assign(target);
      return;
    }
    setState({ status: 'anonymous', reason: 'signed_out', authError: null });
  }, []);

  const value = useMemo(
    () => ({ state, retry, refresh, signOut }),
    [state, retry, refresh, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionState(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSessionState must be used inside SessionProvider');
  return value;
}
