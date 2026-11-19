import type { SessionResponse } from '@tinnox/contracts';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { SessionProvider, useSessionState } from './SessionContext.tsx';

const { loadSession } = vi.hoisted(() => ({
  loadSession: vi.fn<(signal: AbortSignal) => Promise<SessionResponse>>(),
}));
vi.mock('../api/index.ts', () => ({
  api: { logout: vi.fn() },
  apiClient: { loadSession, clearSession: vi.fn() },
  onUnauthenticated: () => () => undefined,
}));

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
