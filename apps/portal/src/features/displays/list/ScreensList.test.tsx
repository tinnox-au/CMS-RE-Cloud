import type { DisplayDto, PlaylistSummaryDto, Role, TagDto } from '@tinnox/contracts';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { WithSession } from '../../../session/session.test-support.tsx';
import { ToastProvider } from '../../../ui/index.ts';
import { PushContext, type PushContextValue } from '../../push/PushContext.tsx';
import { ScreensList } from './ScreensList.tsx';
import { useScreensData, type ScreensData } from './useScreensData.ts';

const { patchDisplay, listPlaylists, listTags } = vi.hoisted(() => ({
  patchDisplay: vi.fn<(id: string, patch: unknown) => Promise<DisplayDto>>(),
  listPlaylists: vi.fn<() => Promise<PlaylistSummaryDto[]>>(),
  listTags: vi.fn<() => Promise<TagDto[]>>(),
}));
vi.mock('../../../api/index.ts', () => ({ api: { patchDisplay, listPlaylists, listTags } }));
vi.mock('./useScreensData.ts', () => ({ useScreensData: vi.fn() }));
vi.mock('../../../shell/Page.tsx', () => ({
  Page: ({
    title,
    actions,
    children,
  }: {
    readonly title: string;
    readonly actions?: ReactNode;
    readonly children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
}));

const mockedScreensData = vi.mocked(useScreensData);

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-11-14T03:00:00.000Z';

function display(n: number, change: Partial<DisplayDto> = {}): DisplayDto {
  return {
    id: ID(n),
    siteId: ID(900),
    name: `Screen ${String(n)}`,
    description: null,
    canvas: { width: 1920, height: 1080 },
    contentRect: null,
    defaultFit: 'contain',
    rotation: 0,
    workingHours: null,
    route: 'browser',
    player: null,
    tagIds: [],
    assignedPlaylist: null,
    assignedSchedule: null,
    assignedLayout: null,
    createdAt: T,
    updatedAt: T,
    ...change,
  };
}

// The list's copy: a playlist, no schedule. "No playlist" is then a change worth sending.
const LOBBY = display(1, { name: 'Lobby', assignedPlaylist: { id: ID(20), name: 'Loop' } });

const PUSH: PushContextValue = {
  plan: null,
  planError: null,
  pendingCount: null,
  refresh: () => undefined,
  openDialog: () => undefined,
  openPush: () => undefined,
  refreshPending: () => undefined,
};

function screensData(displays: DisplayDto[]): ScreensData {
  return {
    displays: { status: 'ready', data: displays, refreshError: null, fetchedAt: 0 },
    sites: { status: 'ready', data: [], refreshError: null, fetchedAt: 0 },
    statuses: { status: 'ready', data: [], refreshError: null, fetchedAt: 0 },
    reloadDisplays: () => undefined,
    reloadSites: () => undefined,
    reloadStatuses: () => undefined,
    mergeDisplays: () => undefined,
  };
}

function renderList(role: Role) {
  return render(
    <MemoryRouter>
      <WithSession role={role}>
        <ToastProvider>
          <PushContext value={PUSH}>
            <ScreensList />
          </PushContext>
        </ToastProvider>
      </WithSession>
    </MemoryRouter>,
  );
}

async function unassignFromLobby() {
  const screen = await renderList('owner');
  await screen.getByRole('button', { name: 'Actions for Lobby' }).click();
  await screen.getByRole('menuitem', { name: 'Assign content' }).click();
  await screen.getByRole('radio', { name: /No playlist/ }).click();
  await screen.getByRole('button', { name: 'Assign playlist' }).click();
  expect(patchDisplay).toHaveBeenCalledTimes(1);
  expect(patchDisplay).toHaveBeenCalledWith(LOBBY.id, { assignedPlaylistId: null });
  return { screen, toasts: screen.getByRole('region', { name: 'Notifications' }) };
}

beforeEach(() => {
  mockedScreensData.mockReturnValue(screensData([LOBBY]));
  listPlaylists.mockResolvedValue([]);
  listTags.mockResolvedValue([]);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('ScreensList: "No playlist" for one screen', () => {
  it('says the screen now has a schedule when one was assigned elsewhere meanwhile', async () => {
    patchDisplay.mockResolvedValue({
      ...LOBBY,
      assignedPlaylist: null,
      assignedSchedule: {
        id: ID(30),
        name: 'Shop week',
        defaultPlaylist: { id: ID(20), name: 'Loop' },
      },
    });
    const { toasts } = await unassignFromLobby();

    // The message and its detail share one text block, so the message is matched in the stack.
    await expect
      .element(
        toasts.getByText(
          'Its schedule stays assigned. To remove it, use "Remove content" on the screen\'s page.',
        ),
      )
      .toBeVisible();
    expect(toasts.element().textContent).toContain('Lobby now has a schedule');
    expect(toasts.element().textContent).not.toContain('Playlist unassigned from Lobby');
  });

  it('says the screen now has a layout when one was assigned elsewhere meanwhile', async () => {
    patchDisplay.mockResolvedValue({
      ...LOBBY,
      assignedPlaylist: null,
      assignedLayout: {
        id: ID(40),
        name: 'Foyer band',
        mainPlaylist: { id: ID(20), name: 'Loop' },
      },
    });
    const { toasts } = await unassignFromLobby();

    await expect
      .element(
        toasts.getByText(
          'Its layout stays assigned. To remove it, use "Remove content" on the screen\'s page.',
        ),
      )
      .toBeVisible();
    expect(toasts.element().textContent).toContain('Lobby now has a layout');
  });

  it('shows the usual success toast when the screen still has no schedule', async () => {
    patchDisplay.mockResolvedValue({ ...LOBBY, assignedPlaylist: null });
    const { toasts } = await unassignFromLobby();

    await expect
      .element(toasts.getByText('The screen keeps what it was last given.'))
      .toBeVisible();
    expect(toasts.element().textContent).toContain('Playlist unassigned from Lobby');
    expect(toasts.element().textContent).not.toContain('now has a schedule');
  });
});

describe('ScreensList: what each role is offered', () => {
  it('offers an Owner "Add screen", the row menu and selection', async () => {
    const screen = await renderList('owner');
    await expect.element(screen.getByRole('link', { name: 'Add screen' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Actions for Lobby' })).toBeVisible();
    await expect.element(screen.getByRole('checkbox', { name: 'Select Lobby' })).toBeVisible();
  });

  it('tells a Viewer with no screens that an editor adds them, with no button', async () => {
    mockedScreensData.mockReturnValue(screensData([]));
    const screen = await renderList('viewer');
    await expect.element(screen.getByText('An editor adds screens.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Add screen' }).query()).toBeNull();
  });

  it('shows a Viewer the screens with no "Add screen", no row menu and no selection', async () => {
    const screen = await renderList('viewer');
    await expect.element(screen.getByRole('link', { name: 'Lobby' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Add screen' }).query()).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions for Lobby' }).query()).toBeNull();
    expect(screen.getByRole('checkbox').query()).toBeNull();
  });
});
