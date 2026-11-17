import type { DisplayDto } from '@tinnox/contracts';
import { api } from '../../../api/index.ts';
import { sameTagIds, tagsSavedText } from '../../../lib/screenDetail.ts';
import { Button, ErrorNotice, Field, useToast } from '../../../ui/index.ts';
import { TagPicker, type TagsResource } from '../../shared/index.ts';
import type { SectionSave } from './types.ts';

export interface TagsTabProps {
  readonly display: DisplayDto;
  /** The screen tags of the organisation (`useTags('display')`, once for the page). */
  readonly tags: TagsResource;
  /** The chosen tag ids; null while they are as stored. Kept by the page across tabs. */
  readonly draft: readonly string[] | null;
  readonly onDraft: (draft: readonly string[] | null) => void;
  readonly onSaved: (display: DisplayDto) => void;
  /** Kept by the page so a save outlives the tab (FCX-03). */
  readonly save: SectionSave;
}

/** The screen's tags: choose or create them, then save. Tags group screens in the list. */
export function TagsTab({ display, tags, draft, onDraft, onSaved, save: saveState }: TagsTabProps) {
  const toast = useToast();
  const value = draft ?? display.tagIds;
  const dirty = draft !== null && !sameTagIds(draft, display.tagIds);
  const { saving, error: saveError, setSaving, setError: setSaveError } = saveState;

  const save = () => {
    if (saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    api
      .patchDisplay(display.id, { tagIds: [...value] })
      .then((saved) => {
        setSaving(false);
        onDraft(null);
        onSaved(saved);
        tags.reload();
        toast.success(tagsSavedText(saved.tagIds.length));
      })
      .catch((error: unknown) => {
        setSaving(false);
        setSaveError(error);
        tags.reload();
      });
  };

  return (
    <div className="tx-screen-detail-tags" data-testid="screen-detail-tags">
      <p className="tx-screen-detail-note">
        Tags group screens, so the screens list can be filtered by them. They change nothing on the
        screen.
      </p>
      {saveError !== null && (
        <ErrorNotice
          error={saveError}
          title="The tags were not saved"
          onDismiss={() => {
            setSaveError(null);
          }}
        />
      )}
      <Field label="Tags of this screen">
        {(control) => (
          <TagPicker
            {...control}
            tags={tags}
            value={value}
            disabled={saving}
            label="Tags of this screen"
            testId="screen-detail-tag-picker"
            onChange={(tagIds) => {
              onDraft(tagIds);
            }}
          />
        )}
      </Field>
      <div className="tx-screen-detail-form__actions">
        <Button
          variant="primary"
          busy={saving}
          aria-disabled={!dirty || undefined}
          onClick={save}
          data-testid="screen-detail-tags-save"
        >
          Save tags
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              onDraft(null);
              setSaveError(null);
            }}
            data-testid="screen-detail-tags-discard"
          >
            Discard changes
          </Button>
        )}
        {dirty && <span className="tx-screen-detail-unsaved">Unsaved changes</span>}
      </div>
    </div>
  );
}
