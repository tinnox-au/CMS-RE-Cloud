import type { Role } from '@tinnox/contracts';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { routes } from '../App.tsx';
import { PushContext, type PushContextValue } from '../features/push/PushContext.tsx';
import { WithSession } from '../session/session.test-support.tsx';
import { ShellContext, type ShellContextValue } from './ShellContext.ts';

// The guarded pages themselves, replaced by their headings: the test is about the guard.
vi.mock('../features/users/UsersPage.tsx', () => ({ UsersPage: () => <h1>Users</h1> }));
vi.mock('../features/settings/AlertsPage.tsx', () => ({ AlertsPage: () => <h1>Alerts</h1> }));
vi.mock('../features/displays/DisplayWizardPage.tsx', () => ({
  DisplayWizardPage: () => <h1>Add a screen</h1>,
}));

const SHELL: ShellContextValue = {
  drawerMode: false,
  navOpen: false,
  openNav: () => undefined,
  signOut: { busy: false, error: null, start: () => undefined, dismissError: () => undefined },
  announcePage: () => undefined,
};

const PUSH: PushContextValue = {
  plan: null,
  planError: null,
  pendingCount: null,
  refresh: () => undefined,
  openDialog: () => undefined,
  openPush: () => undefined,
  refreshPending: () => undefined,
};

/** A child route of App.tsx's table, as App.tsx defines it (its lazy page and its guard). */
function appRoute(path: string): RouteObject {
  const route = routes[0]?.children?.find((child) => child.path === path);
  if (route === undefined) throw new Error(`App.tsx has no route '${path}'`);
  return route;
}

/** The guarded routes of App.tsx, and the heading each page's stand-in shows. */
const GUARDED = [
  { path: '/users', route: 'users', heading: 'Users' },
  { path: '/screens/new', route: 'screens/new', heading: 'Add a screen' },
  { path: '/settings/alerts', route: 'settings/alerts', heading: 'Alerts' },
] as const;

/** Renders App.tsx's guarded routes as `role`, starting at `path`, inside the real page frame. */
function renderAt(role: Role, path: string) {
  const router = createMemoryRouter(
    [
      ...GUARDED.map(({ route }) => appRoute(route)),
      { path: 'dashboard', element: <h1>Dashboard</h1> },
    ],
    { initialEntries: [path] },
  );
  return render(
    <WithSession role={role}>
      <ShellContext value={SHELL}>
        <PushContext value={PUSH}>
          <RouterProvider router={router} />
        </PushContext>
      </ShellContext>
    </WithSession>,
  );
}

describe('RequirePermission on the routes of App.tsx', () => {
  for (const { path, heading } of GUARDED) {
    it(`shows a Viewer on ${path} that the role does not allow the page`, async () => {
      const screen = await renderAt('viewer', path);
      await expect
        .element(screen.getByRole('heading', { level: 1, name: "Your role doesn't allow this" }))
        .toBeVisible();
      await expect
        .element(
          screen.getByText('Ask the Owner or an Admin of your organisation if you need this.'),
        )
        .toBeVisible();
      expect(screen.getByRole('heading', { name: heading }).query()).toBeNull();

      await screen.getByRole('link', { name: 'Go to dashboard' }).click();
      await expect.element(screen.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    });
  }

  it('opens the screen wizard to an Editor, but not the Users page', async () => {
    const wizard = await renderAt('editor', '/screens/new');
    await expect.element(wizard.getByRole('heading', { name: 'Add a screen' })).toBeVisible();
    await wizard.unmount();

    const users = await renderAt('editor', '/users');
    await expect
      .element(users.getByRole('heading', { name: "Your role doesn't allow this" }))
      .toBeVisible();
  });

  it('opens the Users and Alerts pages to an Admin and an Owner, not Alerts to an Editor', async () => {
    for (const role of ['admin', 'owner'] as const) {
      for (const [path, heading] of [
        ['/users', 'Users'],
        ['/settings/alerts', 'Alerts'],
      ] as const) {
        const screen = await renderAt(role, path);
        await expect.element(screen.getByRole('heading', { name: heading })).toBeVisible();
        expect(screen.getByText("Your role doesn't allow this").query()).toBeNull();
        await screen.unmount();
      }
    }
    const alerts = await renderAt('editor', '/settings/alerts');
    await expect
      .element(alerts.getByRole('heading', { name: "Your role doesn't allow this" }))
      .toBeVisible();
  });
});
