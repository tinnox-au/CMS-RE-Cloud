import type { Role } from '@tinnox/contracts';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { PushContext, type PushContextValue } from '../features/push/PushContext.tsx';
import { WithSession } from '../session/session.test-support.tsx';
import { PushButton } from './PushButton.tsx';

function push(pendingCount: number | null): PushContextValue {
  return {
    plan: null,
    planError: null,
    pendingCount,
    refresh: () => undefined,
    openDialog: vi.fn(),
    openPush: vi.fn(),
    refreshPending: () => undefined,
  };
}

function renderAs(role: Role, value: PushContextValue) {
  return render(
    <MemoryRouter>
      <WithSession role={role}>
        <PushContext value={value}>
          <PushButton />
        </PushContext>
      </WithSession>
    </MemoryRouter>,
  );
}

describe('PushButton', () => {
  it('shows a Viewer how many screens wait, as a link to the dashboard', async () => {
    const screen = await renderAs('viewer', push(3));
    const chip = screen.getByRole('link', { name: '3 screens waiting' });
    await expect.element(chip).toBeVisible();
    expect(chip.element().getAttribute('href')).toBe('/dashboard');
    expect(screen.getByRole('button').query()).toBeNull();
  });

  it('says "1 screen waiting" for one screen', async () => {
    const screen = await renderAs('viewer', push(1));
    await expect.element(screen.getByRole('link', { name: '1 screen waiting' })).toBeVisible();
  });

  it('shows a Viewer nothing while no screen waits or the count is unknown', async () => {
    for (const count of [0, null]) {
      const screen = await renderAs('viewer', push(count));
      expect(screen.container.textContent).toBe('');
      await screen.unmount();
    }
  });

  it('gives an Editor the push button, which opens the dialog', async () => {
    const value = push(3);
    const screen = await renderAs('editor', value);
    const button = screen.getByRole('button', { name: /Push to screens/ });
    await expect.element(button).toBeVisible();
    await expect.element(button).toHaveAccessibleName(/3 screens have changes waiting/);
    expect(screen.getByRole('link').query()).toBeNull();
    await button.click();
    expect(value.openPush).toHaveBeenCalledTimes(1);
  });
});
