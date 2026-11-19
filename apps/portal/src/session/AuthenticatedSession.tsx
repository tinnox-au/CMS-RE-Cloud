import type { PermissionKey, SessionResponse } from '@tinnox/contracts';
import { createContext, useContext, useState, type ReactNode } from 'react';

// Imports nothing from api/: component tests mock api/index.ts with only `{ api }`, and a
// gated component that reached SessionContext.tsx (which imports apiClient) would fail to link.

export type AuthenticatedSession = Extract<SessionResponse, { authenticated: true }>;

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

/**
 * True when the signed-in member's role grants `key` now. Only below AuthenticatedProvider.
 * Hiding a control is a convenience; the API decides every request.
 */
export function useCan(key: PermissionKey): boolean {
  return useSession().user.permissions.includes(key);
}

/** useCan frozen at the first render: an editor decides read-only once, when it mounts. */
export function useCanAtMount(key: PermissionKey): boolean {
  const now = useCan(key);
  // shortcut: read-only is decided at mount, so a promotion shows only after the editor is
  // opened again; follow the live value once editors can switch modes without losing drafts.
  const [atMount] = useState(now);
  return atMount;
}
