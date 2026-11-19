import type { FolderDto, TagDto } from '@tinnox/contracts';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { draftFromMedia, NO_MEDIA_DETAIL_ERRORS } from '../../../lib/mediaDetailDraft.ts';
import { media } from '../../../lib/mediaLibrary.test-support.ts';
import { ToastProvider } from '../../../ui/index.ts';
import type { FoldersResource, TagsResource } from '../../shared/index.ts';
import { MediaDetailForm } from './MediaDetailForm.tsx';

// Nothing here may reach the API; the shared pickers import it.
vi.mock('../../../api/index.ts', () => ({ api: {} }));

const IMAGE = media(1, 'image', { name: 'Summer sale' });

const TAGS: TagsResource = {
  scope: 'media',
  status: 'ready',
  tags: [],
  byId: new Map<string, TagDto>(),
  error: null,
  refreshError: null,
  reload: () => undefined,
  createTag: () => Promise.reject(new Error('not in this test')),
};

const FOLDERS: FoldersResource = {
  status: 'ready',
  folders: [],
  byId: new Map<string, FolderDto>(),
  error: null,
  refreshError: null,
  reload: () => undefined,
  createFolder: () => Promise.reject(new Error('not in this test')),
};

function renderForm(readOnly: boolean, onSubmit: () => void) {
  return render(
    <ToastProvider>
      <MediaDetailForm
        media={IMAGE}
        // A changed draft, so only the read-only guard stands between Enter and a save.
        draft={{ ...draftFromMedia(IMAGE), name: 'Winter sale' }}
        errors={NO_MEDIA_DETAIL_ERRORS}
        onChange={() => undefined}
        onSubmit={onSubmit}
        tags={TAGS}
        folders={FOLDERS}
        limits={{ minImageItemDurationMs: 1_000, maxImageItemDurationMs: 3_600_000 }}
        saving={false}
        readOnly={readOnly}
        saveError={null}
        onDismissSaveError={() => undefined}
        summaryRef={{ current: null }}
      />
    </ToastProvider>,
  );
}

describe('MediaDetailForm: read-only', () => {
  it('saves nothing on Enter in the name field, and locks the fields', async () => {
    const onSubmit = vi.fn();
    const screen = await renderForm(true, onSubmit);
    const name = screen.getByTestId('media-detail-name');
    await expect.element(name).toHaveAttribute('readonly');
    await expect
      .element(screen.getByTestId('media-detail-description'))
      .toHaveAttribute('readonly');
    // The default duration is text, not a Stepper with live buttons.
    await expect.element(screen.getByTestId('media-detail-duration')).not.toBeInTheDocument();
    await expect.element(screen.getByTestId('media-detail-duration-static')).toBeVisible();

    // Scoped to the field: `userEvent.keyboard` first finds the test frame by name, which can
    // still be the previous file's frame as it goes away ("Frame was detached").
    await userEvent.type(name, '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    // Without onDelete there is no Delete section.
    await expect.element(screen.getByTestId('media-detail-delete')).not.toBeInTheDocument();
  });

  it('saves on Enter in the name field when it is not read-only', async () => {
    const onSubmit = vi.fn();
    const screen = await renderForm(false, onSubmit);
    await userEvent.type(screen.getByTestId('media-detail-name'), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
