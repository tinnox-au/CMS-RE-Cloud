import { PLAYLIST_PREVIEW_COUNT, type MediaKind, type PlaylistItemKind } from '@tinnox/contracts';
import { ListVideo } from '../../ui/icons.ts';
import { cx, Icon } from '../../ui/index.ts';
import { PreviewThumb } from './MediaThumb.tsx';
import './shared.css';

export interface PlaylistMosaicProps {
  /** `previewMediaIds` of a `PlaylistSummaryDto`: the first distinct media in play order. */
  readonly mediaIds: readonly string[];
  /**
   * `kinds` of the same summary. When the playlist holds one kind of media only, every
   * thumbnail is requested as that kind straight away. `app` is ignored: apps have no
   * thumbnail, so an app-only playlist shows the placeholder.
   */
  readonly kinds?: readonly PlaylistItemKind[];
  /**
   * The kind of one media item, where the page knows it (for example from the media list).
   * Without it a thumbnail in a mixed playlist is tried as a video first, then as an image.
   */
  readonly kindOf?: (mediaId: string) => MediaKind | undefined;
  /** 44 px square (`sm`, table rows), 72 px, 128 px, or the width of the container (`fill`, the default). */
  readonly size?: 'sm' | 'md' | 'lg' | 'fill';
  readonly className?: string;
}

/**
 * Up to four thumbnails of a playlist in one tile: one fills it, two share it side by side,
 * three put the first beside two stacked ones, four make a grid. An empty playlist shows a
 * placeholder. Decorative: the playlist's name is written next to it.
 */
export function PlaylistMosaic({
  mediaIds,
  kinds,
  kindOf,
  size = 'fill',
  className,
}: PlaylistMosaicProps) {
  const ids = mediaIds.slice(0, PLAYLIST_PREVIEW_COUNT);
  const mediaKinds = kinds?.filter((kind): kind is MediaKind => kind !== 'app') ?? [];
  const onlyKind = mediaKinds.length === 1 ? mediaKinds[0] : undefined;
  return (
    <span
      className={cx('tx-shared-mosaic', size !== 'fill' && `tx-shared-mosaic--${size}`, className)}
      data-count={ids.length}
      aria-hidden="true"
    >
      {ids.length === 0 ? (
        <span className="tx-shared-mosaic__empty">
          <Icon icon={ListVideo} size={size === 'sm' ? 18 : 24} />
        </span>
      ) : (
        ids.map((id) => (
          <span key={id} className="tx-shared-mosaic__cell">
            <PreviewThumb mediaId={id} kind={kindOf?.(id) ?? onlyKind ?? 'unknown'} noBadge />
          </span>
        ))
      )}
    </span>
  );
}
