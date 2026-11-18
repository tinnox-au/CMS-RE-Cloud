import type { DisplayDto } from '@tinnox/contracts';
import { assignedContent } from '../../../lib/assignedContent.ts';
import type { ScreenRow } from '../../../lib/screensList.ts';
import { Ellipsis, Eye, ListVideo, Send, Tags, Unlink } from '../../../ui/icons.ts';
import { IconButton, Menu, MenuItem, MenuSeparator } from '../../../ui/index.ts';

export interface ScreenRowMenuProps {
  readonly row: ScreenRow;
  readonly onAssign: (display: DisplayDto) => void;
  readonly onPush: (display: DisplayDto) => void;
  readonly onEditTags: (display: DisplayDto) => void;
  readonly onRevoke: (display: DisplayDto) => void;
}

/**
 * The actions of one screen, behind the three-dot button of its row or tile. "Revoke player"
 * is offered only while a player holds a credential for the screen. "Push now" is disabled,
 * with the reason, while nothing is assigned: there would be nothing to push.
 */
export function ScreenRowMenu({ row, onAssign, onPush, onEditTags, onRevoke }: ScreenRowMenuProps) {
  const { display } = row;
  const nothingAssigned = assignedContent(display) === null;
  return (
    <Menu
      placement="bottom-end"
      trigger={(props) => (
        <IconButton
          {...props}
          icon={Ellipsis}
          label={`Actions for ${display.name}`}
          data-testid="screens-row-menu"
        />
      )}
    >
      <MenuItem icon={Eye} to={`/screens/${display.id}`}>
        Open
      </MenuItem>
      <MenuItem
        icon={ListVideo}
        onSelect={() => {
          onAssign(display);
        }}
      >
        Assign content
      </MenuItem>
      <MenuItem
        icon={Send}
        disabled={nothingAssigned}
        hint={nothingAssigned ? 'Nothing assigned' : undefined}
        onSelect={() => {
          onPush(display);
        }}
      >
        Push now
      </MenuItem>
      <MenuItem
        icon={Tags}
        onSelect={() => {
          onEditTags(display);
        }}
      >
        Edit tags
      </MenuItem>
      {row.paired && (
        <>
          <MenuSeparator />
          <MenuItem
            icon={Unlink}
            tone="danger"
            onSelect={() => {
              onRevoke(display);
            }}
          >
            Revoke player
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
