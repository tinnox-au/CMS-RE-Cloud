import { MediaLibrary } from './library/MediaLibrary.tsx';

export type MediaLibraryKind = 'all' | 'image' | 'video';

/**
 * The media library, filtered by kind: `/media` lists every file ("All media"),
 * `/media/images` the images and `/media/videos` the videos. The page is
 * `library/MediaLibrary.tsx` (docs/portal-v2/stage-a.md, section 3.2).
 */
export function MediaLibraryPage({ kind }: { readonly kind: MediaLibraryKind }) {
  return <MediaLibrary kind={kind} />;
}
