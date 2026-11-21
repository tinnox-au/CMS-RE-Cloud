import { ROUTES } from '@tinnox/contracts';
import { Fragment, lazy, Suspense, type ReactElement } from 'react';
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useLocation,
  useParams,
  type RouteObject,
} from 'react-router-dom';
import { AuthenticatedProvider } from './session/AuthenticatedSession.tsx';
import { SessionProvider, useSessionState } from './session/SessionContext.tsx';
import { AppShell } from './shell/AppShell.tsx';
import { HOME_PATH, screensPathFor } from './shell/nav.ts';
import { NotFoundPage } from './shell/NotFoundPage.tsx';
import { RequirePermission } from './shell/RequirePermission.tsx';
import {
  LoadingScreen,
  RouteError,
  RouteLoading,
  SessionCheckingScreen,
  SessionErrorScreen,
  SignInScreen,
  StandaloneErrorBoundary,
} from './shell/Screens.tsx';

const RETURN_TO_PATTERN = /^\/(?!\/)[A-Za-z0-9\-._~/]*$/;

/** Sign-in is a full-page navigation: the API runs the OIDC flow and sets the session cookie. */
function loginHref(): string {
  const path = window.location.pathname;
  if (path !== '/' && path.length <= 200 && RETURN_TO_PATTERN.test(path)) {
    return `${ROUTES.authLogin}?${new URLSearchParams({ returnTo: path }).toString()}`;
  }
  return ROUTES.authLogin;
}

/**
 * A route whose page is loaded on first visit, so each feature is its own bundle. The page
 * modules export named components (see the table in src/ui/README.md, "Shell"); `render`
 * picks the component and gives it its props.
 */
function page<M>(
  path: string,
  load: () => Promise<M>,
  render: (module: M) => ReactElement,
): RouteObject {
  return {
    path,
    hydrateFallbackElement: <RouteLoading />,
    lazy: async () => ({ element: render(await load()) }),
  };
}

const dashboard = () => import('./features/dashboard/DashboardPage.tsx');
const mediaLibrary = () => import('./features/media/MediaLibraryPage.tsx');
const mediaDetail = () => import('./features/media/MediaDetailPage.tsx');
const appsPage = () => import('./features/apps/AppsPage.tsx');
const appEditor = () => import('./features/apps/AppEditorPage.tsx');
const playlists = () => import('./features/playlists/PlaylistsPage.tsx');
const playlistEditor = () => import('./features/playlists/PlaylistEditorPage.tsx');
const schedulesPage = () => import('./features/schedules/SchedulesPage.tsx');
const scheduleEditor = () => import('./features/schedules/ScheduleEditorPage.tsx');
const layoutsPage = () => import('./features/layouts/LayoutsPage.tsx');
const layoutEditor = () => import('./features/layouts/LayoutEditorPage.tsx');
const displays = () => import('./features/displays/DisplaysPage.tsx');
const displayWizard = () => import('./features/displays/DisplayWizardPage.tsx');
const displayDetail = () => import('./features/displays/DisplayDetailPage.tsx');
const settings = () => import('./features/settings/SettingsPage.tsx');
const tags = () => import('./features/settings/TagsPage.tsx');
const alerts = () => import('./features/settings/AlertsPage.tsx');
const audit = () => import('./features/audit/AuditPage.tsx');
const users = () => import('./features/users/UsersPage.tsx');
const planned = () => import('./features/planned/PlannedPage.tsx');

/**
 * Mounts a detail page afresh for each object. React Router keeps a route's element mounted
 * when only its `:id` changes (Back and Forward, a link from one playlist or screen to
 * another), and `useLoad` deliberately keeps the data it has while it fetches again. Without
 * the key the page would show the previous object under the new address until the new one
 * arrived, and keep showing it, flagged as a failed refresh, when the new id does not exist.
 * The key starts the page in its loading state instead, so a missing object reaches the
 * page's own "not found" state.
 */
function PerObject({ children }: { readonly children: ReactElement }) {
  const { id = '' } = useParams();
  return <Fragment key={id}>{children}</Fragment>;
}

/** The M0 edit address. The canvas form is now a tab of the screen's page. */
function ScreenEditRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/screens/${encodeURIComponent(id)}?tab=canvas`} replace />;
}

/**
 * The M0 addresses under `/displays`. An operator sees "screen" everywhere (decision P2-03),
 * so the pages live under `/screens`; an old link or bookmark lands on the same page there,
 * with its query and fragment kept.
 */
function OldDisplaysRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={{ pathname: screensPathFor(pathname), search, hash }} replace />;
}

/**
 * The route table of docs/portal-v2/stage-a.md, section 1. Exported for
 * shell/RequirePermission.test.tsx, which renders the guarded routes from here.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to={HOME_PATH} replace /> },
      page('dashboard', dashboard, (m) => <m.DashboardPage />),

      page('media', mediaLibrary, (m) => <m.MediaLibraryPage kind="all" />),
      page('media/images', mediaLibrary, (m) => <m.MediaLibraryPage kind="image" />),
      page('media/videos', mediaLibrary, (m) => <m.MediaLibraryPage kind="video" />),
      page('media/audio', planned, (m) => <m.PlannedPage section="audio" />),
      page('media/documents', planned, (m) => <m.PlannedPage section="documents" />),
      page('media/web-pages', planned, (m) => <m.PlannedPage section="web-pages" />),
      page('media/:id', mediaDetail, (m) => (
        <PerObject>
          <m.MediaDetailPage />
        </PerObject>
      )),

      page('apps', appsPage, (m) => <m.AppsPage />),
      page('apps/:id', appEditor, (m) => (
        <PerObject>
          <m.AppEditorPage />
        </PerObject>
      )),
      page('layouts', layoutsPage, (m) => <m.LayoutsPage />),
      page('layouts/:id', layoutEditor, (m) => (
        <PerObject>
          <m.LayoutEditorPage />
        </PerObject>
      )),
      page('users', users, (m) => (
        <RequirePermission permission="member.read">
          <m.UsersPage />
        </RequirePermission>
      )),

      page('playlists', playlists, (m) => <m.PlaylistsPage />),
      page('playlists/:id', playlistEditor, (m) => (
        <PerObject>
          <m.PlaylistEditorPage />
        </PerObject>
      )),

      page('schedules', schedulesPage, (m) => <m.SchedulesPage />),
      page('schedules/:id', scheduleEditor, (m) => (
        <PerObject>
          <m.ScheduleEditorPage />
        </PerObject>
      )),

      page('screens', displays, (m) => <m.DisplaysPage />),
      page('screens/new', displayWizard, (m) => (
        <RequirePermission permission="screen.setup">
          <m.DisplayWizardPage />
        </RequirePermission>
      )),
      page('screens/:id', displayDetail, (m) => (
        <PerObject>
          <m.DisplayDetailPage />
        </PerObject>
      )),
      // Only a redirect to the Canvas tab, which is read-only without screen.setup: no guard.
      { path: 'screens/:id/edit', element: <ScreenEditRedirect /> },
      { path: 'displays/*', element: <OldDisplaysRedirect /> },

      page('settings', settings, (m) => <m.SettingsPage />),
      page('settings/tags', tags, (m) => <m.TagsPage />),
      page('settings/alerts', alerts, (m) => (
        <RequirePermission permission="alerts.manage">
          <m.AlertsPage />
        </RequirePermission>
      )),
      page('audit', audit, (m) => <m.AuditPage />),

      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

const router = createBrowserRouter(routes);

function Gate() {
  const { state, retry } = useSessionState();
  if (state.status === 'loading') return <SessionCheckingScreen />;
  if (state.status === 'error') return <SessionErrorScreen error={state.error} onRetry={retry} />;
  if (state.status === 'anonymous') {
    return (
      <SignInScreen reason={state.reason} authError={state.authError} loginHref={loginHref()} />
    );
  }
  return (
    <AuthenticatedProvider session={state.session}>
      <RouterProvider router={router} />
    </AuthenticatedProvider>
  );
}

/**
 * The component gallery (docs/portal-v2/stage-a.md, route `/styleguide`). Development builds
 * only: in a production build the condition is the constant `false`, so the dynamic import
 * and everything behind it are dropped from the bundle. It is shown without a session, so it
 * stays outside the session gate and the application's router.
 */
const StyleguidePage = import.meta.env.DEV
  ? lazy(() => import('./features/styleguide/StyleguidePage.tsx'))
  : null;

const STYLEGUIDE_PATH = /^\/styleguide\/?$/;

/** Opened from a confirmation e-mail by someone with no session: outside the session gate. */
const AlertConfirmPage = lazy(async () => ({
  default: (await import('./features/alerts/AlertConfirmPage.tsx')).AlertConfirmPage,
}));

const ALERT_CONFIRM_PATH = /^\/alerts\/confirm\/?$/;

export function App() {
  if (StyleguidePage !== null && STYLEGUIDE_PATH.test(window.location.pathname)) {
    return (
      <Suspense fallback={null}>
        <StyleguidePage />
      </Suspense>
    );
  }
  if (ALERT_CONFIRM_PATH.test(window.location.pathname)) {
    return (
      <StandaloneErrorBoundary>
        <Suspense fallback={<LoadingScreen />}>
          <AlertConfirmPage />
        </Suspense>
      </StandaloneErrorBoundary>
    );
  }
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
