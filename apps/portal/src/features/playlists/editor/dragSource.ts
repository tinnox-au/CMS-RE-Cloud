import type { LibraryEntry } from '../../../lib/playlistEditor.ts';

/**
 * What is being dragged over the filmstrip: a tile of the sequence (by its draft key) or a
 * card of the library (a media item or an app). Held in a ref by the editor while a drag
 * runs, because the browser hides the drag data until the drop.
 */
export type DragSource = { readonly kind: 'item'; readonly key: string } | LibraryEntry;

/** Drag data types of the editor; anything else (a file from the desktop) is ignored. */
export const ITEM_DRAG_TYPE = 'application/x-tinnox-playlist-item';
export const MEDIA_DRAG_TYPE = 'application/x-tinnox-media';
