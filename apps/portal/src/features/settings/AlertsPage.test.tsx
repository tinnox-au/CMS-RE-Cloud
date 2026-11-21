import type { AlertRecipientDto } from '@tinnox/contracts';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { ApiRequestError } from '../../api/client.ts';
import { WithSession } from '../../session/session.test-support.tsx';
import { ToastProvider } from '../../ui/index.ts';
import { AlertsPage } from './AlertsPage.tsx';

const { listAlertRecipients, addAlertRecipient, removeAlertRecipient } = vi.hoisted(() => ({
  listAlertRecipients: vi.fn<() => Promise<AlertRecipientDto[]>>(),
  addAlertRecipient: vi.fn<(email: string) => Promise<AlertRecipientDto>>(),
  removeAlertRecipient: vi.fn<(id: string) => Promise<void>>(),
}));
vi.mock('../../api/index.ts', () => ({
  api: { listAlertRecipients, addAlertRecipient, removeAlertRecipient },
}));
// The page frame needs the whole shell (SessionContext, push); the test reads the page body.
vi.mock('../../shell/Page.tsx', () => ({
  Page: ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

const T = '2026-11-14T03:00:00.000Z';
const CONFIRMED: AlertRecipientDto = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ops@example.com',
  status: 'confirmed',
  createdAt: T,
};
const EXPIRED: AlertRecipientDto = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'old@example.com',
  status: 'expired',
  createdAt: T,
};
const WAITING: AlertRecipientDto = {
  id: '00000000-0000-4000-8000-000000000003',
  email: 'new@example.com',
  status: 'waiting',
  createdAt: T,
};

async function renderPage(items: AlertRecipientDto[]) {
  listAlertRecipients.mockResolvedValue(items);
  const screen = await render(
    <WithSession role="admin">
      <ToastProvider>
        <MemoryRouter initialEntries={['/settings/alerts']}>
          <AlertsPage />
        </MemoryRouter>
      </ToastProvider>
    </WithSession>,
  );
  return screen;
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('AlertsPage', () => {
  it('lists each address with its status', async () => {
    const screen = await renderPage([CONFIRMED, EXPIRED]);
    const confirmed = screen.getByTestId(`settings-alerts-row-${CONFIRMED.id}`);
    await expect.element(confirmed.getByTitle('ops@example.com')).toBeVisible();
    await expect.element(confirmed.getByText('Confirmed')).toBeVisible();
    await expect
      .element(
        screen
          .getByTestId(`settings-alerts-row-${EXPIRED.id}`)
          .getByText('Expired: remove and add again'),
      )
      .toBeVisible();
    await expect.element(screen.getByText('2 of 20 addresses')).toBeVisible();
  });

  it('adds an address, showing a duplicate at the field', async () => {
    const screen = await renderPage([]);
    await screen.getByTestId('settings-alerts-add').click();
    const email = screen.getByTestId('settings-alerts-add-email');

    // Nothing typed: refused here, nothing sent.
    await screen.getByTestId('settings-alerts-add-submit').click();
    await expect.element(screen.getByText('Enter an e-mail address.')).toBeVisible();
    expect(addAlertRecipient).not.toHaveBeenCalled();

    addAlertRecipient.mockRejectedValueOnce(
      new ApiRequestError({
        status: 409,
        code: 'conflict',
        message: 'This address is already on the alert list.',
        details: [{ path: 'email', message: 'This address is already on the alert list.' }],
        fromApi: true,
      }),
    );
    await email.fill('ops@example.com');
    await screen.getByTestId('settings-alerts-add-submit').click();
    await expect
      .element(screen.getByText('This address is already on the alert list.'))
      .toBeVisible();
    await expect.element(email).toHaveAttribute('aria-invalid', 'true');

    addAlertRecipient.mockResolvedValueOnce(WAITING);
    listAlertRecipients.mockResolvedValue([WAITING]);
    await email.fill(' New@example.com ');
    await screen.getByTestId('settings-alerts-add-submit').click();
    expect(addAlertRecipient).toHaveBeenLastCalledWith('New@example.com');
    await expect
      .element(
        screen
          .getByTestId(`settings-alerts-row-${WAITING.id}`)
          .getByText('Waiting for confirmation'),
      )
      .toBeVisible();
    // The stack is a popover under the closing dialog: read its text, as UsersPage.test.tsx.
    await expect
      .poll(() => document.querySelector('[aria-label="Notifications"]')?.textContent ?? '')
      .toContain('Confirmation e-mail sent to new@example.com');
  });

  it('removes an address after asking', async () => {
    removeAlertRecipient.mockResolvedValue();
    const screen = await renderPage([CONFIRMED]);
    await screen.getByRole('button', { name: 'Remove ops@example.com' }).click();
    const dialog = screen.getByTestId('settings-alerts-remove-dialog');
    await expect
      .element(dialog.getByText('will receive no more screen alerts', { exact: false }))
      .toBeVisible();
    expect(removeAlertRecipient).not.toHaveBeenCalled();

    listAlertRecipients.mockResolvedValue([]);
    await screen.getByTestId('settings-alerts-remove-dialog-confirm').click();
    expect(removeAlertRecipient).toHaveBeenCalledWith(CONFIRMED.id);
    await expect.element(screen.getByText('No alert addresses yet')).toBeVisible();
  });

  it('puts focus on the next address after a removal, else the previous one, else Add address', async () => {
    removeAlertRecipient.mockResolvedValue();
    const screen = await renderPage([CONFIRMED, EXPIRED, WAITING]);
    const dialog = screen.getByTestId('settings-alerts-remove-dialog');
    const remove = async (who: AlertRecipientDto, after: AlertRecipientDto[]) => {
      await screen.getByRole('button', { name: `Remove ${who.email}` }).click();
      listAlertRecipients.mockResolvedValue(after);
      await screen.getByTestId('settings-alerts-remove-dialog-confirm').click();
      await expect.element(dialog).not.toBeVisible();
    };
    await remove(EXPIRED, [CONFIRMED, WAITING]);
    await expect
      .element(screen.getByRole('button', { name: 'Remove new@example.com' }))
      .toHaveFocus();
    await remove(WAITING, [CONFIRMED]);
    await expect
      .element(screen.getByRole('button', { name: 'Remove ops@example.com' }))
      .toHaveFocus();
    await remove(CONFIRMED, []);
    await expect.element(screen.getByTestId('settings-alerts-add')).toHaveFocus();
  });

  it('says what each 503 means: nothing added, or added without its link', async () => {
    const screen = await renderPage([]);
    await screen.getByTestId('settings-alerts-add').click();
    const email = screen.getByTestId('settings-alerts-add-email');
    const submit = screen.getByTestId('settings-alerts-add-submit');

    // A name form the mailer would deliver elsewhere is refused here.
    await email.fill('ops<v@example.com>');
    await submit.click();
    await expect.element(email).toHaveAttribute('aria-invalid', 'true');
    expect(addAlertRecipient).not.toHaveBeenCalled();

    addAlertRecipient.mockRejectedValueOnce(
      new ApiRequestError({
        status: 503,
        code: 'mail_not_configured',
        message: 'E-mail is not set up on this server yet, so alert addresses cannot be added.',
        fromApi: true,
      }),
    );
    await email.fill('ops@example.com');
    await submit.click();
    await expect.element(screen.getByText('The address was not added')).toBeVisible();
    expect(listAlertRecipients).toHaveBeenCalledTimes(1);

    addAlertRecipient.mockRejectedValueOnce(
      new ApiRequestError({
        status: 503,
        code: 'confirmation_not_sent',
        message: 'The address was added, but the confirmation e-mail could not be sent.',
        fromApi: true,
      }),
    );
    listAlertRecipients.mockResolvedValue([WAITING]);
    await email.fill('New@example.com');
    await submit.click();
    await expect.element(screen.getByTestId('settings-alerts-add-dialog')).not.toBeVisible();
    await expect
      .element(
        screen
          .getByTestId(`settings-alerts-row-${WAITING.id}`)
          .getByText('Waiting for confirmation'),
      )
      .toBeVisible();
    await expect
      .poll(() => document.querySelector('[aria-label="Notifications"]')?.textContent ?? '')
      .toContain('new@example.com was added, but its confirmation e-mail was not sent');
  });

  it('closes with a note when the address was already removed', async () => {
    removeAlertRecipient.mockRejectedValue(
      new ApiRequestError({
        status: 404,
        code: 'not_found',
        message: 'The address was not found.',
        fromApi: true,
      }),
    );
    const screen = await renderPage([CONFIRMED]);
    await screen.getByRole('button', { name: 'Remove ops@example.com' }).click();
    listAlertRecipients.mockResolvedValue([]);
    await screen.getByTestId('settings-alerts-remove-dialog-confirm').click();
    await expect.element(screen.getByText('No alert addresses yet')).toBeVisible();
    await expect.element(screen.getByTestId('settings-alerts-remove-dialog')).not.toBeVisible();
    await expect
      .poll(() => document.querySelector('[aria-label="Notifications"]')?.textContent ?? '')
      .toContain('ops@example.com was already removed');
  });
});
