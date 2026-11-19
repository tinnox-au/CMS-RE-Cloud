import type { InviteDto, MemberDto } from '@tinnox/contracts';
import { canManage, ROLE_LABELS, ROLE_RANK } from '@tinnox/domain';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isApiRequestError, isOutcomeUnknown } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { applyListView, DEFAULT_PAGE_SIZE, type SortState } from '../../lib/listView.ts';
import {
  formatDate,
  inviteCountLabel,
  invitesCancelledBy,
  managedByOwner,
  memberActions,
  memberName,
  peopleCountLabel,
  removeConsequence,
  sessionsEndedLabel,
  type MemberAction,
} from '../../lib/users.ts';
import { useCan, useSession } from '../../session/AuthenticatedSession.tsx';
import { Page } from '../../shell/Page.tsx';
import {
  Ellipsis,
  LogOut,
  Pencil,
  RefreshCw,
  SearchX,
  UserCog,
  UserMinus,
  UserPlus,
} from '../../ui/icons.ts';
import {
  Avatar,
  Banner,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorNotice,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  NameCell,
  Pagination,
  SearchField,
  Segmented,
  StatusPill,
  useToast,
  VisuallyHidden,
  type DataTableColumn,
} from '../../ui/index.ts';
// By file, not through the features/shared barrel: the barrel reaches modules this page does not need.
import {
  elementByTestId,
  rowByTestId,
  useRowFocusReturn,
  type RowFocusSource,
} from '../shared/useRowFocusReturn.ts';
import { InviteDialog } from './InviteDialog.tsx';
import { InvitesCard } from './InvitesCard.tsx';
import { NameDialog } from './NameDialog.tsx';
import { RoleDialog } from './RoleDialog.tsx';
import './users.css';

const DEFAULT_SORT: SortState = { columnId: 'name', direction: 'asc' };

const SORT_ACCESSORS = {
  name: (member: MemberDto) => memberName(member),
  // Owner first when ascending.
  role: (member: MemberDto) => -ROLE_RANK[member.role],
  signedIn: (member: MemberDto) => member.firstSignedInAt ?? '',
  removed: (member: MemberDto) => member.removedAt ?? '',
};

type Show = 'current' | 'removed';

/**
 * Users (docs/portal-v2/stage-c.md, section 7.4): the people of the organisation with their
 * roles, and the invites waiting for TINNOX. Admins and Owners request invites, change roles,
 * correct names, sign people out everywhere and remove them, each within the rank rule: an
 * Admin manages Editors and Viewers, an Owner everyone; nobody changes themselves. Controls
 * the member may not use are hidden; the API decides every request. Removed people stay
 * listed under "Removed" (`?show=removed`), because their names keep the activity readable.
 */
export function UsersPage() {
  const session = useSession();
  const canChange = useCan('member.manage');
  const actor = { id: session.user.membershipId, role: session.user.role };
  const toast = useToast();

  const loadMembers = useCallback((signal: AbortSignal) => api.listMembers(signal), []);
  const loadInvites = useCallback((signal: AbortSignal) => api.listInvites(signal), []);
  const { state: membersState, reload: reloadMembers } = useLoad<MemberDto[]>(loadMembers);
  const { state: invitesState, reload: reloadInvites } = useLoad<InviteDto[]>(loadInvites);
  const reloadBoth = () => {
    reloadMembers();
    reloadInvites();
  };

  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [inviting, setInviting] = useState(false);
  const [roleTarget, setRoleTarget] = useState<MemberDto | null>(null);
  const [nameTarget, setNameTarget] = useState<MemberDto | null>(null);
  const [signOutTarget, setSignOutTarget] = useState<MemberDto | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MemberDto | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InviteDto | null>(null);

  const members = useMemo(
    () => (membersState.status === 'ready' ? membersState.data : []),
    [membersState],
  );
  const invites = useMemo(
    () => (invitesState.status === 'ready' ? invitesState.data : []),
    [invitesState],
  );
  const current = useMemo(() => members.filter((member) => member.removedAt === null), [members]);
  const removed = useMemo(() => members.filter((member) => member.removedAt !== null), [members]);
  const show: Show = params.get('show') === 'removed' && removed.length > 0 ? 'removed' : 'current';
  const shownMembers = show === 'removed' ? removed : current;

  const list = applyListView(shownMembers, {
    search: { query, texts: (member) => [memberName(member), ROLE_LABELS[member.role]] },
    sort,
    accessors: SORT_ACCESSORS,
    page,
    pageSize,
  });

  const changeShow = (next: Show) => {
    setQuery('');
    setPage(1);
    setSort(DEFAULT_SORT);
    setParams(
      () => {
        // The address as it is now: React Router's `previous` is the last rendered one.
        const nextParams = new URLSearchParams(window.location.search);
        if (next === 'removed') nextParams.set('show', 'removed');
        else nextParams.delete('show');
        return nextParams;
      },
      { replace: true },
    );
  };

  const open = (action: MemberAction, member: MemberDto) => {
    if (action === 'role') setRoleTarget(member);
    else if (action === 'name') setNameTarget(member);
    else if (action === 'signOut') setSignOutTarget(member);
    else setRemoveTarget(member);
  };

  const nameColumn: DataTableColumn<MemberDto> = {
    id: 'name',
    header: 'Name',
    sortable: true,
    grow: true,
    cell: (member) => {
      const name = memberName(member);
      const own = member.id.toLowerCase() === actor.id.toLowerCase();
      return (
        <>
          <NameCell
            name={name}
            media={<Avatar name={name} />}
            meta={own ? <span className="tx-users-you">You</span> : undefined}
          />
          {canChange && managedByOwner(actor, member) && (
            <VisuallyHidden>Managed by an Owner</VisuallyHidden>
          )}
        </>
      );
    },
  };
  const roleColumn: DataTableColumn<MemberDto> = {
    id: 'role',
    header: show === 'removed' ? 'Role at removal' : 'Role',
    sortable: true,
    width: '140px',
    cell: (member) => ROLE_LABELS[member.role],
  };
  const columns: readonly DataTableColumn<MemberDto>[] =
    show === 'removed'
      ? [
          nameColumn,
          roleColumn,
          {
            id: 'removed',
            header: 'Removed',
            sortable: true,
            numeric: true,
            width: '140px',
            cell: (member) => (member.removedAt === null ? '' : formatDate(member.removedAt)),
          },
        ]
      : [
          nameColumn,
          roleColumn,
          {
            id: 'signedIn',
            header: 'Signed in',
            sortable: true,
            width: '170px',
            priority: 2,
            cell: (member) =>
              member.firstSignedInAt === null ? (
                <StatusPill tone="neutral">Not signed in yet</StatusPill>
              ) : (
                formatDate(member.firstSignedInAt)
              ),
          },
        ];

  const rowActions = (member: MemberDto) => {
    const actions = memberActions(actor, member);
    if (actions.length === 0) return null;
    const name = memberName(member);
    return (
      <Menu
        placement="bottom-end"
        trigger={(props) => (
          <IconButton
            {...props}
            icon={Ellipsis}
            label={`Actions for ${name}`}
            data-testid="users-row-actions"
          />
        )}
      >
        {actions.includes('role') && (
          <MenuItem
            icon={UserCog}
            onSelect={() => {
              open('role', member);
            }}
          >
            Change role
          </MenuItem>
        )}
        {actions.includes('name') && (
          <MenuItem
            icon={Pencil}
            onSelect={() => {
              open('name', member);
            }}
          >
            Correct name
          </MenuItem>
        )}
        {actions.includes('signOut') && (
          <MenuItem
            icon={LogOut}
            onSelect={() => {
              open('signOut', member);
            }}
          >
            Sign out everywhere
          </MenuItem>
        )}
        {actions.includes('remove') && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={UserMinus}
              tone="danger"
              onSelect={() => {
                open('remove', member);
              }}
            >
              Remove
            </MenuItem>
          </>
        )}
      </Menu>
    );
  };

  const bothLoaded = membersState.status === 'ready' && invitesState.status === 'ready';
  const subtitle = bothLoaded
    ? `${peopleCountLabel(current.length)} · ${inviteCountLabel(invites.length)}`
    : undefined;
  const searching = query.trim() !== '';
  // An Admin manages Editors and Viewers only; say so once, under the list.
  const rankNote = canChange && !canManage(actor.role, 'admin') && show === 'current';

  let people;
  if (membersState.status === 'error') {
    people = (
      <ErrorNotice
        error={membersState.error}
        title="The people could not be loaded"
        onRetry={reloadMembers}
      />
    );
  } else {
    people = (
      <>
        <div className="tx-filter-row">
          <div className="tx-filter-row__filters">
            <SearchField
              label="Search people"
              value={query}
              onChange={(next) => {
                setQuery(next);
                setPage(1);
              }}
              data-testid="users-search"
            />
          </div>
          {canChange && (
            <div className="tx-filter-row__end">
              <Button
                variant="primary"
                icon={UserPlus}
                onClick={() => {
                  setInviting(true);
                }}
                data-testid="users-invite"
              >
                Invite person
              </Button>
            </div>
          )}
        </div>
        <div className="tx-toolbar">
          <p className="tx-toolbar__count" aria-live="polite" data-testid="users-count">
            {membersState.status === 'ready'
              ? searching
                ? `${list.matched.length} of ${peopleCountLabel(shownMembers.length)}`
                : peopleCountLabel(shownMembers.length)
              : ''}
          </p>
          <div className="tx-toolbar__end">
            {removed.length > 0 && (
              <div data-testid="users-show">
                <Segmented<Show>
                  label="Show"
                  size="sm"
                  options={[
                    { value: 'current', label: 'Current' },
                    { value: 'removed', label: `Removed (${removed.length})` },
                  ]}
                  value={show}
                  onChange={changeShow}
                />
              </div>
            )}
            <IconButton
              icon={RefreshCw}
              label="Refresh people and invites"
              onClick={reloadBoth}
              data-testid="users-refresh"
            />
          </div>
        </div>
        {show === 'removed' && (
          <p className="tx-users__note">
            Removed people keep their name in the activity history. To bring someone back, invite
            them again.
          </p>
        )}
        <div data-testid="users-table">
          <DataTable
            caption="People"
            columns={columns}
            rows={list.rows}
            rowId={(member) => member.id}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            rowActions={canChange && show === 'current' ? rowActions : undefined}
            loading={membersState.status === 'loading'}
            loadingRows={4}
            empty={
              <EmptyState
                variant="inline"
                icon={SearchX}
                title="No person matches"
                level={3}
                action={
                  <Button
                    onClick={() => {
                      setQuery('');
                      setPage(1);
                    }}
                  >
                    Clear search
                  </Button>
                }
              >
                No person has those words in their name or role.
              </EmptyState>
            }
            rowTestId={(member) => `users-row-${member.id}`}
            footer={
              list.matched.length > DEFAULT_PAGE_SIZE ? (
                <Pagination
                  info={list.info}
                  label="People pages"
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                />
              ) : undefined
            }
            density="compact"
          />
        </div>
        {rankNote && (
          <p className="tx-users__note">Only an Owner can change or remove Admins and Owners.</p>
        )}
      </>
    );
  }

  const rowFocus: RowFocusSource = {
    mode: 'row',
    order: list.rows.map((member) => member.id),
    row: rowByTestId('users-row-'),
    primary: elementByTestId('users-invite'),
  };

  return (
    <Page title="Users" subtitle={subtitle}>
      <div className="tx-users" data-testid="users-page">
        {membersState.status === 'ready' && membersState.refreshError !== null && (
          <ErrorNotice
            error={membersState.refreshError}
            title="The people could not be refreshed"
            onRetry={reloadMembers}
          />
        )}
        <section className="tx-users__section" aria-labelledby="users-people-title">
          <h2 id="users-people-title" className="tx-h2">
            People
          </h2>
          {people}
        </section>
        <InvitesCard
          invites={invitesState}
          members={membersState.status === 'ready' ? members : null}
          actorRole={actor.role}
          canChange={canChange}
          onCancel={setCancelTarget}
          onRetry={reloadInvites}
        />
      </div>
      <InviteDialog
        open={inviting}
        actorRole={actor.role}
        members={members}
        invites={invites}
        onClose={() => {
          setInviting(false);
        }}
        onSaved={reloadBoth}
      />
      <RoleDialog
        member={roleTarget}
        actorRole={actor.role}
        invites={invites}
        onClose={() => {
          setRoleTarget(null);
        }}
        onChanged={reloadBoth}
      />
      <NameDialog
        member={nameTarget}
        members={members}
        onClose={() => {
          setNameTarget(null);
        }}
        onChanged={reloadBoth}
      />
      <SignOutDialog
        member={signOutTarget}
        onClose={() => {
          setSignOutTarget(null);
        }}
        onChanged={reloadBoth}
        onDone={(name, sessions) => {
          toast.success(`${name} signed out everywhere`, { detail: sessionsEndedLabel(sessions) });
        }}
      />
      <RemoveDialog
        member={removeTarget}
        organisation={session.organization.name}
        invites={invites}
        rowFocus={rowFocus}
        onClose={() => {
          setRemoveTarget(null);
        }}
        onChanged={reloadBoth}
        onDone={(name, sessions) => {
          toast.success(`${name} removed`, { detail: sessionsEndedLabel(sessions) });
        }}
      />
      <CancelInviteDialog
        invite={cancelTarget}
        onClose={() => {
          setCancelTarget(null);
        }}
        onChanged={reloadBoth}
        onDone={(name) => {
          toast.success(`Invite for ${name} cancelled`);
        }}
      />
    </Page>
  );
}

/** A refusal or an unknown outcome the dialog explains in its own words. */
interface Notice {
  readonly title: string;
  readonly message: string;
}

/**
 * The state of a confirm dialog for one object: the object as it was when the dialog opened
 * (it stays while the dialog fades out), whether the request runs, and what went wrong.
 */
function useConfirmState<T>(target: T | null) {
  const [shown, setShown] = useState<T | null>(target);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [previous, setPrevious] = useState<T | null>(target);
  if (target !== previous) {
    setPrevious(target);
    if (target !== null) {
      setShown(target);
      setBusy(false);
      setError(null);
      setNotice(null);
    }
  }
  return { shown, busy, setBusy, error, setError, notice, setNotice };
}

interface MemberConfirmProps {
  readonly member: MemberDto | null;
  readonly onClose: () => void;
  /** The lists on the page are out of date: after a change, or a refusal that says so. */
  readonly onChanged: () => void;
  readonly onDone: (name: string, sessionsEnded: number) => void;
}

/** "Sign out everywhere": ends every session the person has open. Their role stays. */
function SignOutDialog({ member, onClose, onChanged, onDone }: MemberConfirmProps) {
  const state = useConfirmState(member);
  const name = state.shown === null ? '' : memberName(state.shown);

  const confirm = () => {
    if (state.busy || state.shown === null) return;
    const target = state.shown;
    state.setBusy(true);
    state.setError(null);
    api.signOutMember(target.id).then(
      (answer) => {
        state.setBusy(false);
        onChanged();
        onClose();
        onDone(memberName(target), answer.sessionsEnded);
      },
      (reason: unknown) => {
        state.setBusy(false);
        state.setError(reason);
        if (isApiRequestError(reason) && reason.code === 'conflict') onChanged();
      },
    );
  };

  return (
    <ConfirmDialog
      open={member !== null}
      title={`Sign ${name} out everywhere?`}
      confirmLabel="Sign out everywhere"
      busy={state.busy}
      onConfirm={confirm}
      onCancel={onClose}
      testId="users-sign-out-dialog"
    >
      <p>
        Every TINNOX CMS session {name} has open ends now, in every browser. Anything they have not
        saved is lost. Their next sign-in asks for their password and one-time code. Their role does
        not change.
      </p>
      {state.error !== null && (
        <ErrorNotice error={state.error} title={`${name} was not signed out`} />
      )}
    </ConfirmDialog>
  );
}

/** "Remove": the person is signed out and can no longer use TINNOX CMS here. */
function RemoveDialog({
  member,
  organisation,
  invites,
  rowFocus,
  onClose,
  onChanged,
  onDone,
}: MemberConfirmProps & {
  readonly organisation: string;
  /** Pending invites as last loaded, to say how many the removal cancels. */
  readonly invites: readonly InviteDto[];
  readonly rowFocus: RowFocusSource;
}) {
  const state = useConfirmState(member);
  const open = member !== null;
  const returnFocus = useRowFocusReturn(open, member === null ? [] : [member.id], rowFocus);
  const name = state.shown === null ? '' : memberName(state.shown);
  // Follows the lists while open; kept while the dialog fades out, so its text does not
  // change when the lists are read again after the removal.
  const liveCount = state.shown === null ? 0 : invitesCancelledBy(invites, state.shown.id, null);
  const [closingCount, setClosingCount] = useState(liveCount);
  if (open && closingCount !== liveCount) setClosingCount(liveCount);
  const invitesToCancel = open ? liveCount : closingCount;

  const confirm = () => {
    if (state.busy || state.shown === null) return;
    const target = state.shown;
    state.setBusy(true);
    state.setError(null);
    state.setNotice(null);
    api.removeMember(target.id).then(
      (answer) => {
        state.setBusy(false);
        onChanged();
        onClose();
        onDone(memberName(target), answer.sessionsEnded);
      },
      (reason: unknown) => {
        state.setBusy(false);
        // Neither notice says "was not removed": the person may have been removed, or already was.
        if (isOutcomeUnknown(reason)) {
          state.setNotice({
            title: 'The removal could not be confirmed',
            message: `The server may or may not have removed ${memberName(target)}. The lists were refreshed; check them before you try again.`,
          });
          onChanged();
          return;
        }
        if (isApiRequestError(reason) && reason.code === 'conflict') {
          state.setNotice({ title: 'The list was out of date', message: reason.message });
          onChanged();
          return;
        }
        state.setError(reason);
      },
    );
  };

  return (
    <ConfirmDialog
      open={open}
      title={`Remove ${name}?`}
      confirmLabel="Remove person"
      tone="danger"
      busy={state.busy}
      onConfirm={confirm}
      onCancel={onClose}
      testId="users-remove-dialog"
      returnFocus={returnFocus}
    >
      <p data-testid="users-remove-consequence">
        {removeConsequence(name, organisation, invitesToCancel)}
      </p>
      {state.notice !== null && (
        <Banner tone="danger" live="assertive" title={state.notice.title}>
          <p>{state.notice.message}</p>
        </Banner>
      )}
      {state.error !== null && (
        <ErrorNotice error={state.error} title={`${name} was not removed`} />
      )}
    </ConfirmDialog>
  );
}

/** "Cancel invite": TINNOX will not set the person up; their details are deleted now. */
function CancelInviteDialog({
  invite,
  onClose,
  onChanged,
  onDone,
}: {
  readonly invite: InviteDto | null;
  readonly onClose: () => void;
  readonly onChanged: () => void;
  readonly onDone: (name: string) => void;
}) {
  const state = useConfirmState(invite);
  const name = state.shown?.name ?? '';

  const confirm = () => {
    if (state.busy || state.shown === null) return;
    const target = state.shown;
    state.setBusy(true);
    state.setError(null);
    state.setNotice(null);
    api.cancelInvite(target.id).then(
      () => {
        state.setBusy(false);
        onChanged();
        onClose();
        onDone(target.name);
      },
      (reason: unknown) => {
        state.setBusy(false);
        if (isApiRequestError(reason) && reason.code === 'conflict') {
          state.setNotice({
            title: 'The invite was not cancelled',
            message: `This invite is no longer waiting. TINNOX may have just set ${target.name} up; the lists were refreshed.`,
          });
          onChanged();
          return;
        }
        // The server may have cancelled it: read the lists again, so the page shows it.
        if (isOutcomeUnknown(reason)) onChanged();
        state.setError(reason);
      },
    );
  };

  return (
    <ConfirmDialog
      open={invite !== null}
      title={`Cancel the invite for ${name}?`}
      confirmLabel="Cancel invite"
      cancelLabel="Keep invite"
      tone="danger"
      busy={state.busy}
      onConfirm={confirm}
      onCancel={onClose}
      testId="users-invite-cancel-dialog"
      returnFocus={inviteFocusAfterCancel}
    >
      <p>
        TINNOX will not set up {name}. Their name and work e-mail address are deleted from the
        invite now. You can invite them again later.
      </p>
      {state.notice !== null && (
        <Banner tone="danger" live="assertive" title={state.notice.title}>
          <p>{state.notice.message}</p>
        </Banner>
      )}
      {state.error !== null && (
        <ErrorNotice
          error={state.error}
          title={
            isOutcomeUnknown(state.error)
              ? 'The cancellation could not be confirmed'
              : 'The invite was not cancelled'
          }
        />
      )}
    </ConfirmDialog>
  );
}

/**
 * Where focus goes once a cancelled invite's row is gone: the Cancel button of an invite still
 * waiting, else "Invite person", rather than the top of the page.
 */
function inviteFocusAfterCancel(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-testid="users-invite-row-cancel"]') ??
    elementByTestId('users-invite')()
  );
}
