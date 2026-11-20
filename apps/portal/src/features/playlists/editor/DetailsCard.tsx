import { ABSOLUTE, type PlaylistDto, type Transition } from '@tinnox/contracts';
import type { RefObject } from 'react';
import { formatTimestamp } from '../../../lib/format.ts';
import type { EditorDraft, EditorErrors } from '../../../lib/playlistEditor.ts';
import {
  Card,
  CardHeader,
  Field,
  FieldGroup,
  FormSection,
  Segmented,
  type SegmentedOption,
  Switch,
  Textarea,
  TextInput,
} from '../../../ui/index.ts';
import './playlistEditor.css';

const TRANSITION_OPTIONS: readonly SegmentedOption<Transition>[] = [
  { value: 'cut', label: 'Cut' },
  { value: 'fade', label: 'Fade' },
];

export interface DetailsCardProps {
  readonly draft: EditorDraft;
  readonly saved: PlaylistDto;
  readonly errors: EditorErrors;
  readonly nameRef: RefObject<HTMLInputElement | null>;
  readonly descriptionRef: RefObject<HTMLTextAreaElement | null>;
  readonly onChange: (draft: EditorDraft) => void;
  /** The role may not change playlists: the fields show the playlist and take no input. */
  readonly readOnly: boolean;
}

/** Name, description and playback options of the playlist. All are part of the draft and saved with it. */
export function DetailsCard({
  draft,
  saved,
  errors,
  nameRef,
  descriptionRef,
  onChange,
  readOnly,
}: DetailsCardProps) {
  return (
    <Card
      as="section"
      aria-labelledby="tx-playlist-editor-details"
      data-testid="playlist-editor-details"
    >
      <CardHeader
        id="tx-playlist-editor-details"
        title="Details"
        size="title"
        description={
          <>
            Last saved {formatTimestamp(saved.updatedAt)}.
            {!readOnly && ' Saving replaces the whole sequence.'}
          </>
        }
      />
      <div className="tx-playlist-editor__fields">
        <Field label="Playlist name" error={errors.name ?? undefined} required>
          {(control) => (
            <TextInput
              {...control}
              ref={nameRef}
              width="full"
              value={draft.name}
              maxLength={ABSOLUTE.maxNameLength}
              autoComplete="off"
              spellCheck={false}
              readOnly={readOnly}
              data-testid="playlist-editor-name"
              onChange={(event) => {
                onChange({ ...draft, name: event.target.value });
              }}
            />
          )}
        </Field>
        <Field
          label="Description"
          optional
          error={errors.description ?? undefined}
          hint="For people in your organisation. Screens do not show it."
        >
          {(control) => (
            <Textarea
              {...control}
              ref={descriptionRef}
              rows={3}
              value={draft.description}
              maxLength={ABSOLUTE.maxDescriptionLength}
              readOnly={readOnly}
              data-testid="playlist-editor-description"
              onChange={(event) => {
                onChange({ ...draft, description: event.target.value });
              }}
            />
          )}
        </Field>
      </div>
      <FormSection title="Playback">
        <FieldGroup
          legend="Transition"
          hint="Fade blends one image into the next. Videos always cut."
        >
          <Segmented
            label="Transition"
            options={TRANSITION_OPTIONS}
            value={draft.transition}
            disabled={readOnly}
            onChange={(transition) => {
              onChange({ ...draft, transition });
            }}
          />
        </FieldGroup>
        <Switch
          label="Shuffle"
          hint="Plays every item once per round, in a new order each round."
          checked={draft.shuffle}
          disabled={readOnly}
          data-testid="playlist-editor-shuffle"
          onChange={(shuffle) => {
            onChange({ ...draft, shuffle });
          }}
        />
      </FormSection>
    </Card>
  );
}
