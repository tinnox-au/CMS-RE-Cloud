import type { MediaDto, MediaPatch } from '@tinnox/contracts';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { isApiRequestError } from '../../../api/client.ts';
import { api } from '../../../api/index.ts';
import { useLoad } from '../../../hooks/useLoad.ts';
import {
  draftFromMedia,
  fieldErrorsFromApi,
  isDraftDirty,
  NO_MEDIA_DETAIL_ERRORS,
  validateMediaDraft,
  withoutError,
  type MediaDetailDraft,
  type MediaDetailErrors,
  type MediaDetailField,
} from '../../../lib/mediaDetailDraft.ts';
import {
  headerStatusLabel,
  saveRefusalNeedsReload,
  staleListsAfterSave,
} from '../../../lib/mediaDetailState.ts';
import { useCan, useCanAtMount, useSession } from '../../../session/AuthenticatedSession.tsx';
import { EditorPage } from '../../../shell/EditorPage.tsx';
import { CircleCheck, CircleDashed, ListPlus } from '../../../ui/icons.ts';
import { Button, Icon, MenuItem, useToast } from '../../../ui/index.ts';
import { useFolders, useTags } from '../../shared/index.ts';
import { ReadOnlyNote } from '../../shared/ReadOnlyNote.tsx';
import { MediaDetailForm } from './MediaDetailForm.tsx';
import { MediaDetailsCard } from './MediaDetailsCard.tsx';
import { SaveSplit } from './SaveSplit.tsx';
import { useAddToPlaylist } from './useAddToPlaylist.tsx';
import { useLeaveGuard } from '../../shared/useLeaveGuard.tsx';
import { usePush } from '../../push/PushContext.tsx';
import { useMediaDelete } from './useMediaDelete.tsx';
import './media-detail.css';

export interface MediaEditorProps {
  /** The item as last read or saved; ready. */
  readonly media: MediaDto;
  /** Replaces the page's copy of the item with the answer of a save. */
  readonly onSaved: (media: MediaDto) => void;
  /** A notice about the last refresh, from the page. */
  readonly notice?: ReactNode;
}

/**
 * The media details page for a ready file: the details card on the left, the settings form
 * on the right, Cancel and Save in the header (section 3.3). Save is split, offering "Save
 * and add to playlist", only while there is something to save; with no changes the item is
 * added from Used in. Cancel leaves for the library, and the leave guard asks first when the
 * draft has changes: like the playlist editor's Discard, nothing is thrown away unasked. The draft lives here; the pure
 * rules (what changed, what is sent, what is refused before sending) are in
 * `lib/mediaDetailDraft.ts`. The server stays the authority: its refusal is shown with the
 * error code, and at the field when it names one. Without `content.write` (decided when the
 * page opens) it is read-only: no header actions, every field locked, nothing submits; Delete
 * stays for a role that holds `media.delete`.
 */
export function MediaEditor({ media, onSaved, notice }: MediaEditorProps) {
  const { limits } = useSession();
  const toast = useToast();
  const push = usePush();
  const navigate = useNavigate();
  const tags = useTags('media');
  const folders = useFolders();
  const readOnly = !useCanAtMount('content.write');
  const canDelete = useCan('media.delete');

  const [draft, setDraft] = useState<MediaDetailDraft>(() => draftFromMedia(media));
  const [base, setBase] = useState(media);
  const [errors, setErrors] = useState<MediaDetailErrors>(NO_MEDIA_DETAIL_ERRORS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  // A newer copy of the item (from the page) replaces an untouched draft; a draft with
  // changes is kept, and compared with the newer copy from now on.
  if (media !== base) {
    setBase(media);
    if (!isDraftDirty(draft, base, limits)) setDraft(draftFromMedia(media));
  }

  const dirty = isDraftDirty(draft, media, limits);

  const loadUsage = useCallback(
    (signal: AbortSignal) => api.getMediaUsage(media.id, signal),
    [media.id],
  );
  const usage = useLoad(loadUsage);
  const usageData = usage.state.status === 'ready' ? usage.state.data : null;

  // Until the save answers, the changes are not safe: it can still fail (FCX-04).
  const guard = useLeaveGuard(dirty && !readOnly, media.name, saving);
  const remove = useMediaDelete({
    media,
    usage: usageData,
    onDeleted: guard.release,
    onRefused: usage.reload,
  });
  const addition = useAddToPlaylist({
    media,
    limits,
    unsaved: dirty,
    onAdded: usage.reload,
  });

  const change = (field: MediaDetailField, next: MediaDetailDraft) => {
    if (readOnly) return;
    setDraft(next);
    // The order message sits on Available until but is fixed from either side.
    setErrors((current) =>
      withoutError(
        withoutError(current, field),
        field === 'availableFrom' ? 'availableUntil' : field,
      ),
    );
  };

  const focusSummary = () => {
    // After the summary has rendered.
    window.requestAnimationFrame(() => {
      summaryRef.current?.focus();
    });
  };

  /** Saves the draft. Resolves true when the item as saved matches the draft. */
  const save = async (): Promise<boolean> => {
    if (readOnly || saving) return false;
    const result = validateMediaDraft(draft, media, limits);
    if (!result.ok) {
      setErrors(result.errors);
      setSaveError(null);
      focusSummary();
      return false;
    }
    setErrors(NO_MEDIA_DETAIL_ERRORS);
    if (result.patch === null) return true;
    const patch: MediaPatch = result.patch;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.patchMedia(media.id, patch);
      setDraft(draftFromMedia(saved));
      setBase(saved);
      onSaved(saved);
      const stale = staleListsAfterSave(patch);
      if (stale.tags) tags.reload();
      if (stale.folders) folders.reload();
      toast.success('Changes saved');
      // A new availability window changes what a push would send.
      if (patch.availableFrom !== undefined) push.refresh();
      return true;
    } catch (error) {
      setSaveError(error);
      if (isApiRequestError(error)) {
        const fieldErrors = fieldErrorsFromApi(error.details);
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
        if (saveRefusalNeedsReload(error, patch)) {
          tags.reload();
          folders.reload();
        }
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndAdd = async () => {
    if (await save()) addition.open();
  };

  return (
    <EditorPage
      title={media.name}
      back={{ to: '/media', label: 'All media' }}
      status={
        readOnly ? undefined : (
          <span className="tx-media-detail-status" data-state={dirty ? 'unsaved' : 'saved'}>
            <Icon icon={dirty ? CircleDashed : CircleCheck} size={16} />
            <span role="status" data-testid="media-detail-save-state" data-dirty={dirty}>
              {headerStatusLabel(dirty)}
            </span>
          </span>
        )
      }
      actions={
        readOnly ? undefined : (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                void navigate('/media');
              }}
              data-testid="media-detail-cancel"
            >
              Cancel
            </Button>
            <SaveSplit
              busy={saving}
              unavailableReason={dirty ? null : 'There are no changes to save'}
              onSave={() => {
                void save();
              }}
              menu={
                <MenuItem
                  icon={ListPlus}
                  onSelect={() => {
                    void saveAndAdd();
                  }}
                >
                  Save and add to playlist
                </MenuItem>
              }
            />
          </>
        )
      }
    >
      <div className="tx-media-detail" data-testid="media-detail" data-status={media.status}>
        {readOnly && <ReadOnlyNote>You can view this file. Editors make changes.</ReadOnlyNote>}
        {notice}
        <div className="tx-editor">
          <MediaDetailsCard
            media={media}
            name={media.name}
            usage={{
              state: usage.state,
              onRetry: usage.reload,
              onAddToPlaylist: readOnly ? undefined : addition.open,
            }}
          />
          <MediaDetailForm
            media={media}
            draft={draft}
            errors={errors}
            onChange={change}
            onSubmit={() => {
              void save();
            }}
            tags={tags}
            folders={folders}
            limits={limits}
            saving={saving}
            readOnly={readOnly}
            saveError={saveError}
            onDismissSaveError={() => {
              setSaveError(null);
            }}
            summaryRef={summaryRef}
            onDelete={canDelete ? remove.ask : undefined}
          />
        </div>
      </div>
      {guard.dialog}
      {remove.dialog}
      {addition.dialog}
    </EditorPage>
  );
}
