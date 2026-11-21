import type { AuthErrorCode } from '@tinnox/contracts';
import { Component, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { authErrorMessage } from '../lib/authError.ts';
import { Banner, ButtonLink, ErrorNotice, Skeleton, SkeletonGroup, Spinner } from '../ui/index.ts';
import { HOME_PATH } from './nav.ts';
import { useDocumentTitle } from './useDocumentTitle.ts';
import { PROTOTYPE_NOTE, Wordmark } from './Wordmark.tsx';

/**
 * The screens shown without the application shell: sign-in, the session check and its
 * failure, and the route error page. Each is one centred white card on the page grey. They need no router except `RouteError`, which the
 * router itself renders.
 */

export interface SignInScreenProps {
  /** Why the person is not signed in: they signed out, the session ended, or neither. */
  readonly reason: 'signed_out' | 'ended' | 'none';
  /** Why the last sign-in failed, from `?authError=`; null when it did not. */
  readonly authError?: AuthErrorCode | null;
  /** The API address that starts sign-in. A full-page navigation, not an in-app route. */
  readonly loginHref: string;
}

export function SignInScreen({ reason, authError = null, loginHref }: SignInScreenProps) {
  useDocumentTitle('Sign in');
  return (
    <main className="tx-screen">
      <div className="tx-screen__card">
        <Wordmark size="lg" />
        <h1 className="tx-screen__title">Sign in to TINNOX CMS</h1>
        {reason === 'ended' && (
          <Banner tone="warn" live="polite">
            <p>Your session has ended. Sign in again to continue.</p>
          </Banner>
        )}
        {reason === 'signed_out' && (
          <Banner tone="info" live="polite">
            <p>You have signed out.</p>
          </Banner>
        )}
        <p className="tx-screen__text">
          Sign-in happens at your organisation&apos;s identity provider and needs your password and
          a one-time code from your authenticator app.
        </p>
        {authError !== null && (
          <Banner tone="danger" live="assertive">
            <p>{authErrorMessage(authError)}</p>
          </Banner>
        )}
        <ButtonLink
          variant="primary"
          size="lg"
          block
          href={loginHref}
          className="tx-screen__action"
        >
          Sign in
        </ButtonLink>
        <p className="tx-screen__note">{PROTOTYPE_NOTE}</p>
      </div>
    </main>
  );
}

/** While the portal asks the API whether there is a session. */
export function SessionCheckingScreen() {
  return <LoadingScreen label="Checking your session…" />;
}

/** While a page outside the shell loads its code; says nothing about a session. */
export function LoadingScreen({ label = 'Loading…' }: { readonly label?: string }) {
  return (
    <main className="tx-screen">
      <Spinner size="lg" label={label} />
    </main>
  );
}

/**
 * Around a page outside the router (which has `RouteError` for this): when its code cannot be
 * loaded or it throws, a card with a reload button instead of a blank page. A reload keeps the
 * address, fragment included.
 */
export class StandaloneErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly error: unknown }
> {
  override state: { readonly error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error: error ?? new Error('page failed') };
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <main className="tx-screen">
        <div className="tx-screen__card">
          <Wordmark size="lg" />
          <h1 className="tx-visually-hidden">TINNOX CMS</h1>
          <ErrorNotice
            error={this.state.error}
            title="This page could not be shown"
            onRetry={() => {
              window.location.reload();
            }}
          />
        </div>
      </main>
    );
  }
}

export function SessionErrorScreen({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  useDocumentTitle('Session check failed');
  return (
    <main className="tx-screen">
      <div className="tx-screen__card">
        <Wordmark size="lg" />
        <h1 className="tx-visually-hidden">TINNOX CMS</h1>
        <ErrorNotice error={error} title="The session could not be checked" onRetry={onRetry} />
      </div>
    </main>
  );
}

/**
 * Shown by the router in place of the whole application when a page throws while rendering
 * or its code cannot be loaded. The link is a full-page navigation, so it also recovers from
 * a state the running application cannot leave.
 */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const title = notFound ? 'Page not found' : 'Something went wrong';
  useDocumentTitle(title);
  return (
    <main className="tx-screen">
      <div className="tx-screen__card">
        <Wordmark size="lg" />
        <h1 className="tx-screen__title">{title}</h1>
        <p className="tx-screen__text">
          {notFound
            ? 'There is no page at this address.'
            : 'This page could not be shown. Reload the page; if it keeps happening, report it.'}
        </p>
        <ButtonLink variant="primary" size="lg" href={HOME_PATH} className="tx-screen__action">
          Go to dashboard
        </ButtonLink>
      </div>
    </main>
  );
}

/**
 * Inside the shell, in place of a page whose code is still loading on the first visit: an
 * empty header bar and a skeleton, so the frame does not jump when the page arrives.
 */
export function RouteLoading() {
  return (
    <>
      <div className="tx-page-header tx-glass">
        <div className="tx-page-header__inner">
          <Skeleton width="180px" height="28px" />
        </div>
      </div>
      <main id="main" className="tx-page-main" tabIndex={-1}>
        <SkeletonGroup label="Loading page" className="tx-stack">
          <Skeleton width="40%" height="20px" />
          <Skeleton variant="block" height="160px" />
          <Skeleton variant="block" height="160px" />
        </SkeletonGroup>
      </main>
    </>
  );
}
