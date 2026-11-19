import { inviteReference, type InviteDto, type MemberDto, type Role } from '@tinnox/contracts';
import { canManage, ROLE_LABELS } from '@tinnox/domain';
import { useId } from 'react';
import type { LoadState } from '../../hooks/useLoad.ts';
import { formatDate, inviteExpired, inviteRequestedLabel } from '../../lib/users.ts';
import { Inbox } from '../../ui/icons.ts';
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorNotice,
  NameCell,
  StatusPill,
  VisuallyHidden,
  type DataTableColumn,
} from '../../ui/index.ts';
import './users.css';

export interface InvitesCardProps {
  readonly invites: LoadState<InviteDto[]>;
  /** The people as last loaded, to name who requested each invite; null while unknown. */
  readonly members: readonly MemberDto[] | null;
  readonly actorRole: Role;
  /** The signed-in member holds `member.manage`. */
  readonly canChange: boolean;
  readonly onCancel: (invite: InviteDto) => void;
  readonly onRetry: () => void;
}

/**
 * The invites waiting for TINNOX, oldest first. The work e-mail address shows only here, under
 * the name, and is deleted when the invite closes. Each row carries the reference staff and
 * customers quote. An invite past its expiry stays listed until TINNOX's daily run closes it.
 */
export function InvitesCard({
  invites,
  members,
  actorRole,
  canChange,
  onCancel,
  onRetry,
}: InvitesCardProps) {
  const titleId = useId();
  // shortcut: expiry is judged at render, so an invite that expires while the page is open
  // reads "Waiting" until the next refresh; tick a clock here if people keep the page open.
  const now = Date.now();

  const columns: readonly DataTableColumn<InviteDto>[] = [
    {
      id: 'name',
      header: 'Name',
      grow: true,
      cell: (invite) => (
        <NameCell
          name={invite.name}
          // NameCell gives only a text `meta` a title; a long address is cut short.
          meta={
            <span translate="no" title={invite.email}>
              {invite.email}
            </span>
          }
        />
      ),
    },
    {
      id: 'role',
      header: 'Role',
      width: '96px',
      cell: (invite) => ROLE_LABELS[invite.role],
    },
    {
      id: 'status',
      header: 'Status',
      width: '200px',
      cell: (invite) =>
        inviteExpired(invite, now) ? (
          <StatusPill tone="neutral">Expired, TINNOX will close it</StatusPill>
        ) : (
          <span className="tx-users-status">
            <StatusPill tone="warn">Waiting for TINNOX</StatusPill>
            <span className="tx-users-status__ref">
              <VisuallyHidden>Reference </VisuallyHidden>
              <span className="tx-mono" translate="no">
                {inviteReference(invite.id)}
              </span>
            </span>
          </span>
        ),
    },
    {
      id: 'requested',
      header: 'Requested',
      width: '200px',
      priority: 3,
      cell: (invite) => inviteRequestedLabel(invite, members),
    },
    {
      id: 'expires',
      header: 'Expires',
      numeric: true,
      width: '120px',
      priority: 2,
      cell: (invite) => formatDate(invite.expiresAt),
    },
  ];

  const cancelButton = (invite: InviteDto) =>
    canChange && canManage(actorRole, invite.role) ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onCancel(invite);
        }}
        data-testid="users-invite-row-cancel"
      >
        Cancel
        <VisuallyHidden> invite for {invite.name}</VisuallyHidden>
      </Button>
    ) : null;

  let body;
  if (invites.status === 'error') {
    body = (
      <div className="tx-users-invites__state">
        <ErrorNotice
          error={invites.error}
          title="The invites could not be loaded"
          onRetry={onRetry}
        />
      </div>
    );
  } else if (invites.status === 'ready' && invites.data.length === 0) {
    body = (
      <EmptyState variant="inline" icon={Inbox} title="No invites waiting" level={3}>
        Invites you request appear here until TINNOX sets the person up.
      </EmptyState>
    );
  } else {
    // shortcut: the invites table is not paged (at most ABSOLUTE.maxPendingInvites, 100);
    // page it as the people table if that cap is raised.
    body = (
      <DataTable
        caption="Pending invites"
        columns={columns}
        rows={invites.status === 'ready' ? invites.data : []}
        rowId={(invite) => invite.id}
        rowActions={canChange ? cancelButton : undefined}
        loading={invites.status === 'loading'}
        loadingRows={2}
        rowTestId={(invite) => `users-invite-row-${invite.id}`}
        density="compact"
      />
    );
  }
  // Above the list or the empty state alike: "No invites waiting" may be out of date.
  const refreshNotice =
    invites.status === 'ready' && invites.refreshError !== null ? (
      <div className="tx-users-invites__state">
        <ErrorNotice
          error={invites.refreshError}
          title="The invites could not be refreshed"
          onRetry={onRetry}
        />
      </div>
    ) : null;

  return (
    <Card as="section" flush aria-labelledby={titleId} data-testid="users-invites">
      <div className="tx-users-invites__header">
        <CardHeader
          id={titleId}
          title="Pending invites"
          size="title"
          description="TINNOX sets up each person within one business day and sends them their sign-in details. TINNOX CMS sends no e-mail. Contact support if it is urgent."
        />
      </div>
      {refreshNotice}
      {body}
    </Card>
  );
}
