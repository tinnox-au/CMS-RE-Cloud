import { ABSOLUTE, type InviteDto, type MemberDto } from '@tinnox/contracts';
import { useId, useRef, useState, type FormEvent } from 'react';
import { isApiRequestError, isOutcomeUnknown } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { memberLabel, memberNameProblem, memberRefusal } from '../../lib/users.ts';
import { Banner, Button, Dialog, ErrorNotice, Field, TextInput, useToast } from '../../ui/index.ts';
import './users.css';

export interface NameDialogProps {
  /** The member to rename; null keeps the dialog closed. Read when it opens. */
  readonly member: MemberDto | null;
  /** Every member as last loaded, removed ones included: a name used before is refused. */
  readonly members: readonly MemberDto[];
  /** Pending invites as last loaded: their names are taken until TINNOX closes them. */
  readonly invites: readonly InviteDto[];
  readonly onClose: () => void;
  /** After the server changed the name, or the lists turned out to be out of date. */
  readonly onChanged: () => void;
}

const NOT_CHANGED = 'The name was not changed';

/** A refusal, or an answer that never came, said in the dialog. */
interface Notice {
  readonly title: string;
  readonly message: string;
}

/**
 * Corrects a member's name, or gives an unnamed member their first one. The new name shows
 * everywhere, for past events too. Only a correction of a set name is marked "renamed" in the
 * audit log (membership.display_name_changed_at, migration 0013), so the dialog says so only
 * then. A name another member has, or had, is refused at the field.
 */
export function NameDialog({ member, members, invites, onClose, onChanged }: NameDialogProps) {
  const toast = useToast();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const open = member !== null;
  const [current, setCurrent] = useState<MemberDto | null>(member);
  const [name, setName] = useState(member?.displayName ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [serverProblem, setServerProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (member !== null) {
      setCurrent(member);
      setName(member.displayName ?? '');
      setSubmitted(false);
      setServerProblem(null);
      setNotice(null);
      setError(null);
      setBusy(false);
    }
  }

  const unchanged = current !== null && name.trim() === (current.displayName ?? '');
  const localProblem =
    current === null ? null : memberNameProblem(name, members, invites, current.id);
  const fieldError = serverProblem ?? (submitted ? (localProblem ?? undefined) : undefined);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || current === null || unchanged) return;
    setSubmitted(true);
    if (localProblem !== null) {
      inputRef.current?.focus();
      return;
    }
    const target = current;
    const next = name.trim();
    setServerProblem(null);
    setNotice(null);
    setError(null);
    setBusy(true);
    api.patchMember(target.id, { displayName: next }).then(
      () => {
        setBusy(false);
        onChanged();
        onClose();
        toast.success(`Name changed to “${next}”`);
      },
      (reason: unknown) => {
        setBusy(false);
        // The answer may be lost after the server made the change: never say it was not made.
        if (isOutcomeUnknown(reason)) {
          setNotice({
            title: 'The name change could not be confirmed',
            message: `The server may or may not have changed the name to “${next}”. The lists were refreshed; check them before you try again.`,
          });
          onChanged();
          return;
        }
        if (
          isApiRequestError(reason) &&
          (reason.code === 'conflict' || reason.code === 'validation_failed')
        ) {
          const words = memberRefusal(reason);
          if (words.field === 'displayName') {
            setServerProblem(words.message);
            inputRef.current?.focus();
            return;
          }
          if (reason.code === 'conflict') {
            // Removed meanwhile, for example: the lists on the page are out of date.
            setNotice({ title: NOT_CHANGED, message: words.message });
            onChanged();
            return;
          }
        }
        setError(reason);
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={current === null ? 'Correct name' : `Correct the name of ${memberLabel(current)}`}
      description={
        current !== null && current.displayName !== null
          ? 'The new name shows here, in activity and in the audit log, for past events too. The audit log marks the person as renamed.'
          : 'The name shows here, in activity and in the audit log, for past events too.'
      }
      busy={busy}
      testId="users-name-dialog"
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
            aria-disabled={unchanged || undefined}
            data-testid="users-name-save"
          >
            Save name
          </Button>
        </>
      }
    >
      <form id={formId} className="tx-users-form" noValidate onSubmit={submit}>
        {notice !== null && (
          <Banner tone="danger" live="assertive" title={notice.title}>
            <p>{notice.message}</p>
          </Banner>
        )}
        {error !== null && (
          <ErrorNotice
            error={error}
            title={NOT_CHANGED}
            onDismiss={() => {
              setError(null);
            }}
          />
        )}
        <Field
          label="Name"
          required
          error={fieldError}
          hint={fieldError === undefined ? 'Up to 120 characters.' : undefined}
        >
          {(control) => (
            <TextInput
              {...control}
              ref={inputRef}
              value={name}
              maxLength={ABSOLUTE.maxNameLength + 20}
              autoComplete="off"
              data-autofocus
              readOnly={busy}
              onChange={(event) => {
                setName(event.target.value);
                setServerProblem(null);
              }}
              data-testid="users-name-input"
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
