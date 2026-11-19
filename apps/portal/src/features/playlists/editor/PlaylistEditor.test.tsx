import type { AppDto, MediaListResponse, PlaylistDto } from '@tinnox/contracts';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { ID, media } from '../../../lib/mediaLibrary.test-support.ts';
import { WithSession } from '../../../session/session.test-support.tsx';
import type { EditorPageProps } from '../../../shell/EditorPage.tsx';
import { ToastProvider } from '../../../ui/index.ts';
import { PushContext, type PushContextValue } from '../../push/PushContext.tsx';
import { PlaylistEditor } from './PlaylistEditor.tsx';

const { listMedia, listApps } = vi.hoisted(() => ({
  listMedia: vi.fn<() => Promise<MediaListResponse>>(),
  listApps: vi.fn<() => Promise<AppDto[]>>(),
}));
vi.mock('../../../api/index.ts', () => ({ api: { listMedia, listApps } }));
// The page frame needs the whole shell; the test reads what the editor hands it.
vi.mock('../../../shell/EditorPage.tsx', async () => {
  const { Link } = await import('react-router-dom');
  return {
    EditorPage: ({ title, back, status, actions, children }: EditorPageProps) => (
      <>
        <Link to={back.to}>{back.label}</Link>
        <h1>{title}</h1>
        {status !== undefined && <div data-testid="editor-page-status">{status as ReactNode}</div>}
        {actions !== undefined && (
          <div data-testid="editor-page-actions">{actions as ReactNode}</div>
        )}
        <main>{children}</main>
      </>
    ),
  };
});

const T = '2026-11-14T03:00:00.000Z';
const IMAGE = media(1, 'image');
const VIDEO = media(2, 'video');

const PLAYLIST: PlaylistDto = {
  id: ID(7),
  name: 'Foyer loop',
  description: null,
  items: [
    {
      id: ID(3),
      position: 0,
      mediaId: IMAGE.id,
      durationMs: 8_000,
      fit: null,
      media: IMAGE,
    },
    {
      id: ID(4),
      position: 1,
      mediaId: VIDEO.id,
      durationMs: null,
      fit: 'cover',
      media: VIDEO,
    },
  ],
  transition: 'cut',
  shuffle: false,
  createdAt: T,
  updatedAt: T,
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

async function renderAsViewer() {
  listMedia.mockResolvedValue({
    items: [IMAGE, VIDEO],
    storage: { usedBytes: 0, limitBytes: 1_000_000 },
  });
  listApps.mockResolvedValue([]);
  const router = createMemoryRouter(
    [
      { path: '/playlists/:id', element: <PlaylistEditor initial={PLAYLIST} /> },
      { path: '/playlists', element: <p>The playlists list</p> },
    ],
    { initialEntries: [`/playlists/${PLAYLIST.id}`] },
  );
  const screen = await render(
    <WithSession role="viewer">
      <ToastProvider>
        <PushContext value={PUSH}>
          <RouterProvider router={router} />
        </PushContext>
      </ToastProvider>
    </WithSession>,
  );
  return { screen, router };
}

describe('PlaylistEditor: as a Viewer', () => {
  it('says so, and offers no save bar, no library and nothing to drag, move or remove', async () => {
    const { screen } = await renderAsViewer();
    await expect
      .element(screen.getByText('You can view this playlist. Editors make changes.'))
      .toBeVisible();
    await expect.element(screen.getByTestId('playlist-editor-sequence')).toBeVisible();

    // No save bar: neither the status nor the actions reach the page frame.
    await expect.element(screen.getByTestId('editor-page-status')).not.toBeInTheDocument();
    await expect.element(screen.getByTestId('editor-page-actions')).not.toBeInTheDocument();
    await expect.element(screen.getByTestId('playlist-editor-library')).not.toBeInTheDocument();

    expect(screen.getByTestId('playlist-editor-item').elements()).toHaveLength(2);
    expect(screen.container.querySelectorAll('[draggable="true"]')).toHaveLength(0);
    expect(screen.getByTestId('playlist-editor-item-earlier').elements()).toHaveLength(0);
    expect(screen.getByTestId('playlist-editor-item-remove').elements()).toHaveLength(0);
    expect(screen.getByTestId('playlist-editor-item-fit').elements()).toHaveLength(0);
    await expect.element(screen.getByTestId('playlist-editor-item-duration')).toBeDisabled();
    await expect.element(screen.getByTestId('playlist-editor-name')).toHaveAttribute('readonly');

    // The push card lists screens only: assigning and pushing need other keys.
    await expect.element(screen.getByTestId('playlist-editor-assign')).not.toBeInTheDocument();
    await expect.element(screen.getByTestId('playlist-editor-push-now')).not.toBeInTheDocument();
  });

  it('leaves without asking, whatever was typed', async () => {
    const { screen, router } = await renderAsViewer();
    const name = screen.getByTestId('playlist-editor-name');
    await name.click();
    await userEvent.keyboard('Winter');
    await expect.element(name).toHaveValue('Foyer loop');

    await screen.getByRole('link', { name: 'All playlists' }).click();
    await expect.element(screen.getByText('The playlists list')).toBeVisible();
    expect(router.state.location.pathname).toBe('/playlists');
    await expect.element(screen.getByTestId('leave-dialog')).not.toBeInTheDocument();
  });
});
