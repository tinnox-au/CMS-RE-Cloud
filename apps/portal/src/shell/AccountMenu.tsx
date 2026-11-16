import { useSession } from '../session/SessionContext.tsx';
import { Avatar, Icon, Menu, MenuHeader, MenuItem, MenuSeparator } from '../ui/index.ts';
import { ChevronDown, LogOut } from '../ui/icons.ts';
import { ACCOUNT_NAV } from './nav.ts';
import { useShell } from './ShellContext.ts';

const ROLE_LABEL = { operator: 'Operator' } as const;

export interface AccountMenuProps {
  /**
   * Adds the organisation name to the menu's heading. For page frames whose header has no
   * organisation label (`EditorPage`); `Page` shows the label itself and leaves this off, so
   * the name is written once.
   */
  readonly showOrganisation?: boolean;
}

/**
 * The avatar button in the page header and its menu: who is signed in, then Settings, Users,
 * Audit log and Sign out.
 *
 * Signing out is started here and runs in `AppShell`, which outlives the menu: the button
 * shows that it is working, and a failure is reported by the page frame as an alert.
 */
export function AccountMenu({ showOrganisation = false }: AccountMenuProps) {
  const session = useSession();
  const { signOut } = useShell();
  const name = session.user.displayName;

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
          <Avatar name={name} />
          {signOut.busy ? (
            <span className="tx-spinner" aria-hidden="true" />
          ) : (
            <Icon icon={ChevronDown} size={14} className="tx-account-button__chevron" />
          )}
        </button>
      )}
    >
      <MenuHeader>
        <span className="tx-account-card">
          <Avatar name={name} size="lg" />
          <span className="tx-account-card__text">
            <span className="tx-account-card__name">{name}</span>
            <span className="tx-account-card__meta">
              {ROLE_LABEL[session.user.role]}
              {showOrganisation && ` · ${session.organization.name}`}
            </span>
          </span>
        </span>
      </MenuHeader>
      <MenuSeparator />
      {ACCOUNT_NAV.map((item) => (
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
