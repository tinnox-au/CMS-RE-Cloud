import {
  ABSOLUTE,
  inviteReference,
  type InviteDto,
  type InviteRole,
  type MemberDto,
  type Role,
} from '@tinnox/contracts';
import { grantableRoles } from '@tinnox/domain';
import { useId, useRef, useState, type FormEvent } from 'react';
import { isApiRequestError, isOutcomeUnknown } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import {
  inviteEmailProblem,
  inviteNameProblem,
  inviteRoleChoices,
  memberRefusal,
} from '../../lib/users.ts';
import { Button, Dialog, ErrorNotice, Field, TextInput, useToast } from '../../ui/index.ts';
import { RoleChoices } from './RoleChoices.tsx';
import './users.css';

export interface InviteDialogProps {
  readonly open: boolean;
  /** The signed-in member's role: the roles they may invite with (the rank rule). */
  readonly actorRole: Role;
  /** As last loaded, to refuse a name in use before sending; the API checks again. */
  readonly members: readonly MemberDto[];
  readonly invites: readonly InviteDto[];
  readonly onClose: () => void;
  /** After the server stored the invite, or may have; the page reloads its lists. */
  readonly onSaved: () => void;
}

type FieldName = 'name' | 'email';

/**
 * "Invite person": the name, the work e-mail address and the role of someone TINNOX is to set
 * up. TINNOX CMS sends no e-mail; the request waits for TINNOX, who sets the person up and
 * sends their sign-in details. Problems the page can see are shown at the field before
 * anything is sent; the server's field refusals land on the same fields.
 */
export function InviteDialog({
  open,
  actorRole,
  members,
  invites,
  onClose,
  onSaved,
}: InviteDialogProps) {
  const toast = useToast();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('viewer');
  const [submitted, setSubmitted] = useState(false);
  const [serverProblem, setServerProblem] = useState<{
    readonly field: FieldName;
    readonly message: string;
  } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Every opening starts afresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setEmail('');
      setRole('viewer');
      setSubmitted(false);
      setServerProblem(null);
      setError(null);
      setBusy(false);
    }
  }

  const nameProblem = inviteNameProblem(name, members, invites);
  const emailProblem = inviteEmailProblem(email);
  const shown = (field: FieldName, local: string | null): string | undefined => {
    if (serverProblem?.field === field) return serverProblem.message;
    return submitted ? (local ?? undefined) : undefined;
  };
  const focus = (field: FieldName) => {
    (field === 'name' ? nameRef : emailRef).current?.focus();
  };

  const choices = inviteRoleChoices(actorRole).map((option) => ({
    role: option,
    current: false,
    disabledReason: null,
  }));
  const ownerNote = grantableRoles(actorRole, 'change').includes('owner');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setServerProblem(null);
    if (nameProblem !== null) {
      focus('name');
      return;
    }
    if (emailProblem !== null) {
      focus('email');
      return;
    }
    setError(null);
    setBusy(true);
    api.createInvite({ name: name.trim(), email: email.trim(), role }).then(
      (created) => {
        setBusy(false);
        onSaved();
        onClose();
        toast.success(`Invite for ${created.name} saved`, {
          detail: `Waiting for TINNOX. Reference ${inviteReference(created.id)}.`,
        });
      },
      (reason: unknown) => {
        setBusy(false);
        const refusal =
          isApiRequestError(reason) &&
          (reason.code === 'conflict' || reason.code === 'validation_failed')
            ? memberRefusal(reason)
            : null;
        if (refusal !== null && (refusal.field === 'name' || refusal.field === 'email')) {
          setServerProblem({ field: refusal.field, message: refusal.message });
          focus(refusal.field);
          return;
        }
        // The server may have stored it: read the lists again, so the page shows the invite and
        // a second try meets the name check here instead of a clash with itself.
        if (isOutcomeUnknown(reason)) onSaved();
        setError(reason);
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title="Invite person"
      description="TINNOX sets the person up and sends them their sign-in details. TINNOX CMS sends no e-mail."
      busy={busy}
      testId="users-invite-dialog"
      footer={
        <>
          <Button onClick={onClose} aria-disabled={busy || undefined}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            busy={busy}
            data-testid="users-invite-submit"
          >
            Request invite
          </Button>
        </>
      }
    >
      <form id={formId} className="tx-users-form" noValidate onSubmit={submit}>
        {error !== null && (
          <ErrorNotice
            error={error}
            title={
              isOutcomeUnknown(error)
                ? 'The invite could not be confirmed'
                : 'The invite was not saved'
            }
            onDismiss={() => {
              setError(null);
            }}
          />
        )}
        <Field
          label="Name"
          required
          error={shown('name', nameProblem)}
          hint="Up to 120 characters, as it should appear in TINNOX CMS. No two people here can share a name."
        >
          {(control) => (
            <TextInput
              {...control}
              ref={nameRef}
              value={name}
              width="full"
              maxLength={ABSOLUTE.maxNameLength + 20}
              autoComplete="off"
              data-autofocus
              readOnly={busy}
              onChange={(event) => {
                setName(event.target.value);
                if (serverProblem?.field === 'name') setServerProblem(null);
              }}
              data-testid="users-invite-name"
            />
          )}
        </Field>
        <Field
          label="Work e-mail"
          required
          error={shown('email', emailProblem)}
          hint="TINNOX uses it once, to set up the sign-in account. It is deleted when the invite closes."
        >
          {(control) => (
            <TextInput
              {...control}
              ref={emailRef}
              type="email"
              inputMode="email"
              spellCheck={false}
              autoComplete="off"
              value={email}
              width="full"
              maxLength={274}
              readOnly={busy}
              onChange={(event) => {
                setEmail(event.target.value);
                if (serverProblem?.field === 'email') setServerProblem(null);
              }}
              data-testid="users-invite-email"
            />
          )}
        </Field>
        <RoleChoices
          choices={choices}
          value={role}
          onChange={(next) => {
            // The choices are invite roles only.
            if (next !== 'owner') setRole(next);
          }}
          disabled={busy}
          testIdPrefix="users-invite-role-"
          note={
            ownerNote
              ? 'To make someone an Owner, invite them as an Admin and promote them after their first sign-in.'
              : undefined
          }
        />
      </form>
    </Dialog>
  );
}
