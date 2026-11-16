import { ABSOLUTE, type PlaylistDto } from '@tinnox/contracts';
import type { RefObject } from 'react';
import { formatTimestamp } from '../../../lib/format.ts';
import type { EditorDraft, EditorErrors } from '../../../lib/playlistEditor.ts';
import { Card, CardHeader, Field, Textarea, TextInput } from '../../../ui/index.ts';
import './playlistEditor.css';

export interface DetailsCardProps {
  readonly draft: EditorDraft;
  readonly saved: PlaylistDto;
  readonly errors: EditorErrors;
  readonly nameRef: RefObject<HTMLInputElement | null>;
  readonly descriptionRef: RefObject<HTMLTextAreaElement | null>;
  readonly onChange: (draft: EditorDraft) => void;
}

/** Name and description of the playlist. Both are part of the draft and saved with it. */
export function DetailsCard({
  draft,
  saved,
  errors,
  nameRef,
  descriptionRef,
  onChange,
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
          <>Last saved {formatTimestamp(saved.updatedAt)}. Saving replaces the whole sequence.</>
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
              data-testid="playlist-editor-description"
              onChange={(event) => {
                onChange({ ...draft, description: event.target.value });
              }}
            />
          )}
        </Field>
      </div>
    </Card>
  );
}
