import type { Limits, MediaDto } from '@tinnox/contracts';
import { useRef, type FormEvent, type KeyboardEvent, type Ref } from 'react';
import { durationFieldText } from '../../../lib/duration.ts';
import {
  durationBoundsSeconds,
  errorFields,
  MEDIA_DETAIL_FIELD_LABELS,
  STANDARD_IMAGE_DURATION_MS,
  type MediaDetailDraft,
  type MediaDetailErrors,
  type MediaDetailField,
} from '../../../lib/mediaDetailDraft.ts';
import { videoLengthFact } from '../../../lib/mediaDetailFacts.ts';
import { ABSOLUTE } from '@tinnox/contracts';
import { Trash } from '../../../ui/icons.ts';
import {
  Banner,
  Button,
  Card,
  ErrorNotice,
  Field,
  FormSection,
  Textarea,
  TextInput,
} from '../../../ui/index.ts';
import {
  FolderSelect,
  TagPicker,
  type FoldersResource,
  type TagsResource,
} from '../../shared/index.ts';
import { DurationStepper } from './DurationStepper.tsx';
import './media-detail.css';

/** The class that marks each field, so the error summary can move focus into it. */
function fieldClass(field: MediaDetailField): string {
  return `tx-media-detail-field tx-media-detail-field--${field}`;
}

export interface MediaDetailFormProps {
  readonly media: MediaDto;
  readonly draft: MediaDetailDraft;
  readonly errors: MediaDetailErrors;
  /** The operator changed one field; `next` is the whole draft. */
  readonly onChange: (field: MediaDetailField, next: MediaDetailDraft) => void;
  /** Enter in the name field. */
  readonly onSubmit: () => void;
  readonly tags: TagsResource;
  readonly folders: FoldersResource;
  readonly limits: Pick<Limits, 'minImageItemDurationMs' | 'maxImageItemDurationMs'>;
  /** While a save runs the fields stay as they are but cannot be changed. */
  readonly saving: boolean;
  /** What the last save threw, shown above the fields with the API error code. */
  readonly saveError: unknown;
  readonly onDismissSaveError: () => void;
  /** The error summary; focused after a refused save. */
  readonly summaryRef: Ref<HTMLDivElement>;
  readonly onDelete: () => void;
}

/**
 * The wide "settings" card of the media details page: name, description, default duration
 * (images), folder and tags, then the quiet delete action. Nothing here is saved: the page
 * holds the draft and saves it from the header.
 */
export function MediaDetailForm({
  media,
  draft,
  errors,
  onChange,
  onSubmit,
  tags,
  folders,
  limits,
  saving,
  saveError,
  onDismissSaveError,
  summaryRef,
  onDelete,
}: MediaDetailFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const bounds = durationBoundsSeconds(limits);
  const standardSeconds = Number(durationFieldText(STANDARD_IMAGE_DURATION_MS));
  const invalid = errorFields(errors);
  const descriptionLength = draft.description.trim().length;

  const focusField = (field: MediaDetailField) => {
    const wrapper = formRef.current?.querySelector(`.tx-media-detail-field--${field}`);
    const control =
      wrapper?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea, select:not([disabled])',
      ) ?? wrapper?.querySelector<HTMLElement>('button:not([disabled])');
    control?.focus();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <Card
      as="section"
      className="tx-media-detail-settings"
      aria-labelledby="media-detail-settings-title"
    >
      {/* The outline heading of this column, so its section titles (h3) nest under it. */}
      <h2 id="media-detail-settings-title" className="tx-visually-hidden">
        Settings
      </h2>
      <form
        ref={formRef}
        noValidate
        className="tx-media-detail-form"
        onSubmit={submit}
        data-testid="media-detail-form"
        aria-busy={saving || undefined}
      >
        {saveError !== null && (
          <ErrorNotice
            className="tx-media-detail-form__notice"
            error={saveError}
            title="The changes were not saved"
            onDismiss={onDismissSaveError}
          />
        )}
        {(invalid.length > 0 || errors.form !== undefined) && (
          <div
            ref={summaryRef}
            tabIndex={-1}
            className="tx-media-detail-summary"
            data-testid="media-detail-error-summary"
          >
            <Banner
              tone="danger"
              live="assertive"
              title={
                invalid.length === 1
                  ? 'One field needs a change before saving'
                  : `${invalid.length > 0 ? String(invalid.length) : 'Some'} fields need a change before saving`
              }
            >
              <ul>
                {invalid.map((field) => (
                  <li key={field}>
                    <a
                      href={`#${field}`}
                      onClick={(event) => {
                        event.preventDefault();
                        focusField(field);
                      }}
                    >
                      {MEDIA_DETAIL_FIELD_LABELS[field]}
                    </a>
                    : {errors[field]}
                  </li>
                ))}
                {errors.form !== undefined && <li>{errors.form}</li>}
              </ul>
            </Banner>
          </div>
        )}

        <FormSection title="Details" layout="rows">
          <Field
            className={fieldClass('name')}
            label="Name"
            error={errors.name}
            hint={
              <>
                Shown in the library and in playlists. Leave it empty to use the file name,{' '}
                <span className="tx-break">“{media.originalName}”</span>.
              </>
            }
          >
            {(control) => (
              <TextInput
                {...control}
                value={draft.name}
                placeholder={media.originalName}
                maxLength={ABSOLUTE.maxOriginalNameLength}
                autoComplete="off"
                spellCheck={false}
                readOnly={saving}
                data-testid="media-detail-name"
                onKeyDown={submitOnEnter}
                onChange={(event) => {
                  onChange('name', { ...draft, name: event.target.value });
                }}
              />
            )}
          </Field>
          <Field
            className={fieldClass('description')}
            label="Description"
            optional
            error={errors.description}
            hint={`What the file shows or when to use it. ${descriptionLength} of ${ABSOLUTE.maxDescriptionLength} characters.`}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                value={draft.description}
                readOnly={saving}
                data-testid="media-detail-description"
                onChange={(event) => {
                  onChange('description', { ...draft, description: event.target.value });
                }}
              />
            )}
          </Field>
        </FormSection>

        <FormSection title="Playback" layout="rows">
          {media.kind === 'image' ? (
            <Field
              className={fieldClass('defaultDurationMs')}
              label="Default duration"
              optional
              error={errors.defaultDurationMs}
              hint={`Time on screen when this image is added to a playlist, from ${bounds.min} to ${bounds.max} seconds. Leave it empty to use ${standardSeconds} seconds. Playlists that already hold the image keep their own time.`}
            >
              {(control) => (
                <DurationStepper
                  {...control}
                  value={draft.durationText}
                  min={bounds.min}
                  max={bounds.max}
                  standardSeconds={standardSeconds}
                  onChange={(durationText) => {
                    if (saving) return;
                    onChange('defaultDurationMs', { ...draft, durationText });
                  }}
                />
              )}
            </Field>
          ) : (
            <div
              className="tx-field tx-media-detail-static"
              data-testid="media-detail-duration-video"
            >
              <span className="tx-field__label">Duration</span>
              <p className="tx-media-detail-static__value">
                A video always plays for its own length
                {videoLengthFact(media.durationMs) !== null
                  ? `, ${videoLengthFact(media.durationMs) ?? ''}`
                  : ''}
                .
              </p>
            </div>
          )}
        </FormSection>

        <FormSection title="Organise" layout="rows">
          <Field className={fieldClass('folderId')} label="Folder" error={errors.folderId}>
            {(control) => (
              <FolderSelect
                {...control}
                folders={folders}
                value={draft.folderId}
                disabled={saving}
                testId="media-detail-folder"
                onChange={(folderId) => {
                  onChange('folderId', { ...draft, folderId });
                }}
              />
            )}
          </Field>
          <Field className={fieldClass('tagIds')} label="Tags" error={errors.tagIds}>
            {(control) => (
              <TagPicker
                {...control}
                tags={tags}
                value={draft.tagIds}
                collapsible
                disabled={saving}
                testId="media-detail-tags"
                onChange={(tagIds) => {
                  onChange('tagIds', { ...draft, tagIds });
                }}
              />
            )}
          </Field>
        </FormSection>

        <FormSection
          title="Delete"
          description="Removes the file from the library. Screens keep what they were last pushed until their next push."
        >
          <div>
            <Button
              variant="danger"
              icon={Trash}
              onClick={onDelete}
              aria-disabled={saving || undefined}
              data-testid="media-detail-delete"
            >
              Delete file
            </Button>
          </div>
        </FormSection>
      </form>
    </Card>
  );
}
