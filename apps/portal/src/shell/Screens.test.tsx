import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { LoadingScreen, StandaloneErrorBoundary } from './Screens.tsx';

function Broken(): never {
  throw new TypeError('Failed to fetch dynamically imported module');
}

describe('screens outside the shell', () => {
  it('loads without talking about a session', async () => {
    const screen = await render(<LoadingScreen />);
    await expect.element(screen.getByText('Loading…')).toBeInTheDocument();
    await expect.element(screen.getByText('Checking your session…')).not.toBeInTheDocument();
  });

  it('shows a card with a reload button, not a blank page, when the page fails', async () => {
    // React reports the caught error on the console; that is expected here.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const screen = await render(
        <StandaloneErrorBoundary>
          <Broken />
        </StandaloneErrorBoundary>,
      );
      await expect.element(screen.getByText('This page could not be shown')).toBeVisible();
      await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    } finally {
      quiet.mockRestore();
    }
  });
});
