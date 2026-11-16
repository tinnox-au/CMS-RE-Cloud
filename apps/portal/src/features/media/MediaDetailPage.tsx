import type { MediaDto } from '@tinnox/contracts';
import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { mediaLoadProblem, mediaPollInterval } from '../../lib/mediaDetailState.ts';
import { EditorPage } from '../../shell/EditorPage.tsx';
import { ArrowLeft, ImageOff } from '../../ui/icons.ts';
import { ButtonLink, Card, EmptyState, ErrorNotice } from '../../ui/index.ts';
import { MediaDetailSkeleton } from './detail/MediaDetailSkeleton.tsx';
import { MediaEditor } from './detail/MediaEditor.tsx';
import { MediaPendingView } from './detail/MediaPendingView.tsx';
import './detail/media-detail.css';

const BACK = { to: '/media', label: 'All media' } as const;

function isPending(media: MediaDto): media is MediaDto & { status: 'processing' | 'failed' } {
  return media.status !== 'ready';
}

/**
 * Media details (docs/portal-v2/stage-a.md, section 3.3): the preview, the facts about the
 * file and where it is used on the left; name, description, default duration, folder and
 * tags on the right, saved from the header. A file that is being checked is read again
 * every two seconds until the check has finished; one that failed shows why, with Delete as
 * its only action.
 */
export function MediaDetailPage() {
  const { id = '' } = useParams();
  const load = useCallback((signal: AbortSignal) => api.getMedia(id, signal), [id]);
  const { state, reload, setData } = useLoad(load, mediaPollInterval);

  if (state.status === 'loading') {
    return (
      <EditorPage title="Media" back={BACK}>
        <MediaDetailSkeleton />
      </EditorPage>
    );
  }

  if (state.status === 'error') {
    const refusal = isApiRequestError(state.error) ? state.error : null;
    if (mediaLoadProblem(refusal) === 'missing') {
      return (
        <EditorPage title="File not found" back={BACK}>
          <Card className="tx-media-detail-missing" data-testid="media-detail-missing">
            <EmptyState
              variant="inline"
              level={2}
              icon={ImageOff}
              title="This file could not be loaded"
              action={
                <ButtonLink variant="primary" to="/media" icon={ArrowLeft}>
                  Go to all media
                </ButtonLink>
              }
            >
              It is not in this organisation&rsquo;s library. It may have been deleted, or the
              address may be wrong.
            </EmptyState>
            {refusal !== null && (
              <p className="tx-media-detail-missing__answer">
                Server answer: {refusal.message}{' '}
                <span className="tx-code" data-testid="media-detail-missing-code">
                  {refusal.code}
                </span>
                {refusal.requestId !== null && (
                  <>
                    {' '}
                    · Request reference <span className="tx-mono">{refusal.requestId}</span>
                  </>
                )}
              </p>
            )}
          </Card>
        </EditorPage>
      );
    }
    return (
      <EditorPage title="Media" back={BACK}>
        <div className="tx-media-detail" data-testid="media-detail-error">
          <ErrorNotice error={state.error} title="The file could not be loaded" onRetry={reload} />
        </div>
      </EditorPage>
    );
  }

  const media = state.data;
  const notice =
    state.refreshError !== null ? (
      <ErrorNotice
        error={state.refreshError}
        title={
          media.status === 'processing'
            ? 'The state of the check could not be read again'
            : 'The file could not be read again'
        }
        onRetry={reload}
      />
    ) : null;

  if (isPending(media)) {
    return <MediaPendingView key={media.id} media={media} notice={notice} />;
  }
  return <MediaEditor key={media.id} media={media} onSaved={setData} notice={notice} />;
}
