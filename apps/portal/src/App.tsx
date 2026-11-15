import { ROUTES } from '@tinnox/contracts';
import { useState } from 'react';
import {
  createBrowserRouter,
  isRouteErrorResponse,
  Link,
  Navigate,
  NavLink,
  Outlet,
  RouterProvider,
  useRouteError,
} from 'react-router-dom';
import { ErrorNotice, Loading, Notice } from './components/common.tsx';
import { AuditPage } from './pages/AuditPage.tsx';
import { DisplayDetailPage } from './pages/DisplayDetailPage.tsx';
import { DisplayFormPage } from './pages/DisplayFormPage.tsx';
import { DisplaysPage } from './pages/DisplaysPage.tsx';
import { MediaPage } from './pages/MediaPage.tsx';
import { PlaylistEditorPage } from './pages/PlaylistEditorPage.tsx';
import { PlaylistsPage } from './pages/PlaylistsPage.tsx';
import {
  AuthenticatedProvider,
  SessionProvider,
  useSession,
  useSessionState,
} from './session/SessionContext.tsx';

const RETURN_TO_PATTERN = /^\/(?!\/)[A-Za-z0-9\-._~/]*$/;

/** Sign-in is a full-page navigation: the API runs the OIDC flow and sets the session cookie. */
function loginHref(): string {
  const path = window.location.pathname;
  if (path !== '/' && path.length <= 200 && RETURN_TO_PATTERN.test(path)) {
    return `${ROUTES.authLogin}?${new URLSearchParams({ returnTo: path }).toString()}`;
  }
  return ROUTES.authLogin;
}

function SignInScreen({ reason }: { readonly reason: 'signed_out' | 'ended' | 'none' }) {
  return (
    <main className="signin">
      <div className="signin-card">
        <p className="brand brand-large">TINNOX CMS</p>
        <h1>Operator sign-in</h1>
        {reason === 'ended' && (
          <Notice tone="warn" live>
            <p>Your session has ended. Sign in again to continue.</p>
          </Notice>
        )}
        {reason === 'signed_out' && (
          <Notice tone="neutral" live>
            <p>You have signed out.</p>
          </Notice>
        )}
        <p>
          Sign-in happens at your organisation&apos;s identity provider and needs your password and
          a one-time code from your authenticator app.
        </p>
        <p>
          <a className="button button-primary button-wide" href={loginHref()}>
            Sign in
          </a>
        </p>
        <p className="small muted">Internal engineering prototype. Synthetic data only.</p>
      </div>
    </main>
  );
}

function Layout() {
  const session = useSession();
  const { signOut } = useSessionState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const handleSignOut = () => {
    setBusy(true);
    setError(null);
    signOut().catch((reason: unknown) => {
      setError(reason);
      setBusy(false);
    });
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/displays" className="brand">
          TINNOX CMS
        </Link>
        <nav aria-label="Main">
          <ul className="nav">
            <li>
              <NavLink to="/displays">Displays</NavLink>
            </li>
            <li>
              <NavLink to="/media">Media</NavLink>
            </li>
            <li>
              <NavLink to="/playlists">Playlists</NavLink>
            </li>
            <li>
              <NavLink to="/audit">Audit</NavLink>
            </li>
          </ul>
        </nav>
        <div className="account">
          <span className="account-text">
            <span className="account-org">{session.organization.name}</span>
            <span className="small muted">{session.user.displayName}</span>
          </span>
          <button type="button" className="button" onClick={handleSignOut} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>
      <main id="main" className="content" tabIndex={-1}>
        {error !== null && <ErrorNotice error={error} title="Sign-out did not complete" />}
        <Outlet />
      </main>
      <footer className="footer small muted">
        Internal engineering prototype. Synthetic data only. Player status is reported by player
        software and is not proof of what a physical screen shows.
      </footer>
    </div>
  );
}

function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="content">
      <h1>{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p>
        {notFound
          ? 'There is no page at this address.'
          : 'This page failed to display. Reload the page; if it keeps happening, report it.'}
      </p>
      <p>
        <a className="button" href="/displays">
          Go to displays
        </a>
      </p>
    </main>
  );
}

function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p>There is no page at this address.</p>
      <p>
        <Link className="button" to="/displays">
          Go to displays
        </Link>
      </p>
    </>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/displays" replace /> },
      { path: 'displays', element: <DisplaysPage /> },
      { path: 'displays/new', element: <DisplayFormPage /> },
      { path: 'displays/:id', element: <DisplayDetailPage /> },
      { path: 'displays/:id/edit', element: <DisplayFormPage /> },
      { path: 'media', element: <MediaPage /> },
      { path: 'playlists', element: <PlaylistsPage /> },
      { path: 'playlists/:id', element: <PlaylistEditorPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

function Gate() {
  const { state, retry } = useSessionState();
  if (state.status === 'loading') {
    return (
      <main className="signin">
        <Loading label="Checking your session…" />
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="signin">
        <div className="signin-card">
          <p className="brand brand-large">TINNOX CMS</p>
          <ErrorNotice
            error={state.error}
            title="The session could not be checked"
            onRetry={retry}
          />
        </div>
      </main>
    );
  }
  if (state.status === 'anonymous') return <SignInScreen reason={state.reason} />;
  return (
    <AuthenticatedProvider session={state.session}>
      <RouterProvider router={router} />
    </AuthenticatedProvider>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
