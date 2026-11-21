import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { ApiRequestError } from '../../api/client.ts';
import { AlertConfirmPage } from './AlertConfirmPage.tsx';

const { confirmAlertRecipient } = vi.hoisted(() => ({
  confirmAlertRecipient: vi.fn<(token: string) => Promise<void>>(),
}));
vi.mock('../../api/index.ts', () => ({ api: { confirmAlertRecipient } }));

const TOKEN = 'a'.repeat(43);
let before = '';

beforeEach(() => {
  before = window.location.href;
});

afterEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, '', before);
});

function at(fragment: string) {
  window.history.replaceState(null, '', `${window.location.pathname}${fragment}`);
}

describe('AlertConfirmPage', () => {
  it('posts the token from the fragment once, clears the fragment and says it worked', async () => {
    confirmAlertRecipient.mockResolvedValue();
    at(`#${TOKEN}`);
    const screen = await render(<AlertConfirmPage />);
    await expect.element(screen.getByText('Alerts confirmed')).toBeVisible();
    expect(confirmAlertRecipient).toHaveBeenCalledTimes(1);
    expect(confirmAlertRecipient).toHaveBeenCalledWith(TOKEN);
    expect(window.location.hash).toBe('');
  });

  it('says a used, expired or unknown link is not valid any more', async () => {
    confirmAlertRecipient.mockRejectedValue(
      new ApiRequestError({
        status: 404,
        code: 'not_found',
        message: 'This link is not valid any more.',
        fromApi: true,
      }),
    );
    at(`#${TOKEN}`);
    const screen = await render(<AlertConfirmPage />);
    await expect.element(screen.getByText('This link is not valid any more')).toBeVisible();
  });

  it('sends nothing without a token', async () => {
    at('');
    const screen = await render(<AlertConfirmPage />);
    await expect.element(screen.getByText('This link is not valid any more')).toBeVisible();
    expect(confirmAlertRecipient).not.toHaveBeenCalled();
  });

  it('keeps the token to try again after a failure', async () => {
    confirmAlertRecipient.mockRejectedValueOnce(
      new ApiRequestError({
        status: 0,
        code: 'network_error',
        message: 'The server could not be reached.',
        fromApi: false,
      }),
    );
    confirmAlertRecipient.mockResolvedValueOnce();
    at(`#${TOKEN}`);
    const screen = await render(<AlertConfirmPage />);
    await screen.getByRole('button', { name: 'Try again' }).click();
    await expect.element(screen.getByText('Alerts confirmed')).toBeVisible();
    expect(confirmAlertRecipient).toHaveBeenLastCalledWith(TOKEN);
  });
});
