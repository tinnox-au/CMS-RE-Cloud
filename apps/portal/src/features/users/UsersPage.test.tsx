import type { InviteDto, MemberChangeResponse, MemberDto, Role } from '@tinnox/contracts';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { ApiRequestError } from '../../api/client.ts';
import { TEST_MEMBERSHIP_ID, WithSession } from '../../session/session.test-support.tsx';
import { ToastProvider } from '../../ui/index.ts';
import { UsersPage } from './UsersPage.tsx';

const { listMembers, listInvites, removeMember, patchMember, signOutMember, cancelInvite } =
  vi.hoisted(() => ({
    listMembers: vi.fn<() => Promise<MemberDto[]>>(),
    listInvites: vi.fn<() => Promise<InviteDto[]>>(),
    removeMember: vi.fn<(id: string) => Promise<MemberChangeResponse>>(),
    patchMember: vi.fn<(id: string, patch: unknown) => Promise<MemberChangeResponse>>(),
    signOutMember: vi.fn<(id: string) => Promise<{ sessionsEnded: number }>>(),
    cancelInvite: vi.fn<(id: string) => Promise<void>>(),
  }));
vi.mock('../../api/index.ts', () => ({
  api: { listMembers, listInvites, removeMember, patchMember, signOutMember, cancelInvite },
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

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-11-14T03:00:00.000Z';

function member(
  id: string,
  displayName: string,
  role: Role,
  change: Partial<MemberDto> = {},
): MemberDto {
  return { id, displayName, role, firstSignedInAt: T, removedAt: null, ...change };
}

const OWNER = member(ID(1), 'Olive Owner', 'owner');
const ADMIN = member(ID(2), 'Ada Admin', 'admin');
const EDITOR = member(ID(3), 'Eddie Editor', 'editor');
const NEWCOMER = member(ID(4), 'Nina New', 'viewer', { firstSignedInAt: null });

/** The signed-in member is "Test person" (session.test-support.tsx) with the role of the test. */
function people(selfRole: Role): MemberDto[] {
  return [member(TEST_MEMBERSHIP_ID, 'Test person', selfRole), OWNER, ADMIN, EDITOR, NEWCOMER];
}

const EDITOR_INVITE: InviteDto = {
  id: '3f9a12c4-0000-4000-8000-000000000010',
  name: 'Ivy Invited',
  email: 'ivy@example.com',
  role: 'editor',
  invitedBy: TEST_MEMBERSHIP_ID,
  createdAt: T,
  // Far ahead, so the invite is still waiting whenever the test runs.
  expiresAt: '2099-01-01T00:00:00.000Z',
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function renderAs(role: Role, extra: readonly MemberDto[] = []) {
  listMembers.mockResolvedValue([...people(role), ...extra]);
  listInvites.mockResolvedValue([EDITOR_INVITE]);
  const screen = await render(
    <WithSession role={role}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/users']}>
          <UsersPage />
        </MemoryRouter>
      </ToastProvider>
    </WithSession>,
  );
  // Both lists have loaded once a person's row and the invite's row are there.
  await expect.element(screen.getByTestId(`users-row-${EDITOR.id}`)).toBeVisible();
  await expect.element(screen.getByTestId(`users-invite-row-${EDITOR_INVITE.id}`)).toBeVisible();
  return screen;
}

type Screen = Awaited<ReturnType<typeof renderAs>>;

function actionsFor(screen: Screen, who: MemberDto) {
  return screen.getByTestId(`users-row-${who.id}`).getByRole('button', {
    name: `Actions for ${who.displayName ?? `Unnamed person ${who.id.slice(0, 8).toUpperCase()}`}`,
  });
}

/** The toasts shown so far; the stack is a closed popover, out of the accessibility tree, until the first. */
function toastText(): string {
  return document.querySelector('[role="region"][aria-label="Notifications"]')?.textContent ?? '';
}

async function openAction(screen: Screen, who: MemberDto, item: string) {
  await actionsFor(screen, who).click();
  await screen.getByRole('menuitem', { name: item }).click();
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('UsersPage: as an Admin', () => {
  it('offers no actions on Owners and Admins, and no Admin role in the invite dialog', async () => {
    const screen = await renderAs('admin');

    await expect.element(actionsFor(screen, EDITOR)).toBeVisible();
    await expect.element(actionsFor(screen, NEWCOMER)).toBeVisible();
    await expect.element(actionsFor(screen, OWNER)).not.toBeInTheDocument();
    await expect.element(actionsFor(screen, ADMIN)).not.toBeInTheDocument();
    // The protected rows say why, to a screen reader.
    expect(screen.getByTestId(`users-row-${OWNER.id}`).element().textContent).toContain(
      'Managed by an Owner',
    );
    await expect
      .element(screen.getByText('Only an Owner can change or remove Admins and Owners.'))
      .toBeVisible();

    await screen.getByTestId('users-invite').click();
    const dialog = screen.getByTestId('users-invite-dialog');
    await expect.element(dialog.getByTestId('users-invite-role-viewer')).toBeVisible();
    await expect.element(dialog.getByTestId('users-invite-role-editor')).toBeVisible();
    await expect.element(dialog.getByTestId('users-invite-role-admin')).not.toBeInTheDocument();
    await expect.element(dialog.getByTestId('users-invite-role-owner')).not.toBeInTheDocument();
    await expect.element(dialog.getByRole('radio', { name: /^Viewer/ })).toBeChecked();
  });

  it('asks before cancelling an invite, with "Keep invite" as the way out', async () => {
    const screen = await renderAs('admin');
    await screen
      .getByTestId(`users-invite-row-${EDITOR_INVITE.id}`)
      .getByTestId('users-invite-row-cancel')
      .click();

    const dialog = screen.getByTestId('users-invite-cancel-dialog');
    await expect
      .element(dialog.getByRole('heading', { name: 'Cancel the invite for Ivy Invited?' }))
      .toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Keep invite' })).toHaveFocus();
    await expect.element(dialog.getByRole('button', { name: 'Cancel invite' })).toBeVisible();
    expect(cancelInvite).not.toHaveBeenCalled();
  });
});

describe('UsersPage: as an Owner', () => {
  it('offers nothing on the own row', async () => {
    const screen = await renderAs('owner');
    const own = screen.getByTestId(`users-row-${TEST_MEMBERSHIP_ID}`);
    await expect.element(own.getByText('You')).toBeVisible();
    await expect.element(own.getByRole('button')).not.toBeInTheDocument();
    expect(own.element().textContent).not.toContain('Managed by an Owner');
    // Everyone else is the Owner's to manage.
    await expect.element(actionsFor(screen, OWNER)).toBeVisible();
    await expect.element(actionsFor(screen, ADMIN)).toBeVisible();
  });

  it('keeps Owner disabled, with its reason, for someone who never signed in', async () => {
    const screen = await renderAs('owner');
    await openAction(screen, NEWCOMER, 'Change role');

    const dialog = screen.getByTestId('users-role-dialog');
    await expect
      .element(dialog.getByRole('heading', { name: 'Change role for Nina New' }))
      .toBeVisible();
    const owner = dialog.getByRole('radio', { name: /^Owner/ });
    await expect.element(owner).toBeDisabled();
    // The reason is read once, after the role's line, and is not part of the name.
    await expect.element(owner).toHaveAccessibleName('Owner');
    await expect
      .element(owner)
      .toHaveAccessibleDescription(/Available after their first sign-in\.$/);
    await expect.element(dialog.getByRole('radio', { name: /^Admin/ })).toBeEnabled();
    await expect.element(dialog.getByRole('radio', { name: /^Viewer/ })).toBeChecked();
  });

  it('opens Change role on the current role, so one key press does not pick another', async () => {
    const screen = await renderAs('owner');
    await openAction(screen, EDITOR, 'Change role');

    const dialog = screen.getByTestId('users-role-dialog');
    const editor = dialog.getByRole('radio', { name: /^Editor/ });
    await expect.element(editor).toHaveFocus();
    await expect.element(editor).toBeChecked();
    await expect.element(editor).toHaveAccessibleName('Editor Current');
  });

  it('keeps a last-Owner refusal in the role dialog as an alert', async () => {
    patchMember.mockRejectedValue(
      new ApiRequestError({
        status: 409,
        code: 'last_owner',
        message: 'An organisation always keeps at least one Owner.',
        fromApi: true,
      }),
    );
    const screen = await renderAs('owner');
    await openAction(screen, OWNER, 'Change role');

    const dialog = screen.getByTestId('users-role-dialog');
    await dialog.getByTestId('users-role-admin').click();
    await dialog.getByTestId('users-role-save').click();

    expect(patchMember).toHaveBeenCalledWith(OWNER.id, { role: 'admin' });
    await expect
      .element(dialog.getByRole('alert'))
      .toMatchTextContent(
        /An organisation always keeps at least one Owner\. Make someone else an Owner first\./,
      );
    await expect.element(dialog).toBeVisible();
    expect(toastText()).toBe('');
  });

  it('removes a person only after asking, and says so once the server agreed', async () => {
    const answer = deferred<MemberChangeResponse>();
    removeMember.mockReturnValue(answer.promise);
    const screen = await renderAs('owner');
    await openAction(screen, EDITOR, 'Remove');

    const dialog = screen.getByTestId('users-remove-dialog');
    await expect
      .element(dialog.getByRole('heading', { name: 'Remove Eddie Editor?' }))
      .toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await expect
      .element(dialog.getByTestId('users-remove-consequence'))
      .toMatchTextContent(
        /^Eddie Editor is signed out now and can no longer use TINNOX CMS for Test organisation\. Their content and the activity history stay\./,
      );
    expect(removeMember).not.toHaveBeenCalled();

    await dialog.getByRole('button', { name: 'Remove person' }).click();
    expect(removeMember).toHaveBeenCalledTimes(1);
    expect(removeMember).toHaveBeenCalledWith(EDITOR.id);
    expect(toastText()).toBe('');

    answer.resolve({
      member: { ...EDITOR, removedAt: T },
      sessionsEnded: 2,
      invitesCancelled: 0,
    });
    const toasts = screen.getByRole('region', { name: 'Notifications' });
    await expect.element(toasts.getByText('2 sessions ended')).toBeVisible();
    expect(toastText()).toContain('Eddie Editor removed');
    await expect.element(dialog).not.toBeVisible();
  });

  it('does not claim a removal failed when the answer was lost, and reads the lists again', async () => {
    removeMember.mockRejectedValue(
      new ApiRequestError({
        status: 0,
        code: 'network_error',
        message: 'The server could not be reached.',
        fromApi: false,
      }),
    );
    const screen = await renderAs('owner');
    const reads = listMembers.mock.calls.length;
    await openAction(screen, EDITOR, 'Remove');

    const dialog = screen.getByTestId('users-remove-dialog');
    await dialog.getByRole('button', { name: 'Remove person' }).click();
    const alert = dialog.getByRole('alert');
    await expect.element(alert).toMatchTextContent(/The removal could not be confirmed/);
    await expect
      .element(alert)
      .toMatchTextContent(/The server may or may not have removed Eddie Editor\./);
    expect(alert.element().textContent).not.toContain('was not removed');
    await expect.poll(() => listMembers.mock.calls.length).toBeGreaterThan(reads);
    expect(toastText()).toBe('');
  });

  it('does not claim a role, name or sign-out change failed when the answer was lost', async () => {
    const lost = () =>
      new ApiRequestError({
        status: 0,
        code: 'network_error',
        message: 'The server could not be reached.',
        fromApi: false,
      });
    patchMember.mockRejectedValue(lost());
    signOutMember.mockRejectedValue(lost());
    const screen = await renderAs('owner');

    const cases = [
      {
        item: 'Change role',
        dialog: 'users-role-dialog',
        act: async (dialog: ReturnType<Screen['getByTestId']>) => {
          await dialog.getByTestId('users-role-viewer').click();
          await dialog.getByTestId('users-role-save').click();
        },
        title: /The role change could not be confirmed/,
        said: /The server may or may not have made Ada Admin a Viewer\./,
        never: 'was not changed',
      },
      {
        item: 'Correct name',
        dialog: 'users-name-dialog',
        act: async (dialog: ReturnType<Screen['getByTestId']>) => {
          await dialog.getByTestId('users-name-input').fill('Ada Lovelace');
          await dialog.getByTestId('users-name-save').click();
        },
        title: /The name change could not be confirmed/,
        said: /The server may or may not have changed the name to “Ada Lovelace”\./,
        never: 'was not changed',
      },
      {
        item: 'Sign out everywhere',
        dialog: 'users-sign-out-dialog',
        act: async (dialog: ReturnType<Screen['getByTestId']>) => {
          await dialog.getByRole('button', { name: 'Sign out everywhere' }).click();
        },
        title: /The sign-out could not be confirmed/,
        said: /The server may or may not have signed Ada Admin out\./,
        never: 'was not signed out',
      },
    ];
    for (const step of cases) {
      const reads = listMembers.mock.calls.length;
      await openAction(screen, ADMIN, step.item);
      const dialog = screen.getByTestId(step.dialog);
      await step.act(dialog);
      const alert = dialog.getByRole('alert');
      await expect.element(alert).toMatchTextContent(step.title);
      await expect.element(alert).toMatchTextContent(step.said);
      expect(alert.element().textContent).not.toContain(step.never);
      // The lists were read again, so the table shows what the server did.
      await expect.poll(() => listMembers.mock.calls.length).toBeGreaterThan(reads);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect.element(dialog).not.toBeVisible();
    }
    expect(toastText()).toBe('');
  });

  it('tells unnamed people apart in their rows, menus and the Remove confirm', async () => {
    const first = member('3f9a12c4-0000-4000-8000-000000000021', '', 'owner', {
      displayName: null,
      firstSignedInAt: null,
    });
    const second = member('7c01d2e9-0000-4000-8000-000000000022', '', 'owner', {
      displayName: null,
      firstSignedInAt: null,
    });
    const screen = await renderAs('owner', [first, second]);

    await expect
      .element(screen.getByTestId(`users-row-${first.id}`))
      .toMatchTextContent(/Unnamed person 3F9A12C4/);
    await expect
      .element(actionsFor(screen, first))
      .toHaveAccessibleName('Actions for Unnamed person 3F9A12C4');
    await expect
      .element(actionsFor(screen, second))
      .toHaveAccessibleName('Actions for Unnamed person 7C01D2E9');

    await openAction(screen, second, 'Remove');
    const dialog = screen.getByTestId('users-remove-dialog');
    await expect
      .element(dialog.getByRole('heading', { name: 'Remove Unnamed person 7C01D2E9?' }))
      .toBeVisible();
    await expect
      .element(dialog.getByTestId('users-remove-consequence'))
      .toMatchTextContent(/^Unnamed person 7C01D2E9 is signed out now/);
  });

  it('promises the "renamed" mark only when a set name is corrected', async () => {
    const unnamed = member('3f9a12c4-0000-4000-8000-000000000021', '', 'editor', {
      displayName: null,
    });
    const screen = await renderAs('owner', [unnamed]);
    const renamed = 'The audit log marks the person as renamed.';

    await openAction(screen, unnamed, 'Correct name');
    const first = screen.getByTestId('users-name-dialog');
    await expect
      .element(first)
      .toHaveAccessibleDescription(
        'The name shows here, in activity and in the audit log, for past events too.',
      );
    await first.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(first).not.toBeVisible();

    await openAction(screen, EDITOR, 'Correct name');
    const correction = screen.getByTestId('users-name-dialog');
    await expect.element(correction).toHaveAccessibleDescription(new RegExp(`${renamed}$`));
  });
});
