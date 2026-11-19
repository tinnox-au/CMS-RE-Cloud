import { ABSOLUTE, type MemberDto } from '@tinnox/contracts';
import { useId, useRef, useState, type FormEvent } from 'react';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { memberName, memberNameProblem, memberRefusal } from '../../lib/users.ts';
import { Banner, Button, Dialog, ErrorNotice, Field, TextInput, useToast } from '../../ui/index.ts';
import './users.css';

export interface NameDialogProps {
  /** The member to rename; null keeps the dialog closed. Read when it opens. */
  readonly member: MemberDto | null;
  /** Every member as last loaded, removed ones included: a name used before is refused. */
  readonly members: readonly MemberDto[];
  readonly onClose: () => void;
  /** After the server changed the name, or the lists turned out to be out of date. */
  readonly onChanged: () => void;
}

/**
 * Corrects a member's name. The new name shows everywhere, for past events too, and the audit
 * log marks the person as renamed. A name another member has, or had, is refused at the field.
 */
export function NameDialog({ member, members, onClose, onChanged }: NameDialogProps) {
  const toast = useToast();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const open = member !== null;
  const [current, setCurrent] = useState<MemberDto | null>(member);
  const [name, setName] = useState(member?.displayName ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [serverProblem, setServerProblem] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
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
      setRefusal(null);
      setError(null);
      setBusy(false);
    }
  }

  const unchanged = current !== null && name.trim() === (current.displayName ?? '');
  const localProblem = current === null ? null : memberNameProblem(name, members, current.id);
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
    setRefusal(null);
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
            setRefusal(words.message);
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
      title={current === null ? 'Correct name' : `Correct the name of ${memberName(current)}`}
      description="The new name shows here, in activity and in the audit log, for past events too. The audit log marks the person as renamed."
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
        {refusal !== null && (
          <Banner tone="danger" live="assertive" title="The name was not changed">
            <p>{refusal}</p>
          </Banner>
        )}
        {error !== null && (
          <ErrorNotice
            error={error}
            title="The name was not changed"
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
