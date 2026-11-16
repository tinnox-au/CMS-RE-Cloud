import type { PlaylistSummaryDto } from '@tinnox/contracts';
import { Copy, Ellipsis, Monitor, SquarePen, Trash } from '../../../ui/icons.ts';
import { IconButton, Menu, MenuItem, MenuSeparator } from '../../../ui/index.ts';

export interface PlaylistRowMenuProps {
  readonly playlist: PlaylistSummaryDto;
  readonly onAssign: (playlist: PlaylistSummaryDto) => void;
  readonly onDuplicate: (playlist: PlaylistSummaryDto) => void;
  readonly onDelete: (playlist: PlaylistSummaryDto) => void;
  /** A duplicate of this playlist is being made: the item waits for the answer. */
  readonly duplicating: boolean;
}

/** The actions of one playlist, behind the three-dot button of its row or tile. */
export function PlaylistRowMenu({
  playlist,
  onAssign,
  onDuplicate,
  onDelete,
  duplicating,
}: PlaylistRowMenuProps) {
  return (
    <Menu
      placement="bottom-end"
      trigger={(props) => (
        <IconButton
          {...props}
          icon={Ellipsis}
          label={`Actions for ${playlist.name}`}
          data-testid="playlists-row-menu"
        />
      )}
    >
      <MenuItem icon={SquarePen} to={`/playlists/${playlist.id}`}>
        Open
      </MenuItem>
      <MenuItem
        icon={Monitor}
        onSelect={() => {
          onAssign(playlist);
        }}
      >
        Assign to screens
      </MenuItem>
      <MenuItem
        icon={Copy}
        disabled={duplicating}
        onSelect={() => {
          onDuplicate(playlist);
        }}
      >
        Duplicate
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={Trash}
        tone="danger"
        onSelect={() => {
          onDelete(playlist);
        }}
      >
        Delete
      </MenuItem>
    </Menu>
  );
}
