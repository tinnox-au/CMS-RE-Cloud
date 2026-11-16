import type { MediaDto } from '@tinnox/contracts';

/**
 * What is being dragged over the filmstrip: a tile of the sequence (by its draft key) or a
 * card of the library. Held in a ref by the editor while a drag runs, because the browser
 * hides the drag data until the drop.
 */
export type DragSource =
  | { readonly kind: 'item'; readonly key: string }
  | { readonly kind: 'media'; readonly media: MediaDto };

/** Drag data types of the editor; anything else (a file from the desktop) is ignored. */
export const ITEM_DRAG_TYPE = 'application/x-tinnox-playlist-item';
export const MEDIA_DRAG_TYPE = 'application/x-tinnox-media';
