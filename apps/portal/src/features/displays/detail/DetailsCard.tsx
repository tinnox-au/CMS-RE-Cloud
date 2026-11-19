import type { DisplayDto, SiteDto } from '@tinnox/contracts';
import { useState, type FormEvent } from 'react';
import { api } from '../../../api/index.ts';
import {
  descriptionCountLabel,
  SCREEN_NAME_MAX,
  screenDetailsDirty,
  screenDetailsOf,
  validateScreenDetails,
  type ScreenDetailsErrors,
  type ScreenDetailsValues,
} from '../../../lib/screenDetail.ts';
import { formatTimestamp } from '../../../lib/format.ts';
import { Copy } from '../../../ui/icons.ts';
import {
  Button,
  Card,
  CardHeader,
  ErrorNotice,
  Fact,
  Facts,
  Field,
  IconButton,
  TextInput,
  Textarea,
  useToast,
} from '../../../ui/index.ts';
import { ReadOnlyNote } from '../../shared/ReadOnlyNote.tsx';

export interface DetailsCardProps {
  readonly display: DisplayDto;
  readonly site: SiteDto | null;
  /** The form as typed; null while it shows what is stored. */
  readonly draft: ScreenDetailsValues | null;
  readonly onDraft: (draft: ScreenDetailsValues | null) => void;
  readonly onSaved: (display: DisplayDto) => void;
  /** The role may not change the name and description: the form shows them and sends nothing. */
  readonly readOnly: boolean;
}

/** Name and description (an inline form with its own Save), and the facts that do not change. */
export function DetailsCard({
  display,
  site,
  draft,
  onDraft,
  onSaved,
  readOnly,
}: DetailsCardProps) {
  const toast = useToast();
  const values = draft ?? screenDetailsOf(display);
  const dirty = draft !== null && screenDetailsDirty(draft, display);
  const [errors, setErrors] = useState<ScreenDetailsErrors>({});
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const locked = saving || readOnly;

  // While a save runs the form is read-only: its answer replaces the draft, so anything typed
  // meanwhile would be lost without a word (as the media details form does).
  const set = (patch: Partial<ScreenDetailsValues>) => {
    if (locked) return;
    onDraft({ ...values, ...patch });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Enter in the name field submits the form too: read-only, it sends nothing.
    if (readOnly || saving) return;
    const result = validateScreenDetails(values, display);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaveError(null);
    if (result.patch === null) {
      // Only spaces or line endings differ from what is stored.
      onDraft(null);
      return;
    }
    setSaving(true);
    api
      .patchDisplay(display.id, result.patch)
      .then((saved) => {
        setSaving(false);
        onSaved(saved);
        toast.success('Details saved');
      })
      .catch((error: unknown) => {
        setSaving(false);
        setSaveError(error);
      });
  };

  const discard = () => {
    onDraft(null);
    setErrors({});
    setSaveError(null);
  };

  const copyId = () => {
    navigator.clipboard.writeText(display.id).then(
      () => toast.success('Screen ID copied'),
      () => toast.warn('The screen ID could not be copied. Select it and copy it instead.'),
    );
  };

  return (
    <Card
      as="section"
      className="tx-screen-detail-card"
      aria-labelledby="screen-detail-details-title"
    >
      <CardHeader id="screen-detail-details-title" title="Details" size="title" />
      <form
        className="tx-screen-detail-form"
        noValidate
        onSubmit={submit}
        aria-labelledby="screen-detail-details-title"
        data-testid="screen-detail-details-form"
      >
        {readOnly && <ReadOnlyNote>Editors change the screen’s name and description.</ReadOnlyNote>}
        {saveError !== null && (
          <ErrorNotice
            error={saveError}
            title="The details were not saved"
            onDismiss={() => {
              setSaveError(null);
            }}
          />
        )}
        <div className="tx-screen-detail-fields">
          <Field label="Name" error={errors.name} required>
            {(control) => (
              <TextInput
                {...control}
                value={values.name}
                readOnly={locked}
                maxLength={SCREEN_NAME_MAX + 20}
                autoComplete="off"
                data-testid="screen-detail-name"
                onChange={(event) => {
                  set({ name: event.target.value });
                }}
              />
            )}
          </Field>
          <Field
            label="Description"
            optional
            error={errors.description}
            hint={descriptionCountLabel(values.description)}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                value={values.description}
                readOnly={locked}
                data-testid="screen-detail-description"
                onChange={(event) => {
                  set({ description: event.target.value });
                }}
              />
            )}
          </Field>
        </div>
        {!readOnly && (
          <div className="tx-screen-detail-form__actions">
            <Button
              type="submit"
              variant="primary"
              busy={saving}
              aria-disabled={!dirty || undefined}
              data-testid="screen-detail-details-save"
            >
              Save
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={discard} data-testid="screen-detail-details-discard">
                Discard
              </Button>
            )}
            {dirty && <span className="tx-screen-detail-unsaved">Unsaved changes</span>}
          </div>
        )}
      </form>

      <Facts className="tx-screen-detail-facts">
        <Fact label="Site" testId="screen-detail-site">
          {site === null ? 'Unknown site' : `${site.name} (${site.timezone})`}
          <span className="tx-screen-detail-note tx-screen-detail-block">
            The site of a screen cannot be changed.
          </span>
        </Fact>
        <Fact label="Delivery route">
          {display.route === 'browser' ? 'Browser player' : display.route}
        </Fact>
        <Fact label="Added">{formatTimestamp(display.createdAt)}</Fact>
        <Fact label="Screen ID">
          <span className="tx-screen-detail-idrow">
            <span className="tx-screen-detail-id" data-testid="screen-detail-id">
              {display.id}
            </span>
            <IconButton icon={Copy} size="sm" label="Copy screen ID" onClick={copyId} />
          </span>
        </Fact>
      </Facts>
    </Card>
  );
}
