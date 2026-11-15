import { ROUTES, type MediaDto } from '@tinnox/contracts';
import { useState } from 'react';

type Stage = 'primary' | 'fallback' | 'none';

/**
 * Thumbnail through the authorised preview endpoint (same-origin, session cookie).
 * Only ready media is requested. A video is tried as a muted, paused video element
 * first and as an image second, so either a poster image or the stream itself works.
 */
export function MediaThumb({ media }: { readonly media: MediaDto }) {
  const [stage, setStage] = useState<Stage>('primary');
  const label = media.kind === 'video' ? 'Video' : 'Image';
  if (media.status !== 'ready' || stage === 'none') {
    return (
      <div className="thumb thumb-placeholder" aria-hidden="true">
        {label}
      </div>
    );
  }
  const src = ROUTES.mediaPreview(media.id);
  if (media.kind === 'video' && stage === 'primary') {
    return (
      <video
        className="thumb"
        src={src}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        onError={() => {
          setStage('fallback');
        }}
      />
    );
  }
  return (
    <img
      className="thumb"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => {
        setStage('none');
      }}
    />
  );
}
