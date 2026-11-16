import { useState } from 'react';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { Film, Image, ImageOff } from './icons.ts';

export interface ThumbProps {
  /** Address of the preview. Missing or null shows the placeholder. */
  readonly src?: string | null;
  /**
   * What the media is. It picks the corner badge and the placeholder, and for `video` the
   * preview is tried as a paused, muted video first and as an image second, because a
   * preview address may serve either a poster image or the stream itself.
   */
  readonly kind?: 'image' | 'video';
  /**
   * `sm` is the 44 px square of a table row, `md` 72 px and `lg` 128 px wide; `fill` takes
   * the width of its container (grid tiles, previews).
   */
  readonly size?: 'sm' | 'md' | 'lg' | 'fill';
  /** Shape of the box for every size but `sm`: 16:9, 1:1 or 4:3. */
  readonly ratio?: 'wide' | 'square' | 'classic';
  /** `cover` fills the box and crops; `contain` shows the whole picture. */
  readonly fit?: 'cover' | 'contain';
  /** Text alternative. Leave empty when the name is written next to the thumbnail. */
  readonly alt?: string;
  /** Hide the kind badge in the corner. */
  readonly noBadge?: boolean;
  readonly className?: string;
}

type Stage = 'video' | 'image' | 'failed';

/**
 * A media thumbnail in a fixed-aspect box: a neutral shimmer while loading, the picture
 * when it arrives, a placeholder icon when there is none or it fails.
 */
export function Thumb(props: ThumbProps) {
  // A new address starts over: no stale "failed" or "loaded" state.
  return <ThumbBox key={props.src ?? ''} {...props} />;
}

function ThumbBox({
  src,
  kind = 'image',
  size = 'fill',
  ratio = 'wide',
  fit = 'cover',
  alt = '',
  noBadge = false,
  className,
}: ThumbProps) {
  const [stage, setStage] = useState<Stage>(kind === 'video' ? 'video' : 'image');
  const [loaded, setLoaded] = useState(false);
  const hasSource = typeof src === 'string' && src !== '' && stage !== 'failed';
  const state = !hasSource ? 'empty' : loaded ? 'loaded' : 'loading';
  const KindIcon = kind === 'video' ? Film : Image;
  const decorative = alt === '';

  return (
    <span
      className={cx(
        'tx-thumb',
        size !== 'fill' && `tx-thumb--${size}`,
        ratio === 'square' && 'tx-thumb--square',
        ratio === 'classic' && 'tx-thumb--classic',
        fit === 'contain' && 'tx-thumb--contain',
        className,
      )}
      data-state={state}
    >
      <span className="tx-thumb__placeholder" aria-hidden="true">
        {state === 'empty' && (
          <Icon icon={stage === 'failed' ? ImageOff : KindIcon} size={size === 'sm' ? 18 : 24} />
        )}
      </span>
      {hasSource && stage === 'video' && (
        <video
          className="tx-thumb__media"
          src={src}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          {...(decorative ? { 'aria-hidden': true } : { 'aria-label': alt })}
          // Some browsers stop at the metadata until playback starts; either event will do.
          onLoadedMetadata={() => {
            setLoaded(true);
          }}
          onLoadedData={() => {
            setLoaded(true);
          }}
          onError={() => {
            setStage('image');
          }}
        />
      )}
      {hasSource && stage === 'image' && (
        <img
          className="tx-thumb__media"
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => {
            setLoaded(true);
          }}
          onError={() => {
            setStage('failed');
          }}
        />
      )}
      {!noBadge && state === 'loaded' && (
        <span className="tx-thumb__badge" aria-hidden="true">
          <Icon icon={KindIcon} size={14} />
        </span>
      )}
    </span>
  );
}
