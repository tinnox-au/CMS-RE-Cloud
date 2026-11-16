import { createContext, useContext } from 'react';

/** Sign-out as the account menu starts it and the page frames report it. */
export interface SignOutControl {
  /** True from the press until the session has ended or the attempt has failed. */
  readonly busy: boolean;
  /** Why the last attempt failed, or null. Shown by the page frame as an alert. */
  readonly error: unknown;
  readonly start: () => void;
  readonly dismissError: () => void;
}

/** What `AppShell` offers to the page frames (`Page`, `EditorPage`) and the header controls. */
export interface ShellContextValue {
  /** Under 900 px the sidebar is an overlay drawer and the header shows a menu button. */
  readonly drawerMode: boolean;
  readonly navOpen: boolean;
  readonly openNav: () => void;
  readonly signOut: SignOutControl;
  /** Tells assistive technology which page is now showing, after a navigation. */
  readonly announcePage: (title: string) => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

/** The shell's shared state. Only usable below `AppShell`. */
export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (value === null) throw new Error('useShell must be used inside AppShell');
  return value;
}
