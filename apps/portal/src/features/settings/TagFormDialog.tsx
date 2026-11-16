import { ABSOLUTE, type TagColour, type TagDto, type TagScope } from '@tinnox/contracts';
import { useRef, useState, type FormEvent } from 'react';
import { api } from '../../api/index.ts';
import { isApiRequestError } from '../../api/client.ts';
import {
  tagFormNameProblem,
  tagPatchFor,
  tagRefusalNameProblem,
  tagSavedMessage,
  tagScopeWords,
} from '../../lib/settingsView.ts';
import { suggestTagColour } from '../../lib/tagColours.ts';
import { Button, Chip, Dialog, ErrorNotice, Field, TextInput, useToast } from '../../ui/index.ts';
import { ColourSwatches } from './ColourSwatches.tsx';
import './settings.css';

/** What the dialog is for: a new tag of a scope, or a change to an existing tag. */
export type TagFormTarget =
  | { readonly mode: 'create'; readonly scope: TagScope }
  | { readonly mode: 'edit'; readonly tag: TagDto; readonly focus: 'name' | 'colour' };

export interface TagFormDialogProps {
  /** Null keeps the dialog closed. Read when it opens. */
  readonly target: TagFormTarget | null;
  /** Every tag of the organisation as last loaded: names to check, colours to suggest from. */
  readonly tags: readonly TagDto[];
  readonly onClose: () => void;
  /** After the server stored the tag; the page reloads its list. */
  readonly onSaved: (tag: TagDto) => void;
}

interface Draft {
  readonly name: string;
  readonly colour: TagColour;
}

function draftFor(target: TagFormTarget | null, tags: readonly TagDto[]): Draft {
  if (target === null) return { name: '', colour: 'teal' };
  if (target.mode === 'edit') return { name: target.tag.name, colour: target.tag.colour };
  return {
    name: '',
    colour: suggestTagColour(tags.filter((tag) => tag.scope === target.scope)),
  };
}

/**
 * Creates a tag, or renames and recolours one: a name field, the eight colours as a radio
 * group, and a preview of the chip. A name already used in the scope is refused at the field,
 * before sending when the list shows it and from the server's 409 `conflict` otherwise. Any
 * other refusal is shown in the dialog with the server's message and error code. Nothing is
 * reported before the server has answered.
 */
export function TagFormDialog({ target, tags, onClose, onSaved }: TagFormDialogProps) {
  const toast = useToast();
  const nameRef = useRef<HTMLInputElement>(null);
  const open = target !== null;
  // The target as it was when the dialog opened; it stays while the dialog fades out.
  const [current, setCurrent] = useState<TagFormTarget | null>(target);
  const [draft, setDraft] = useState<Draft>(() => draftFor(target, tags));
  const [touched, setTouched] = useState(false);
  const [serverNameProblem, setServerNameProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (target !== null) {
      setCurrent(target);
      setDraft(draftFor(target, tags));
      setTouched(false);
      setServerNameProblem(null);
      setError(null);
      setBusy(false);
    }
  }

  const scope: TagScope =
    current === null ? 'media' : current.mode === 'edit' ? current.tag.scope : current.scope;
  const words = tagScopeWords(scope);
  const selfId = current?.mode === 'edit' ? current.tag.id : null;
  const scopeTags = tags.filter((tag) => tag.scope === scope);
  const localProblem = tagFormNameProblem(draft.name, scope, scopeTags, selfId);
  const nameError = serverNameProblem ?? (touched ? (localProblem ?? undefined) : undefined);
  const editing = current?.mode === 'edit' ? current : null;
  const unchanged = editing !== null && tagPatchFor(editing.tag, draft) === null;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || current === null) return;
    setTouched(true);
    if (localProblem !== null) {
      nameRef.current?.focus();
      return;
    }
    setError(null);
    setServerNameProblem(null);
    setBusy(true);
    try {
      let saved: TagDto;
      let message: string;
      if (current.mode === 'create') {
        saved = await api.createTag({ scope, name: draft.name.trim(), colour: draft.colour });
        message = `${words.tag.charAt(0).toUpperCase()}${words.tag.slice(1)} “${saved.name}” created`;
      } else {
        const patch = tagPatchFor(current.tag, draft);
        if (patch === null) {
          setBusy(false);
          onClose();
          return;
        }
        saved = await api.patchTag(current.tag.id, patch);
        message = tagSavedMessage(patch);
      }
      setBusy(false);
      onSaved(saved);
      onClose();
      toast.success(message);
    } catch (caught) {
      setBusy(false);
      const problem = isApiRequestError(caught)
        ? tagRefusalNameProblem(scope, caught, tags.length)
        : null;
      if (problem !== null) {
        setServerNameProblem(problem);
        nameRef.current?.focus();
      } else {
        setError(caught);
      }
    }
  };

  const title = current?.mode === 'edit' ? 'Edit tag' : `New ${words.tag}`;
  const description =
    current?.mode === 'edit'
      ? `Renaming or recolouring changes the tag everywhere it is used. ${
          current.tag.usageCount === 0
            ? 'No item carries it yet.'
            : `It is on ${current.tag.usageCount} ${current.tag.usageCount === 1 ? words.item : words.items}.`
        }`
      : `A ${words.tag} labels ${words.items} so they can be found and filtered.`;
  const previewName = draft.name.trim();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      busy={busy}
      className="tx-settings-tag-dialog"
      footer={
        <>
          <Button onClick={onClose} data-testid="settings-tag-form-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            aria-disabled={unchanged || undefined}
            onClick={() => {
              if (unchanged) return;
              void submit();
            }}
            data-testid="settings-tag-form-save"
          >
            {current?.mode === 'edit' ? 'Save tag' : 'Create tag'}
          </Button>
        </>
      }
    >
      <form
        className="tx-settings-tagform"
        noValidate
        onSubmit={(event) => {
          if (unchanged) {
            event.preventDefault();
            return;
          }
          void submit(event);
        }}
        onKeyDown={(event) => {
          // Enter on a colour swatch saves too, as it does in the name field.
          if (
            event.key === 'Enter' &&
            event.target instanceof HTMLInputElement &&
            event.target.type === 'radio'
          ) {
            event.preventDefault();
            if (!unchanged) void submit();
          }
        }}
        data-testid="settings-tag-form"
      >
        {error !== null && (
          <ErrorNotice
            error={error}
            title={current?.mode === 'edit' ? 'The tag was not saved' : 'The tag was not created'}
            onDismiss={() => {
              setError(null);
            }}
          />
        )}
        <Field
          label="Name"
          required
          error={nameError}
          hint={
            nameError === undefined ? `Up to ${ABSOLUTE.maxTagNameLength} characters.` : undefined
          }
        >
          {(control) => (
            <TextInput
              {...control}
              ref={nameRef}
              value={draft.name}
              maxLength={ABSOLUTE.maxTagNameLength + 20}
              autoComplete="off"
              spellCheck={false}
              data-autofocus={editing === null || editing.focus === 'name' ? '' : undefined}
              disabled={busy}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
                setServerNameProblem(null);
              }}
              onBlur={() => {
                if (draft.name !== '') setTouched(true);
              }}
              data-testid="settings-tag-form-name"
            />
          )}
        </Field>
        <ColourSwatches
          value={draft.colour}
          disabled={busy}
          autoFocus={editing?.focus === 'colour'}
          onChange={(colour) => {
            setDraft({ ...draft, colour });
          }}
        />
        <div className="tx-settings-preview" aria-hidden="true">
          <span className="tx-settings-preview__label">Preview</span>
          {previewName === '' ? (
            <span className="tx-settings-preview__empty">Type a name to see the tag.</span>
          ) : (
            <Chip colour={draft.colour} className="tx-settings-preview__chip">
              {previewName}
            </Chip>
          )}
        </div>
      </form>
    </Dialog>
  );
}
