import type { SessionResponse } from '@tinnox/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, apiClient, onUnauthenticated } from '../api/index.ts';

export type AuthenticatedSession = Extract<SessionResponse, { authenticated: true }>;

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'anonymous'; readonly reason: 'signed_out' | 'ended' | 'none' }
  | { readonly status: 'authenticated'; readonly session: AuthenticatedSession };

interface SessionContextValue {
  readonly state: SessionState;
  readonly retry: () => void;
  readonly signOut: () => Promise<void>;
}

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

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    apiClient
      .loadSession(controller.signal)
      .then((session) => {
        if (disposed) return;
        setState(
          session.authenticated
            ? { status: 'authenticated', session }
            : { status: 'anonymous', reason: 'none' },
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
        setState((previous) =>
          previous.status === 'authenticated' ? { status: 'anonymous', reason: 'ended' } : previous,
        );
      }),
    [],
  );

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  const signOut = useCallback(async () => {
    const { redirectTo } = await api.logout();
    apiClient.clearSession();
    const target = safeRedirectTarget(redirectTo);
    if (target !== null) {
      // Ends the identity-provider session too; the provider sends the browser back here.
      window.location.assign(target);
      return;
    }
    setState({ status: 'anonymous', reason: 'signed_out' });
  }, []);

  const value = useMemo(() => ({ state, retry, signOut }), [state, retry, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionState(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSessionState must be used inside SessionProvider');
  return value;
}

const AuthenticatedContext = createContext<AuthenticatedSession | null>(null);

export function AuthenticatedProvider({
  session,
  children,
}: {
  readonly session: AuthenticatedSession;
  readonly children: ReactNode;
}) {
  return <AuthenticatedContext.Provider value={session}>{children}</AuthenticatedContext.Provider>;
}

/** The signed-in session. Only usable below the authenticated part of the tree. */
export function useSession(): AuthenticatedSession {
  const value = useContext(AuthenticatedContext);
  if (value === null) throw new Error('useSession must be used inside the signed-in area');
  return value;
}
