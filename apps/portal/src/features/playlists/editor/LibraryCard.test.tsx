import type { AppDto, FolderDto, MediaListResponse, TagDto } from '@tinnox/contracts';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { LoadResult } from '../../../hooks/useLoad.ts';
import type { EditorDraft } from '../../../lib/playlistEditor.ts';
import { app, ID } from '../../../lib/mediaLibrary.test-support.ts';
import { LibraryCard } from './LibraryCard.tsx';

const { listTags, listFolders } = vi.hoisted(() => ({
  listTags: vi.fn<() => Promise<TagDto[]>>(),
  listFolders: vi.fn<() => Promise<FolderDto[]>>(),
}));
vi.mock('../../../api/index.ts', () => ({ api: { listTags, listFolders } }));

const TAG: TagDto = { id: ID(8), scope: 'media', name: 'Summer', colour: 'teal', usageCount: 1 };

function ready<T>(data: T): LoadResult<T> {
  return {
    state: { status: 'ready', data, refreshError: null, fetchedAt: 0 },
    reload: () => undefined,
    setData: () => undefined,
  };
}

const DRAFT: EditorDraft = {
  name: 'Loop',
  items: [],
  description: '',
  transition: 'cut',
  shuffle: false,
};

function renderCard() {
  listTags.mockResolvedValue([TAG]);
  listFolders.mockResolvedValue([]);
  return render(
    <MemoryRouter>
      <LibraryCard
        media={ready<MediaListResponse>({
          items: [],
          storage: { usedBytes: 0, limitBytes: 1_000_000 },
        })}
        apps={ready<AppDto[]>([app(1)])}
        draft={DRAFT}
        limits={{
          minImageItemDurationMs: 1_000,
          maxImageItemDurationMs: 3_600_000,
          maxPlaylistItems: 200,
        }}
        dragSource={{ current: null }}
        onAdd={() => null}
      />
    </MemoryRouter>,
  );
}

describe('LibraryCard: the Apps chip', () => {
  it('says why the folder and tag filters are off, and ties the note to both', async () => {
    const screen = await renderCard();
    const folder = screen.getByTestId('playlist-editor-library-folder');
    const tags = screen.getByRole('group', { name: 'Filter by tag' });
    await expect.element(tags).toBeVisible();
    await expect
      .element(screen.getByTestId('playlist-editor-library-apps-note'))
      .not.toBeInTheDocument();
    await expect.element(folder).not.toHaveAttribute('aria-describedby');

    await screen.getByRole('button', { name: 'Apps', exact: true }).click();
    const note = screen.getByTestId('playlist-editor-library-apps-note');
    await expect.element(note).toHaveTextContent('Apps have no folder or tags.');
    await expect.element(folder).toBeDisabled();
    await expect.element(folder).toHaveAccessibleDescription('Apps have no folder or tags.');
    await expect.element(tags).toHaveAccessibleDescription('Apps have no folder or tags.');

    // The other chips have the filters on and no note.
    await screen.getByRole('button', { name: 'Images', exact: true }).click();
    await expect.element(note).not.toBeInTheDocument();
    await expect.element(folder).toBeEnabled();
    await expect.element(folder).not.toHaveAttribute('aria-describedby');
  });
});
