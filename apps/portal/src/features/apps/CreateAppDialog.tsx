import { ABSOLUTE, APP_TYPES, type AppType } from '@tinnox/contracts';
import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/index.ts';
import { APP_TYPE_DESCRIPTIONS, APP_TYPE_LABELS, defaultContent } from '../../lib/apps.ts';
import { nameProblem } from '../../lib/playlistEditor.ts';
import { Button, Dialog, ErrorNotice, Field, Icon, TextInput, useToast } from '../../ui/index.ts';
import { APP_TYPE_ICONS } from './appIcons.ts';
import './apps.css';

export interface CreateAppDialogProps {
  readonly open: boolean;
  /** Cancel, Escape and the close button. After a successful create the editor opens instead. */
  readonly onClose: () => void;
}

/**
 * Asks for the type and the name of a new app, creates it with the type's starting content
 * and opens its editor. The type is a group of native radio buttons drawn as cards: one tab
 * stop, the arrow keys move the choice, Space or Enter picks the focused card. The name
 * follows the type until the operator types one.
 */
export function CreateAppDialog({ open, onClose }: CreateAppDialogProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const formId = useId();
  const [type, setType] = useState<AppType>('clock');
  const [name, setName] = useState(APP_TYPE_LABELS.clock);
  const [nameEdited, setNameEdited] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Every opening starts afresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setType('clock');
      setName(APP_TYPE_LABELS.clock);
      setNameEdited(false);
      setProblem(undefined);
      setError(null);
      setBusy(false);
    }
  }

  const choose = (next: AppType) => {
    setType(next);
    if (!nameEdited) setName(APP_TYPE_LABELS[next]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const invalid = nameProblem(name);
    if (invalid !== null) {
      setProblem(invalid);
      return;
    }
    setProblem(undefined);
    setError(null);
    setBusy(true);
    api.createApp({ name: name.trim(), content: defaultContent(type, Date.now()) }).then(
      (created) => {
        // The page, and this dialog with it, is left for the editor.
        void navigate(`/apps/${created.id}`);
        toast.success('App created');
      },
      (reason: unknown) => {
        setError(reason);
        setBusy(false);
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title="Create app"
      description="Choose what the app shows. You set it up in the editor, which opens next."
      busy={busy}
      testId="apps-create-dialog"
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
            data-testid="apps-create-submit"
          >
            Create app
          </Button>
        </>
      }
    >
      <form id={formId} className="tx-stack" noValidate onSubmit={submit}>
        {error !== null && <ErrorNotice error={error} title="The app was not created" />}
        <fieldset className="tx-app-types">
          <legend className="tx-field__label">Type</legend>
          <div className="tx-app-types__grid">
            {APP_TYPES.map((option) => (
              <label
                key={option}
                className="tx-app-type"
                data-testid={`apps-create-type-${option}`}
              >
                <input
                  type="radio"
                  name={`${formId}-type`}
                  value={option}
                  className="tx-visually-hidden"
                  checked={type === option}
                  disabled={busy}
                  data-autofocus={type === option || undefined}
                  onChange={() => {
                    choose(option);
                  }}
                  onKeyDown={(event) => {
                    // Enter picks the card instead of submitting the form.
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    choose(option);
                  }}
                />
                <span className="tx-app-type__icon">
                  <Icon icon={APP_TYPE_ICONS[option]} />
                </span>
                <span className="tx-app-type__label">{APP_TYPE_LABELS[option]}</span>
                <span className="tx-app-type__text">{APP_TYPE_DESCRIPTIONS[option]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Name" error={problem} required>
          {(control) => (
            <TextInput
              {...control}
              value={name}
              width="full"
              maxLength={ABSOLUTE.maxNameLength}
              autoComplete="off"
              readOnly={busy}
              data-testid="apps-create-name"
              onChange={(event) => {
                setName(event.target.value);
                setNameEdited(true);
                if (problem !== undefined) setProblem(undefined);
              }}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
