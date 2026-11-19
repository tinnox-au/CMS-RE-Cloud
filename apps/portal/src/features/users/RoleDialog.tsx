import type { InviteDto, MemberDto, Role } from '@tinnox/contracts';
import { isDemotion, ROLE_LABELS } from '@tinnox/domain';
import { useState } from 'react';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import {
  invitesCancelledBy,
  memberName,
  memberRefusal,
  roleChangeConsequence,
  roleChoices,
  roleWithArticle,
  sessionsEndedLabel,
} from '../../lib/users.ts';
import { Banner, Button, Dialog, ErrorNotice, useToast } from '../../ui/index.ts';
import { RoleChoices } from './RoleChoices.tsx';
import './users.css';

export interface RoleDialogProps {
  /** The member whose role changes; null keeps the dialog closed. Read when it opens. */
  readonly member: MemberDto | null;
  /** The signed-in member's role: the roles they may give (the rank rule). */
  readonly actorRole: Role;
  /** Pending invites as last loaded, to say which ones a demotion cancels. */
  readonly invites: readonly InviteDto[];
  readonly onClose: () => void;
  /** After the server changed something, or the lists turned out to be out of date. */
  readonly onChanged: () => void;
}

/**
 * Changes a member's role: the roles the actor may give as radio cards, the current one
 * marked, and what the change does said before it is made. A demotion signs the person out
 * everywhere and cancels the invites their new role could not send, so its button is red.
 * The last Owner and an Owner for someone who never signed in are explained in the dialog.
 */
export function RoleDialog({ member, actorRole, invites, onClose, onChanged }: RoleDialogProps) {
  const toast = useToast();
  const open = member !== null;
  // The member as it was when the dialog opened; it stays while the dialog fades out.
  const [current, setCurrent] = useState<MemberDto | null>(member);
  const [role, setRole] = useState<Role>(member?.role ?? 'viewer');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (member !== null) {
      setCurrent(member);
      setRole(member.role);
      setRefusal(null);
      setError(null);
      setBusy(false);
    }
  }

  const name = current === null ? '' : memberName(current);
  const from = current?.role ?? role;
  const unchanged = role === from;
  const demotion = isDemotion(from, role);
  const cancels =
    current === null ? 0 : demotion ? invitesCancelledBy(invites, current.id, role) : 0;
  const choices = current === null ? [] : roleChoices(actorRole, current);

  const save = () => {
    if (busy || current === null || unchanged) return;
    const target = current;
    const to = role;
    setBusy(true);
    setRefusal(null);
    setError(null);
    api.patchMember(target.id, { role: to }).then(
      (answer) => {
        setBusy(false);
        onChanged();
        onClose();
        toast.success(`${name} is now ${roleWithArticle(to)}`, {
          ...(isDemotion(from, to) ? { detail: sessionsEndedLabel(answer.sessionsEnded) } : {}),
        });
      },
      (reason: unknown) => {
        setBusy(false);
        if (isApiRequestError(reason) && reason.code === 'last_owner') {
          setRefusal(memberRefusal(reason).message);
          return;
        }
        if (isApiRequestError(reason) && reason.code === 'conflict') {
          const words = memberRefusal(reason);
          setRefusal(words.message);
          // Not an Owner yet is about this choice; anything else (removed meanwhile) means
          // the lists on the page are out of date.
          if (words.field !== 'role') onChanged();
          return;
        }
        setError(reason);
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={`Change role for ${name}`}
      busy={busy}
      testId="users-role-dialog"
      footer={
        <>
          <Button onClick={onClose} aria-disabled={busy || undefined}>
            Cancel
          </Button>
          <Button
            variant={demotion ? 'danger-solid' : 'primary'}
            busy={busy}
            aria-disabled={unchanged || undefined}
            onClick={save}
            data-testid="users-role-save"
          >
            {`Make ${ROLE_LABELS[role]}`}
          </Button>
        </>
      }
    >
      {current !== null && (
        <div className="tx-users-form">
          {refusal !== null && (
            <Banner tone="danger" live="assertive" title="The role was not changed">
              <p>{refusal}</p>
            </Banner>
          )}
          {error !== null && (
            <ErrorNotice
              error={error}
              title="The role was not changed"
              onDismiss={() => {
                setError(null);
              }}
            />
          )}
          <RoleChoices
            choices={choices}
            value={role}
            onChange={(next) => {
              setRole(next);
              setRefusal(null);
            }}
            disabled={busy}
            testIdPrefix="users-role-"
          />
          <p
            className="tx-users-consequence"
            aria-live="polite"
            data-testid="users-role-consequence"
          >
            {roleChangeConsequence(name, from, role, cancels)}
          </p>
        </div>
      )}
    </Dialog>
  );
}
