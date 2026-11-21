import { ALERT_CONFIRM_TTL_DAYS, AlertEmailSchema } from '@tinnox/contracts';
import { useId, useRef, useState, type FormEvent } from 'react';
import { isApiRequestError, isOutcomeUnknown } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { inviteEmailProblem } from '../../lib/users.ts';
import { Button, Dialog, ErrorNotice, Field, TextInput, useToast } from '../../ui/index.ts';

export interface AddAlertAddressDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** After the server stored the address, or may have; the page reads the list again. */
  readonly onSaved: () => void;
}

/** Nothing was stored: the server cannot send e-mail. */
const mailNotConfigured = (error: unknown): boolean =>
  isApiRequestError(error) && error.code === 'mail_not_configured';

/**
 * "Add address": one e-mail address for the organisation's alert list. The server sends it a
 * confirmation link; it receives no alert until its owner opens that link.
 */
export function AddAlertAddressDialog({ open, onClose, onSaved }: AddAlertAddressDialogProps) {
  const toast = useToast();
  const formId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [serverProblem, setServerProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Every opening starts afresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEmail('');
      setSubmitted(false);
      setServerProblem(null);
      setError(null);
      setBusy(false);
    }
  }

  // The API's check: an invite address without name, group, list or quoted forms.
  const problem =
    email.trim() === ''
      ? 'Enter an e-mail address.'
      : (inviteEmailProblem(email) ??
        (AlertEmailSchema.safeParse(email).success
          ? null
          : 'Enter a plain address like name@example.com, without spaces or < > ( ) [ ] \\ , ; : ".'));
  const shown = serverProblem ?? (submitted ? (problem ?? undefined) : undefined);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setServerProblem(null);
    if (problem !== null) {
      emailRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    api.addAlertRecipient(email.trim()).then(
      (created) => {
        setBusy(false);
        onSaved();
        onClose();
        toast.success(`Confirmation e-mail sent to ${created.email}`, {
          detail: `It receives alerts once its owner opens the link, within ${ALERT_CONFIRM_TTL_DAYS} days.`,
        });
      },
      (reason: unknown) => {
        setBusy(false);
        if (isApiRequestError(reason) && reason.details.some((d) => d.path === 'email')) {
          setServerProblem(
            reason.code === 'conflict'
              ? 'This address is already on the alert list.'
              : 'The server did not accept this address. Enter one like name@example.com.',
          );
          emailRef.current?.focus();
          return;
        }
        // Stored, but its link was not sent: the list shows it waiting; say so and close.
        if (isApiRequestError(reason) && reason.code === 'confirmation_not_sent') {
          onSaved();
          onClose();
          toast.warn(
            `${email.trim().toLowerCase()} was added, but its confirmation e-mail was not sent`,
            {
              detail: 'Remove the address and add it again later.',
            },
          );
          return;
        }
        // The address may be stored after any other server error or a lost answer.
        if (isOutcomeUnknown(reason) && !mailNotConfigured(reason)) onSaved();
        setError(reason);
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title="Add address"
      description="Screen alerts go to every confirmed address on the list."
      busy={busy}
      testId="settings-alerts-add-dialog"
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
            data-testid="settings-alerts-add-submit"
          >
            Add address
          </Button>
        </>
      }
    >
      <form id={formId} className="tx-stack" noValidate onSubmit={submit}>
        {error !== null && (
          <ErrorNotice
            error={error}
            title={
              isOutcomeUnknown(error) && !mailNotConfigured(error)
                ? 'The address may not have been added'
                : 'The address was not added'
            }
            onDismiss={() => {
              setError(null);
            }}
          />
        )}
        <Field
          label="E-mail address"
          required
          error={shown}
          hint={`Its owner receives a link to confirm it, valid for ${ALERT_CONFIRM_TTL_DAYS} days. Nothing else is sent until then.`}
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
              data-autofocus
              readOnly={busy}
              onChange={(event) => {
                setEmail(event.target.value);
                setServerProblem(null);
              }}
              data-testid="settings-alerts-add-email"
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
