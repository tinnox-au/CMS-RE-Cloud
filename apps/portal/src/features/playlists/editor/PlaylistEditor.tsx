import type { DraftItem } from '../../../lib/playlistDraft.ts';
import type { MediaDto, PlaylistDto } from '@tinnox/contracts';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api/index.ts';
import { useLoad } from '../../../hooks/useLoad.ts';
import { mediaDisplayName } from '../../../lib/mediaName.ts';
import { moveItem, removeItem, updateItem } from '../../../lib/playlistDraft.ts';
import {
  addedAnnouncement,
  addMedia,
  capacityMessage,
  carryItemKeys,
  draftAfterSave,
  editorDraftFromPlaylist,
  editorIsDirty,
  listProblems,
  movedAnnouncement,
  moveItemToSlot,
  NO_EDITOR_ERRORS,
  removedAnnouncement,
  validateEditorDraft,
  type EditorDraft,
  type ProblemTarget,
} from '../../../lib/playlistEditor.ts';
import { useSession } from '../../../session/SessionContext.tsx';
import { EditorPage } from '../../../shell/EditorPage.tsx';
import { CircleCheck, CircleDashed, Save } from '../../../ui/icons.ts';
import { Button, ConfirmDialog, ErrorNotice, Icon, useToast } from '../../../ui/index.ts';
import { useLeaveGuard } from '../../shared/useLeaveGuard.tsx';
import { usePush } from '../../push/PushContext.tsx';
import { DetailsCard } from './DetailsCard.tsx';
import type { DragSource } from './dragSource.ts';
import { LibraryCard } from './LibraryCard.tsx';
import { ProblemSummary } from './ProblemSummary.tsx';
import { PushCard } from './PushCard.tsx';
import { SequenceCard } from './SequenceCard.tsx';
import './playlistEditor.css';

export const PLAYLIST_EDITOR_BACK = { to: '/playlists', label: 'All playlists' } as const;

interface Announcement {
  readonly text: string;
  /** Changes with every message, so the same words twice are read twice. */
  readonly seq: number;
}

export interface PlaylistEditorProps {
  readonly initial: PlaylistDto;
}

/**
 * The editor of one playlist. The draft lives here until "Save draft" replaces the stored
 * playlist with it (`PUT /api/playlists/:id`, the whole item list); nothing reaches a screen
 * until it is pushed.
 */
export function PlaylistEditor({ initial }: PlaylistEditorProps) {
  const { limits } = useSession();
  const toast = useToast();
  const push = usePush();

  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<EditorDraft>(() => editorDraftFromPlaylist(initial));
  // Errors are shown from the first attempt to save, and follow the draft from then on.
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement>({ text: '', seq: 0 });
  const dragSource = useRef<DragSource | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  // The draft as last committed, read when a save is answered (its closure holds an older one).
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const loadMedia = useCallback((signal: AbortSignal) => api.listMedia(signal), []);
  const media = useLoad(loadMedia);
  const mediaById = useMemo(
    () =>
      new Map<string, MediaDto>(
        media.state.status === 'ready' ? media.state.data.items.map((item) => [item.id, item]) : [],
      ),
    [media.state],
  );

  const dirty = editorIsDirty(draft, saved);
  const validation = useMemo(() => validateEditorDraft(draft, limits), [draft, limits]);
  const errors = attempted && !validation.ok ? validation.errors : NO_EDITOR_ERRORS;
  const problems = useMemo(() => listProblems(draft, errors), [draft, errors]);

  // The M0 safeguards: leaving the page inside the portal asks first, and so does the browser.
  const leaveGuard = useLeaveGuard(dirty, saved.name);

  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => ({ text, seq: previous.seq + 1 }));
  }, []);

  const change = (next: EditorDraft) => {
    setDraft(next);
  };

  const nameOf = (item: DraftItem) => mediaDisplayName(mediaById.get(item.media.id) ?? item.media);

  /** Adds a library item at the end, or at a drop position. Returns where it went, or null. */
  const add = (item: MediaDto, slot?: number): number | null => {
    const result = addMedia(draft, item, crypto.randomUUID(), limits, slot);
    if (!result.ok) {
      announce(
        result.reason === 'full' ? capacityMessage(limits) : 'Only ready media can be added.',
      );
      return null;
    }
    change(result.draft);
    announce(addedAnnouncement(mediaDisplayName(item), result.index + 1));
    return result.index;
  };

  const move = (index: number, delta: number) => {
    const item = draft.items[index];
    const next = moveItem(draft, index, delta);
    if (item === undefined || next === draft) return;
    change({ ...next, description: draft.description });
    announce(movedAnnouncement(nameOf(item), index + delta + 1, draft.items.length));
  };

  const moveToSlot = (fromIndex: number, slot: number) => {
    const item = draft.items[fromIndex];
    const next = moveItemToSlot(draft, fromIndex, slot);
    if (item === undefined || next === draft) return;
    change(next);
    const position = next.items.findIndex((candidate) => candidate.key === item.key) + 1;
    announce(movedAnnouncement(nameOf(item), position, next.items.length));
  };

  const remove = (key: string) => {
    const index = draft.items.findIndex((item) => item.key === key);
    const item = draft.items[index];
    if (item === undefined) return;
    change({ ...removeItem(draft, key), description: draft.description });
    announce(removedAnnouncement(nameOf(item), index + 1));
  };

  const changeItem = (
    key: string,
    itemChange: Partial<Pick<DraftItem, 'durationText' | 'fit'>>,
  ) => {
    change({ ...updateItem(draft, key, itemChange), description: draft.description });
  };

  const save = () => {
    if (saving) return;
    setAttempted(true);
    if (!validation.ok) {
      // Let the summary render, then take the reader to it.
      window.requestAnimationFrame(() => {
        summaryRef.current?.focus();
      });
      return;
    }
    setSaving(true);
    setSaveError(null);
    const sentFrom = draft;
    api
      .replacePlaylist(saved.id, validation.value)
      .then((playlist) => {
        // The editor stays open during the save; what was typed meanwhile is kept, unsaved.
        const after = draftAfterSave(draftRef.current, sentFrom, playlist);
        setSaved(playlist);
        if (after.settled) {
          setDraft(after.draft);
          setAttempted(false);
        }
        toast.success('Playlist saved', {
          detail: 'Nothing changes on a screen until you push.',
        });
        // What is waiting to be pushed may have changed.
        push.refresh();
      })
      .catch((error: unknown) => {
        setSaveError(error);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const discard = () => {
    setDraft(carryItemKeys(editorDraftFromPlaylist(saved), draft));
    setAttempted(false);
    setSaveError(null);
    setConfirmDiscard(false);
    announce('Changes discarded. The playlist is as it was last saved.');
  };

  const goTo = (target: ProblemTarget | null) => {
    if (target === null) return;
    const element =
      target.kind === 'name'
        ? nameRef.current
        : target.kind === 'description'
          ? descriptionRef.current
          : document.querySelector<HTMLElement>(
              `[data-item-key="${CSS.escape(target.key)}"] [role="spinbutton"]`,
            );
    if (element === null) return;
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    element.focus({ preventScroll: true });
  };

  const title = draft.name.trim() === '' ? saved.name : draft.name.trim();

  return (
    <EditorPage
      title={title}
      back={PLAYLIST_EDITOR_BACK}
      status={
        <span
          className="tx-playlist-editor-state"
          data-state={dirty ? 'unsaved' : 'saved'}
          data-testid="playlist-editor-save-state"
        >
          <Icon icon={dirty ? CircleDashed : CircleCheck} size={16} />
          <span role="status">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        </span>
      }
      actions={
        <>
          <Button
            variant="ghost"
            aria-disabled={!dirty || saving || undefined}
            onClick={() => {
              if (dirty && !saving) setConfirmDiscard(true);
            }}
            data-testid="playlist-editor-discard"
          >
            Discard changes
          </Button>
          <Button
            variant="primary"
            icon={Save}
            busy={saving}
            aria-disabled={!dirty || undefined}
            onClick={() => {
              if (dirty) save();
            }}
            data-testid="playlist-editor-save"
          >
            Save draft
          </Button>
        </>
      }
    >
      <div className="tx-playlist-editor" data-testid="playlist-editor">
        <p
          className="tx-visually-hidden"
          aria-live="polite"
          data-testid="playlist-editor-announcer"
        >
          <span key={announcement.seq}>{announcement.text}</span>
        </p>

        {problems.length > 0 && (
          <ProblemSummary
            ref={summaryRef}
            problems={problems}
            invalidDurations={Object.keys(errors.items).length}
            onGoTo={goTo}
          />
        )}
        {saveError !== null && (
          <ErrorNotice
            error={saveError}
            title="The draft was not saved"
            onRetry={save}
            onDismiss={() => {
              setSaveError(null);
            }}
          />
        )}

        <div className="tx-playlist-editor__top">
          <DetailsCard
            draft={draft}
            saved={saved}
            errors={errors}
            nameRef={nameRef}
            descriptionRef={descriptionRef}
            onChange={change}
          />
          <PushCard playlist={saved} dirty={dirty} />
        </div>

        <SequenceCard
          draft={draft}
          errors={errors}
          limits={limits}
          mediaById={mediaById}
          dragSource={dragSource}
          onAdd={add}
          onMove={move}
          onMoveToSlot={moveToSlot}
          onRemove={remove}
          onChangeItem={changeItem}
          onAnnounce={announce}
        />

        <LibraryCard
          media={media}
          draft={draft}
          limits={limits}
          dragSource={dragSource}
          onAdd={add}
        />
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard your changes?"
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={discard}
        onCancel={() => {
          setConfirmDiscard(false);
        }}
      >
        <p>
          The name, description and sequence go back to how <strong>{saved.name}</strong> was last
          saved. This cannot be undone.
        </p>
      </ConfirmDialog>

      {leaveGuard.dialog}
    </EditorPage>
  );
}
