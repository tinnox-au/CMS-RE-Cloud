import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NavigationType,
  Outlet,
  useLocation,
  useNavigation,
  useNavigationType,
} from 'react-router-dom';
import { PushProvider } from '../features/push/PushContext.tsx';
import { useSessionState } from '../session/SessionContext.tsx';
import { ToastProvider, cx } from '../ui/index.ts';
import { normalisePath } from './nav.ts';
import { ShellContext, type ShellContextValue } from './ShellContext.ts';
import { Sidebar } from './Sidebar.tsx';
import { useMediaQuery } from './useMediaQuery.ts';

/** Under this width the sidebar is a drawer (design-system.md, section 4). */
const DRAWER_QUERY = '(max-width: 899px)';

/**
 * The signed-in application frame: skip link, sidebar, and beside it the routed page
 * (`Outlet`). Each page renders its own header and `main` landmark through `Page` or
 * `EditorPage`. The prototype notice is the "Prototype" capsule beside the wordmark.
 *
 * The shell also owns what must outlive a page: the toast stack, the push controls
 * (`PushProvider`), sign-out, the sidebar's collapsed and drawer state, and the hidden live
 * region that names the page after a navigation. All of it is held in memory only.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const navigation = useNavigation();
  const drawerMode = useMediaQuery(DRAWER_QUERY);

  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  // The drawer never stays open across a change of page or when the window grows.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (navOpen) setNavOpen(false);
  }
  if (!drawerMode && navOpen) setNavOpen(false);

  // --- Sign-out: the behaviour of the M0 top bar, now started from the account menu. ---
  const { signOut } = useSessionState();
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown>(null);
  const startSignOut = useCallback(() => {
    setSignOutBusy(true);
    setSignOutError(null);
    signOut().catch((reason: unknown) => {
      setSignOutError(reason);
      setSignOutBusy(false);
    });
  }, [signOut]);
  const dismissSignOutError = useCallback(() => {
    setSignOutError(null);
  }, []);

  // --- Navigation: start a new page at its top; after a drawer link, focus the page. ---
  const focusMainAt = useRef<string | null>(null);
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    // Back and forward keep the scroll position the browser restores.
    if (navigationType !== NavigationType.Pop) window.scrollTo(0, 0);
  }, [pathname, navigationType]);

  useEffect(() => {
    if (navOpen || focusMainAt.current === null) return;
    if (normalisePath(pathname) !== focusMainAt.current) return;
    focusMainAt.current = null;
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [navOpen, pathname]);

  const openNav = useCallback(() => {
    setNavOpen(true);
  }, []);
  const closeNav = useCallback(() => {
    setNavOpen(false);
  }, []);
  const handleNavigate = useCallback(
    (to: string) => {
      if (!drawerMode) return;
      // Closing the drawer hands focus back to the menu button, which the next page
      // replaces; put it on the page content instead, once that page is showing.
      focusMainAt.current = to;
      setNavOpen(false);
    },
    [drawerMode],
  );

  // --- The page name, for assistive technology, after each navigation (not on load). ---
  const lastAnnounced = useRef<string | null>(null);
  const announcePage = useCallback((title: string) => {
    const first = lastAnnounced.current === null;
    if (lastAnnounced.current === title) return;
    lastAnnounced.current = title;
    if (!first) setAnnouncement(title);
  }, []);

  const shell = useMemo<ShellContextValue>(
    () => ({
      drawerMode,
      navOpen,
      openNav,
      signOut: {
        busy: signOutBusy,
        error: signOutError,
        start: startSignOut,
        dismissError: dismissSignOutError,
      },
      announcePage,
    }),
    [
      drawerMode,
      navOpen,
      openNav,
      signOutBusy,
      signOutError,
      startSignOut,
      dismissSignOutError,
      announcePage,
    ],
  );

  return (
    <ToastProvider>
      <PushProvider>
        <ShellContext value={shell}>
          <a className="tx-skip-link" href="#main">
            Skip to content
          </a>
          {navigation.state === 'loading' && (
            <div className="tx-shell__progress" aria-hidden="true" />
          )}
          <div
            className={cx(
              'tx-shell',
              drawerMode && 'tx-shell--drawer',
              !drawerMode && collapsed && 'tx-shell--collapsed',
            )}
          >
            <Sidebar
              drawer={drawerMode}
              open={navOpen}
              onClose={closeNav}
              collapsed={collapsed}
              onToggleCollapsed={() => {
                setCollapsed((value) => !value);
              }}
              onNavigate={handleNavigate}
            />
            <div className="tx-shell__column">
              <Outlet />
            </div>
          </div>
          <p className="tx-visually-hidden" role="status" aria-live="polite">
            {announcement}
          </p>
        </ShellContext>
      </PushProvider>
    </ToastProvider>
  );
}
