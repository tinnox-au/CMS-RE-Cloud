import type { MediaDto, Role } from '@tinnox/contracts';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { media } from '../../../lib/mediaLibrary.test-support.ts';
import { WithSession } from '../../../session/session.test-support.tsx';
import { ToastProvider } from '../../../ui/index.ts';
import { PushContext, type PushContextValue } from '../../push/PushContext.tsx';
import { MediaPendingView } from './MediaPendingView.tsx';

// Nothing here may reach the API; Delete imports it.
vi.mock('../../../api/index.ts', () => ({ api: {} }));
// The page frame needs the whole shell; the test reads the page body.
vi.mock('../../../shell/EditorPage.tsx', () => ({
  EditorPage: ({ children }: { readonly children: ReactNode }) => <main>{children}</main>,
}));

const PUSH: PushContextValue = {
  plan: null,
  planError: null,
  pendingCount: null,
  refresh: () => undefined,
  openDialog: () => undefined,
  openPush: () => undefined,
  refreshPending: () => undefined,
};

const FAILED = media(1, 'video', {
  status: 'failed',
  errorCode: 'unsupported_codec',
  errorDetail: 'codec hevc',
}) as MediaDto & { readonly status: 'failed' };

function renderAs(role: Role) {
  return render(
    <WithSession role={role}>
      <ToastProvider>
        <PushContext value={PUSH}>
          <MemoryRouter>
            <MediaPendingView media={FAILED} />
          </MemoryRouter>
        </PushContext>
      </ToastProvider>
    </WithSession>,
  );
}

describe('MediaPendingView: a failed file', () => {
  it('tells a Viewer why it failed, but not to re-encode or upload it', async () => {
    const screen = await renderAs('viewer');
    const reason = screen.getByTestId('media-detail-failure');
    await expect
      .element(reason)
      .toMatchTextContent(/^The video codec is not supported\. unsupported_codec$/);
    const state = screen.getByTestId('media-detail-state').element().textContent ?? '';
    expect(state).not.toMatch(/re-?encode|upload/i);
  });

  it('tells an Editor what to do about it', async () => {
    const screen = await renderAs('editor');
    await expect
      .element(screen.getByTestId('media-detail-failure'))
      .toMatchTextContent(/Re-encode the video as H\.264 in an MP4 container\./);
  });
});
