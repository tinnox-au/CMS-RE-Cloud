import { ROLE_LABELS } from '@tinnox/domain';
import { useSession } from '../session/AuthenticatedSession.tsx';
import { Avatar, Menu, MenuHeader, MenuItem, MenuSeparator } from '../ui/index.ts';
import { LogOut } from '../ui/icons.ts';
import { ACCOUNT_NAV } from './nav.ts';
import { useShell } from './ShellContext.ts';

export interface AccountMenuProps {
  /**
   * Adds the organisation name to the menu's heading. For page frames whose header has no
   * organisation label (`EditorPage`); `Page` shows the label itself and leaves this off, so
   * the name is written once.
   */
  readonly showOrganisation?: boolean;
}

/**
 * The round initials button in the page header and its menu: who is signed in, then Settings, Users
 * (only with `member.read`), Audit log and Sign out.
 *
 * Signing out is started here and runs in `AppShell`, which outlives the menu: the button
 * shows that it is working, and a failure is reported by the page frame as an alert.
 */
export function AccountMenu({ showOrganisation = false }: AccountMenuProps) {
  const session = useSession();
  const { signOut } = useShell();
  const role = ROLE_LABELS[session.user.role];
  // A member TINNOX has not named yet is shown by their role.
  const name = session.user.displayName ?? role;
  const permissions = session.user.permissions;
  // The role under the name, unless it already is the name; the organisation where asked.
  const meta = [
    session.user.displayName !== null ? role : null,
    showOrganisation ? session.organization.name : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <Menu
      placement="bottom-end"
      label="Account"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="tx-account-button"
          data-testid="account-menu"
          aria-label={`Account menu, ${name}`}
          aria-busy={signOut.busy || undefined}
        >
          {signOut.busy ? (
            <span className="tx-spinner" aria-hidden="true" />
          ) : (
            <Avatar name={name} />
          )}
        </button>
      )}
    >
      <MenuHeader>
        <span className="tx-account-card">
          <Avatar name={name} size="lg" />
          <span className="tx-account-card__text">
            <span className="tx-account-card__name">{name}</span>
            {meta !== '' && <span className="tx-account-card__meta">{meta}</span>}
          </span>
        </span>
      </MenuHeader>
      <MenuSeparator />
      {ACCOUNT_NAV.filter(
        (item) => item.permission === undefined || permissions.includes(item.permission),
      ).map((item) => (
        <MenuItem
          key={item.id}
          icon={item.icon}
          to={item.to}
          hint={item.planned === true ? 'Planned' : undefined}
        >
          {item.label}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={LogOut} disabled={signOut.busy} onSelect={signOut.start}>
        {signOut.busy ? 'Signing out…' : 'Sign out'}
      </MenuItem>
    </Menu>
  );
}
