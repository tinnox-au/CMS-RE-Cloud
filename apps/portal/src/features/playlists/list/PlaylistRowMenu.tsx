import type { PlaylistSummaryDto } from '@tinnox/contracts';
import { Copy, Ellipsis, Monitor, SquarePen, Trash } from '../../../ui/icons.ts';
import { IconButton, Menu, MenuItem, MenuSeparator } from '../../../ui/index.ts';

/** Each action left out is hidden: the member's role does not allow it. */
export interface PlaylistRowMenuProps {
  readonly playlist: PlaylistSummaryDto;
  readonly onAssign?: (playlist: PlaylistSummaryDto) => void;
  readonly onDuplicate?: (playlist: PlaylistSummaryDto) => void;
  readonly onDelete?: (playlist: PlaylistSummaryDto) => void;
  /** A duplicate of this playlist is being made: the item waits for the answer. */
  readonly duplicating: boolean;
}

/**
 * The actions of one playlist, behind the three-dot button of its row or tile. The caller
 * renders no menu at all when every action is left out (Open alone is the name's link).
 */
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
      {onAssign !== undefined && (
        <MenuItem
          icon={Monitor}
          onSelect={() => {
            onAssign(playlist);
          }}
        >
          Assign to screens
        </MenuItem>
      )}
      {onDuplicate !== undefined && (
        <MenuItem
          icon={Copy}
          disabled={duplicating}
          onSelect={() => {
            onDuplicate(playlist);
          }}
        >
          Duplicate
        </MenuItem>
      )}
      {onDelete !== undefined && <MenuSeparator />}
      {onDelete !== undefined && (
        <MenuItem
          icon={Trash}
          tone="danger"
          onSelect={() => {
            onDelete(playlist);
          }}
        >
          Delete
        </MenuItem>
      )}
    </Menu>
  );
}
