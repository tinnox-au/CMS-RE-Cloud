import { ROUTES, type MediaDto } from '@tinnox/contracts';
import { useState } from 'react';
import { presentMediaStatus } from '../../../lib/mediaName.ts';
import { ImageOff, RefreshCw } from '../../../ui/icons.ts';
import { Button, cssVars, Icon, StatusPill } from '../../../ui/index.ts';
import { MediaThumb } from '../../shared/index.ts';
import './media-detail.css';

type PreviewState = 'loading' | 'loaded' | 'failed';

/** The shape of the preview box: the file's own, kept within what a narrow column can show. */
function previewRatio(media: Pick<MediaDto, 'width' | 'height'>): number {
  if (media.width === null || media.height === null) return 16 / 9;
  return Math.min(4, Math.max(0.6, media.width / media.height));
}

function ReadyPreview({ media, name }: { readonly media: MediaDto; readonly name: string }) {
  const [state, setState] = useState<PreviewState>('loading');
  const [attempt, setAttempt] = useState(0);
  const src = ROUTES.mediaPreview(media.id);
  const loaded = () => {
    setState('loaded');
  };
  const failed = () => {
    setState('failed');
  };
  return (
    <div
      className="tx-media-detail-preview"
      data-state={state}
      data-kind={media.kind}
      data-testid="media-detail-preview"
      style={cssVars({ '--tx-media-detail-ratio': previewRatio(media) })}
    >
      {state === 'failed' ? (
        <div className="tx-media-detail-preview__message" role="status">
          <Icon icon={ImageOff} size={24} />
          <span>The preview could not be loaded.</span>
          <Button
            size="sm"
            icon={RefreshCw}
            data-testid="media-detail-preview-retry"
            onClick={() => {
              setState('loading');
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : media.kind === 'video' ? (
        <video
          // A new attempt is a new element, so the browser asks for the file again.
          key={attempt}
          className="tx-media-detail-preview__media"
          src={src}
          controls
          muted
          playsInline
          preload="metadata"
          aria-label={`Preview of ${name}`}
          // Some browsers stop at the metadata until playback starts; either event will do.
          onLoadedMetadata={loaded}
          onLoadedData={loaded}
          onError={failed}
        />
      ) : (
        <img
          key={attempt}
          className="tx-media-detail-preview__media"
          src={src}
          alt={`Preview of ${name}`}
          decoding="async"
          draggable={false}
          onLoad={loaded}
          onError={failed}
        />
      )}
    </div>
  );
}

export interface MediaPreviewProps {
  readonly media: MediaDto;
  /** The name shown as the page title, for the text alternative. */
  readonly name: string;
}

/**
 * The preview of the details page. Ready image: the picture, whole, in a box of its own
 * shape. Ready video: the browser's own player, muted to start with, loading only the
 * metadata until it is played. Processing and failed media have no preview; the box then
 * shows the state. Under it: the status in words.
 */
export function MediaPreview({ media, name }: MediaPreviewProps) {
  const status = presentMediaStatus(media.status);
  return (
    <>
      {media.status === 'ready' ? (
        <ReadyPreview media={media} name={name} />
      ) : (
        <div
          className="tx-media-detail-preview tx-media-detail-preview--state"
          data-state={media.status}
          data-kind={media.kind}
          data-testid="media-detail-preview"
        >
          <MediaThumb media={media} />
        </div>
      )}
      <p className="tx-media-detail-preview__caption">
        <span data-testid="media-detail-status" data-status={media.status}>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </span>
        {media.status === 'ready' && media.kind === 'video' && (
          <span>Starts muted. Screens always play video without sound.</span>
        )}
        {media.status === 'processing' && <span>No preview until the check has finished.</span>}
        {media.status === 'failed' && <span>No preview: the file was not accepted.</span>}
      </p>
    </>
  );
}
