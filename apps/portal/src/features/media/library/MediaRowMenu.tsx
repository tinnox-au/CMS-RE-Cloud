import type { MediaDto } from '@tinnox/contracts';
import { addToPlaylistBlock } from '../../../lib/mediaLibraryActions.ts';
import { mediaDisplayName } from '../../../lib/mediaName.ts';
import { Ellipsis, Eye, FolderInput, ListPlus, Tags, Trash } from '../../../ui/icons.ts';
import { IconButton, Menu, MenuItem, MenuSeparator } from '../../../ui/index.ts';

/** Each action left out is hidden: the member's role does not allow it. */
export interface MediaRowMenuProps {
  readonly media: MediaDto;
  readonly onAddToPlaylist?: (media: MediaDto) => void;
  readonly onMove?: (media: MediaDto) => void;
  readonly onEditTags?: (media: MediaDto) => void;
  readonly onDelete?: (media: MediaDto) => void;
}

/**
 * The three-dot menu of one file, in a table row or on a tile. The caller renders no menu
 * at all when every action is left out (Open alone is the name's link).
 */
export function MediaRowMenu({
  media,
  onAddToPlaylist,
  onMove,
  onEditTags,
  onDelete,
}: MediaRowMenuProps) {
  const name = mediaDisplayName(media);
  const blocked = addToPlaylistBlock(media);
  return (
    <Menu
      placement="bottom-end"
      trigger={(props) => (
        <IconButton
          {...props}
          icon={Ellipsis}
          label={`Actions for ${name}`}
          data-testid="media-library-row-menu"
        />
      )}
    >
      <MenuItem icon={Eye} to={`/media/${media.id}`}>
        Open
      </MenuItem>
      {onAddToPlaylist !== undefined && (
        <MenuItem
          icon={ListPlus}
          disabled={blocked !== null}
          hint={blocked ?? undefined}
          onSelect={() => {
            onAddToPlaylist(media);
          }}
        >
          Add to playlist
        </MenuItem>
      )}
      {onMove !== undefined && (
        <MenuItem
          icon={FolderInput}
          onSelect={() => {
            onMove(media);
          }}
        >
          Move to folder
        </MenuItem>
      )}
      {onEditTags !== undefined && (
        <MenuItem
          icon={Tags}
          onSelect={() => {
            onEditTags(media);
          }}
        >
          Edit tags
        </MenuItem>
      )}
      {onDelete !== undefined && <MenuSeparator />}
      {onDelete !== undefined && (
        <MenuItem
          icon={Trash}
          tone="danger"
          onSelect={() => {
            onDelete(media);
          }}
        >
          Delete
        </MenuItem>
      )}
    </Menu>
  );
}
