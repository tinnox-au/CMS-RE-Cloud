import type { MediaDto } from '@tinnox/contracts';
import { useId, type ReactNode } from 'react';
import { mediaFailureText } from '../../../lib/mediaDetailFacts.ts';
import { pendingStateText } from '../../../lib/mediaDetailState.ts';
import { Trash } from '../../../ui/icons.ts';
import { Banner, Button, Card } from '../../../ui/index.ts';
import { EditorPage } from '../../../shell/EditorPage.tsx';
import { MediaDetailsCard } from './MediaDetailsCard.tsx';
import { useMediaDelete } from './useMediaDelete.tsx';
import './media-detail.css';

export interface MediaPendingViewProps {
  readonly media: MediaDto & { readonly status: 'processing' | 'failed' };
  /** A notice about the last refresh, from the page. */
  readonly notice?: ReactNode;
}

/**
 * A file that is still being checked, or that failed its check: the facts that are known,
 * the state in words (for a failure the reason and the error code as text), and Delete as
 * the only action. A file being checked is read again every two seconds by the page.
 */
export function MediaPendingView({ media, notice }: MediaPendingViewProps) {
  const remove = useMediaDelete({ media, usage: null });
  const text = pendingStateText(media.status);
  const failure = media.status === 'failed' ? mediaFailureText(media) : null;
  const titleId = useId();

  return (
    <EditorPage title={media.name} back={{ to: '/media', label: 'All media' }}>
      <div className="tx-media-detail" data-testid="media-detail" data-status={media.status}>
        {notice}
        <div className="tx-editor">
          <MediaDetailsCard media={media} name={media.name} />
          <Card as="section" className="tx-media-detail-settings" aria-labelledby={titleId}>
            <div className="tx-media-detail-state" data-testid="media-detail-state">
              <h2 id={titleId} className="tx-media-detail-state__title">
                {text.title}
              </h2>
              <p className="tx-media-detail-state__text">{text.text}</p>
              {failure !== null && (
                <Banner
                  tone="danger"
                  title="Why it was not accepted"
                  className="tx-media-detail-state__reason"
                >
                  <span data-testid="media-detail-failure">
                    {failure.message}
                    {failure.code !== null && (
                      <>
                        {' '}
                        <span className="tx-code" data-testid="media-detail-failure-code">
                          {failure.code}
                        </span>
                      </>
                    )}
                  </span>
                  {failure.detail !== null && (
                    <span className="tx-media-detail-state__detail tx-break">{failure.detail}</span>
                  )}
                </Banner>
              )}
              <Button
                variant="danger"
                icon={Trash}
                onClick={remove.ask}
                data-testid="media-detail-delete"
              >
                Delete file
              </Button>
            </div>
          </Card>
        </div>
      </div>
      {remove.dialog}
    </EditorPage>
  );
}
