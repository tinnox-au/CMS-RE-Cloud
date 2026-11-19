import type { SessionResponse } from '@tinnox/contracts';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { ApiRequestError } from '../api/client.ts';
import { SESSION_REFRESH_MIN_MS, SessionProvider, useSessionState } from './SessionContext.tsx';
import { sessionFor } from './session.test-support.tsx';

const { loadSession, clearSession, forbiddenListeners, sessionChangedListeners } = vi.hoisted(
  () => ({
    loadSession: vi.fn<(signal: AbortSignal) => Promise<SessionResponse>>(),
    clearSession: vi.fn(),
    forbiddenListeners: new Set<() => void>(),
    sessionChangedListeners: new Set<() => void>(),
  }),
);
vi.mock('../api/index.ts', () => ({
  api: { logout: vi.fn() },
  apiClient: { loadSession, clearSession },
  onUnauthenticated: () => () => undefined,
  onForbidden: (listener: () => void) => {
    forbiddenListeners.add(listener);
    return () => {
      forbiddenListeners.delete(listener);
    };
  },
  onSessionChanged: (listener: () => void) => {
    sessionChangedListeners.add(listener);
    return () => {
      sessionChangedListeners.delete(listener);
    };
  },
}));

/** What the API client does after a 403 `forbidden`. */
function notifyForbidden() {
  for (const listener of forbiddenListeners) listener();
}

/** What the API client does when a request met another member's session. */
function notifySessionChanged() {
  for (const listener of sessionChangedListeners) listener();
}

function Probe() {
  const { state } = useSessionState();
  return (
    <p data-testid="probe">
      {state.status === 'anonymous' ? `anonymous:${state.reason}` : state.status}
    </p>
  );
}

function renderProvider() {
  return render(
    <StrictMode>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </StrictMode>,
  );
}

/** Where the test runner's page was before each test, restored afterwards. */
let original = '';

function address(search: string, hash = ''): string {
  return `${window.location.pathname}${search}${hash}`;
}

describe('SessionProvider after the identity-provider sign-out round trip', () => {
  beforeEach(() => {
    original = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    loadSession.mockReset();
  });

  afterEach(() => {
    window.history.replaceState(window.history.state, '', original);
  });

  it('shows the signed-out reason and removes only state=signed_out from the address', async () => {
    window.history.replaceState(null, '', address('?keep=1&state=signed_out', '#top'));
    loadSession.mockResolvedValue({ authenticated: false });
    const screen = await renderProvider();
    await expect.element(screen.getByTestId('probe')).toHaveTextContent('anonymous:signed_out');
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#top');
  });

  it('keeps reason none without the marker', async () => {
    window.history.replaceState(null, '', address('?keep=1'));
    loadSession.mockResolvedValue({ authenticated: false });
    const screen = await renderProvider();
    await expect.element(screen.getByTestId('probe')).toHaveTextContent('anonymous:none');
    expect(window.location.search).toBe('?keep=1');
  });

  it('ignores any other state value, such as a sign-in callback state', async () => {
    window.history.replaceState(null, '', address('?state=abc123&code=xyz'));
    loadSession.mockResolvedValue({ authenticated: false });
    const screen = await renderProvider();
    await expect.element(screen.getByTestId('probe')).toHaveTextContent('anonymous:none');
    expect(window.location.search).toBe('?state=abc123&code=xyz');
  });

  it('drops the marker when the session turns out authenticated', async () => {
    window.history.replaceState(null, '', address('?state=signed_out'));
    loadSession.mockResolvedValue({ authenticated: true } as SessionResponse);
    const screen = await renderProvider();
    await expect.element(screen.getByTestId('probe')).toHaveTextContent('authenticated');
    expect(window.location.search).toBe('');
  });
});

describe('SessionProvider after ?authError=', () => {
  beforeEach(() => {
    original = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    loadSession.mockReset();
  });

  afterEach(() => {
    window.history.replaceState(window.history.state, '', original);
  });

  it('keeps the sign-in failure for the sign-in screen and removes it from the address', async () => {
    window.history.replaceState(null, '', address('?keep=1&authError=no_membership'));
    loadSession.mockResolvedValue({ authenticated: false });
    const screen = await render(
      <SessionProvider>
        <AuthErrorProbe />
      </SessionProvider>,
    );
    await expect.element(screen.getByTestId('auth-error')).toHaveTextContent('no_membership');
    expect(window.location.search).toBe('?keep=1');
  });
});

function AuthErrorProbe() {
  const { state } = useSessionState();
  return (
    <p data-testid="auth-error">
      {state.status === 'anonymous' ? (state.authError ?? 'none') : state.status}
    </p>
  );
}

/** How often the signed-in part of the tree was mounted; a silent refresh keeps it at 1. */
let mounts = 0;

function Member() {
  const { state } = useSessionState();
  useEffect(() => {
    mounts += 1;
  }, []);
  return (
    <p data-testid="member">
      {state.status === 'authenticated'
        ? `${state.session.user.role}:${state.session.user.membershipId}`
        : ''}
    </p>
  );
}

/** As App.tsx's Gate: the signed-in part only while authenticated. */
function Gate() {
  const { state } = useSessionState();
  if (state.status === 'authenticated') return <Member />;
  return (
    <p data-testid="probe">
      {state.status === 'anonymous' ? `anonymous:${state.reason}` : state.status}
    </p>
  );
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const EDITOR = sessionFor('editor');
const VIEWER = sessionFor('viewer');
const OTHER_MEMBER = sessionFor('editor', {
  user: { ...EDITOR.user, membershipId: '77777777-7777-4777-8777-777777777777' },
});
const START = new Date('2026-11-20T09:00:00.000Z');

/** Lets a refresh that has its answer finish: a trigger during a refresh joins it instead. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('SessionProvider: the silent refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    loadSession.mockReset();
    clearSession.mockReset();
    mounts = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Signed in as an Editor; later loads answer `next` in turn. */
  async function signedIn(...next: (() => Promise<SessionResponse>)[]) {
    loadSession.mockResolvedValueOnce(EDITOR);
    for (const answer of next) loadSession.mockImplementationOnce(answer);
    const screen = await render(
      <SessionProvider>
        <Gate />
      </SessionProvider>,
    );
    await expect.element(screen.getByTestId('member')).toMatchTextContent(/^editor:/);
    return screen;
  }

  it('reloads the session on a refusal by role without unmounting the signed-in tree', async () => {
    const screen = await signedIn(() => Promise.resolve(VIEWER));
    notifyForbidden();
    await expect.element(screen.getByTestId('member')).toMatchTextContent(/^viewer:/);
    expect(loadSession).toHaveBeenCalledTimes(2);
    expect(mounts).toBe(1);
  });

  it('refreshes on focus at most every 10 seconds, but always after a refusal', async () => {
    const screen = await signedIn(
      () => Promise.resolve(EDITOR),
      () => Promise.resolve(VIEWER),
    );
    // Within 10 s of the first load: nothing.
    window.dispatchEvent(new Event('focus'));
    expect(loadSession).toHaveBeenCalledTimes(1);

    vi.setSystemTime(START.getTime() + SESSION_REFRESH_MIN_MS + 1_000);
    window.dispatchEvent(new Event('focus'));
    expect(loadSession).toHaveBeenCalledTimes(2);
    await settle();

    // A focus 4 s after that refresh does nothing; a refusal does.
    vi.setSystemTime(START.getTime() + SESSION_REFRESH_MIN_MS + 5_000);
    window.dispatchEvent(new Event('focus'));
    expect(loadSession).toHaveBeenCalledTimes(2);
    notifyForbidden();
    await expect.element(screen.getByTestId('member')).toMatchTextContent(/^viewer:/);
    expect(loadSession).toHaveBeenCalledTimes(3);
    expect(mounts).toBe(1);
  });

  it('loads the session once for several refusals during one refresh', async () => {
    const pending = deferred<SessionResponse>();
    const screen = await signedIn(() => pending.promise);
    notifyForbidden();
    notifyForbidden();
    notifyForbidden();
    expect(loadSession).toHaveBeenCalledTimes(2);
    pending.resolve(VIEWER);
    await expect.element(screen.getByTestId('member')).toMatchTextContent(/^viewer:/);
    expect(loadSession).toHaveBeenCalledTimes(2);
  });

  it('keeps the session after a network failure or an unreadable answer', async () => {
    const network = new ApiRequestError({
      status: 0,
      code: 'network_error',
      message: 'The server could not be reached.',
      fromApi: false,
    });
    const unreadable = new ApiRequestError({
      status: 200,
      code: 'invalid_response',
      message: 'Unreadable.',
      fromApi: false,
    });
    const screen = await signedIn(
      () => Promise.reject(network),
      () => Promise.reject(unreadable),
    );
    notifyForbidden();
    expect(loadSession).toHaveBeenCalledTimes(2);
    await settle();
    notifyForbidden();
    expect(loadSession).toHaveBeenCalledTimes(3);
    await settle();
    await expect.element(screen.getByTestId('member')).toMatchTextContent(/^editor:/);
    expect(mounts).toBe(1);
  });

  it('starts again when another member signed in meanwhile (another tab)', async () => {
    const screen = await signedIn(
      () => Promise.resolve(OTHER_MEMBER),
      () => Promise.resolve(OTHER_MEMBER),
    );
    notifyForbidden();
    await expect
      .element(screen.getByTestId('member'))
      .toHaveTextContent(`editor:${OTHER_MEMBER.user.membershipId}`);
    // retry(): the session check ran again and the signed-in tree was mounted afresh.
    expect(loadSession).toHaveBeenCalledTimes(3);
    expect(mounts).toBe(2);
    // The new member's token was dropped before the old member's tree went away.
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('starts again when the API client says a request met another member', async () => {
    const screen = await signedIn(
      () => Promise.resolve(OTHER_MEMBER),
      () => Promise.resolve(OTHER_MEMBER),
    );
    notifySessionChanged();
    await expect
      .element(screen.getByTestId('member'))
      .toHaveTextContent(`editor:${OTHER_MEMBER.user.membershipId}`);
    expect(loadSession).toHaveBeenCalledTimes(3);
    expect(mounts).toBe(2);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('says the session has ended when the answer is unauthenticated', async () => {
    const screen = await signedIn(() => Promise.resolve({ authenticated: false }));
    notifyForbidden();
    await expect.element(screen.getByTestId('probe')).toHaveTextContent('anonymous:ended');
  });
});
