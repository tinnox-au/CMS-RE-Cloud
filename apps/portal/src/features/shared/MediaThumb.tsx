import { ROUTES, type MediaDto, type MediaKind } from '@tinnox/contracts';
import { useRef } from 'react';
import { TriangleExclamationPoint } from '../../ui/icons.ts';
import { cx, Icon, Spinner, Thumb, VisuallyHidden, type ThumbProps } from '../../ui/index.ts';
import './shared.css';
import { useNearViewport } from './useNearViewport.ts';

type ThumbSize = NonNullable<ThumbProps['size']>;

export interface MediaThumbProps {
  /** The media item; a `MediaDto` fits. Only its id, kind and status are read. */
  readonly media: Pick<MediaDto, 'id' | 'kind' | 'status'>;
  /** 44 px square (`sm`, table rows), 72 px, 128 px, or the width of the container (`fill`, the default). */
  readonly size?: ThumbSize;
  /** Shape of the box for every size but `sm`: 16:9 (default), 1:1 or 4:3. */
  readonly ratio?: ThumbProps['ratio'];
  /** `cover` (default) fills the box and crops; `contain` shows the whole picture. */
  readonly fit?: ThumbProps['fit'];
  /** Text alternative. Leave it out when the name is written next to the thumbnail. */
  readonly alt?: string;
  /** Hides the kind badge in the corner (it shows only on `lg` and `fill`). */
  readonly noBadge?: boolean;
  readonly className?: string;
}

/**
 * The thumbnail of a media item, through the authorised thumbnail address of an image
 * (`ROUTES.mediaThumbnail`) or the preview address of a video (`ROUTES.mediaPreview`), same
 * origin, session cookie.
 *
 * - Ready image: loaded lazily by the browser.
 * - Ready video: a paused, muted `<video preload="metadata">`, so only the start of the file
 *   is fetched, and only once the thumbnail comes near the viewport. It never plays.
 * - Processing: a working indicator; no preview is requested (the API has none yet).
 * - Failed: a warning mark; no preview is requested.
 */
export function MediaThumb({
  media,
  size = 'fill',
  ratio,
  fit,
  alt,
  noBadge,
  className,
}: MediaThumbProps) {
  if (media.status === 'ready') {
    return (
      <PreviewThumb
        mediaId={media.id}
        kind={media.kind}
        size={size}
        ratio={ratio}
        fit={fit}
        alt={alt}
        noBadge={noBadge}
        className={className}
      />
    );
  }
  const failed = media.status === 'failed';
  const stateText = failed ? 'failed its check' : 'still being checked';
  return (
    <span
      className={cx('tx-shared-thumb', size !== 'fill' && `tx-shared-thumb--${size}`, className)}
      data-status={media.status}
    >
      <Thumb src={null} kind={media.kind} size={size} ratio={ratio} noBadge />
      <span
        className={cx('tx-shared-thumb__state', failed && 'tx-shared-thumb__state--failed')}
        aria-hidden="true"
      >
        {failed ? (
          <Icon icon={TriangleExclamationPoint} size={size === 'sm' ? 18 : 24} />
        ) : (
          <Spinner size={size === 'sm' ? 'md' : 'lg'} />
        )}
      </span>
      {alt !== undefined && alt !== '' && (
        <VisuallyHidden>
          {alt} ({stateText})
        </VisuallyHidden>
      )}
    </span>
  );
}

export interface PreviewThumbProps {
  readonly mediaId: string;
  /** `unknown` tries the preview as a video first and as an image second, as the kit's Thumb does. */
  readonly kind: MediaKind | 'unknown';
  readonly size?: ThumbSize;
  readonly ratio?: ThumbProps['ratio'];
  readonly fit?: ThumbProps['fit'];
  readonly alt?: string | undefined;
  readonly noBadge?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * The kit's `Thumb` fed from the thumbnail address of a ready image, or the preview address
 * of anything that may be a video (the kit's Thumb tries video first, which a JPEG
 * thumbnail would fail). Those wait until they are near the viewport before their address
 * is given to the browser.
 */
export function PreviewThumb({
  mediaId,
  kind,
  size = 'fill',
  ratio,
  fit,
  alt,
  noBadge,
  className,
}: PreviewThumbProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(ref, kind !== 'image');
  return (
    <span
      ref={ref}
      className={cx('tx-shared-thumb', size !== 'fill' && `tx-shared-thumb--${size}`, className)}
      data-status="ready"
    >
      <Thumb
        src={
          near
            ? kind === 'image'
              ? ROUTES.mediaThumbnail(mediaId)
              : ROUTES.mediaPreview(mediaId)
            : null
        }
        kind={kind === 'image' ? 'image' : 'video'}
        size={size}
        {...(ratio === undefined ? {} : { ratio })}
        {...(fit === undefined ? {} : { fit })}
        {...(alt === undefined ? {} : { alt })}
        noBadge={noBadge === true || kind === 'unknown'}
      />
    </span>
  );
}
