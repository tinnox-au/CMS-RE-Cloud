import type { MediaDto } from '@tinnox/contracts';
import { addToPlaylistBlock } from '../../../lib/mediaLibraryActions.ts';
import { mediaDisplayName } from '../../../lib/mediaName.ts';
import { Ellipsis, Eye, FolderInput, ListPlus, Tags, Trash } from '../../../ui/icons.ts';
import { IconButton, Menu, MenuItem, MenuSeparator } from '../../../ui/index.ts';

export interface MediaRowMenuProps {
  readonly media: MediaDto;
  readonly onAddToPlaylist: (media: MediaDto) => void;
  readonly onMove: (media: MediaDto) => void;
  readonly onEditTags: (media: MediaDto) => void;
  readonly onDelete: (media: MediaDto) => void;
}

/** The three-dot menu of one file, in a table row or on a tile. */
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
      <MenuItem
        icon={FolderInput}
        onSelect={() => {
          onMove(media);
        }}
      >
        Move to folder
      </MenuItem>
      <MenuItem
        icon={Tags}
        onSelect={() => {
          onEditTags(media);
        }}
      >
        Edit tags
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={Trash}
        tone="danger"
        onSelect={() => {
          onDelete(media);
        }}
      >
        Delete
      </MenuItem>
    </Menu>
  );
}
