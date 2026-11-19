import type { TagDto, TagScope } from '@tinnox/contracts';
import { useState } from 'react';
import { isRoleRefusal } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import {
  bulkFailureTitle,
  countOf,
  mergeBulkOutcomes,
  runInSequence,
  type BulkOutcome,
} from '../../lib/bulkOutcome.ts';
import {
  applyTagChanges,
  NO_TAG_CHANGES,
  tagCoverage,
  tagStateWithChanges,
  toggleTagChange,
  type TagChanges,
} from '../../lib/tagColours.ts';
import { Button, Dialog, Spinner, useToast } from '../../ui/index.ts';
import { BulkFailures } from './BulkFailures.tsx';
import './shared.css';
import { TagChecklist } from './TagChecklist.tsx';
import type { TagsResource } from './useTags.ts';

/** One thing whose tags are edited: a media item or a screen (a `MediaDto` or `DisplayDto` fits). */
export interface TagsDialogItem {
  readonly id: string;
  readonly name: string;
  readonly tagIds: readonly string[];
}

export interface TagsDialogProps {
  readonly open: boolean;
  /** Cancel, Escape, the close button, and after a save that fully succeeded. */
  readonly onClose: () => void;
  /**
   * The items to edit, read when the dialog opens. One item: its tags are ticked. Several:
   * a tag that only some carry shows a dash and is left alone unless it is pressed.
   */
  readonly items: readonly TagsDialogItem[];
  /** The page's tags, from `useTags(scope)`. Its scope decides what is saved: media or screens. */
  readonly tags: TagsResource;
  /**
   * Called once per save attempt in which at least one item was changed, with the ids of
   * the changed items, before the dialog closes. Reload the list here.
   */
  readonly onSaved?: (updatedIds: readonly string[]) => void;
  /** False when the role may not create tags in this scope: the list searches only. Default true. */
  readonly allowCreate?: boolean;
  /** Default `shared-tags-dialog`. */
  readonly testId?: string;
}

interface Job {
  readonly item: TagsDialogItem;
  readonly tagIds: readonly string[];
  /** For the failure list. */
  readonly name: string;
}

type Phase =
  | { readonly kind: 'editing' }
  | { readonly kind: 'saving'; readonly finished: number; readonly total: number }
  | {
      readonly kind: 'failed';
      readonly outcome: BulkOutcome<Job, unknown>;
      readonly total: number;
    };

interface Session {
  readonly items: readonly TagsDialogItem[];
  readonly changes: TagChanges;
  readonly phase: Phase;
}

const NOUNS: { readonly [K in TagScope]: string } = { media: 'file', display: 'screen' };

/** What else happened in a run that had failures: what was saved and what needed no change. */
function failureNote(doneCount: number, untouchedCount: number, noun: string): string {
  const parts: string[] = [];
  if (doneCount > 0)
    parts.push(`${countOf(doneCount, noun)} ${doneCount === 1 ? 'was' : 'were'} updated`);
  if (untouchedCount > 0) {
    parts.push(`${countOf(untouchedCount, noun)} needed no change`);
  }
  return parts.length === 0 ? 'Nothing was changed.' : `${parts.join('; ')}.`;
}

function saveTags(scope: TagScope, job: Job): Promise<unknown> {
  const tagIds = [...job.tagIds];
  return scope === 'media'
    ? api.patchMedia(job.item.id, { tagIds })
    : api.patchDisplay(job.item.id, { tagIds });
}

/**
 * Edits the tags of one or many media items or screens and saves them: one request per
 * changed item, one after another. Used by row menus ("Edit tags") and bulk actions
 * ("Add tags"). New tags can be created in it.
 *
 * When every item was saved the dialog closes and reports with a toast. When some were not,
 * it stays open and lists each of them with the server's message and error code, and offers
 * to try those again. Needs the `ToastProvider` of the application shell above it.
 */
export function TagsDialog({
  open,
  onClose,
  items,
  tags,
  onSaved,
  allowCreate = true,
  testId = 'shared-tags-dialog',
}: TagsDialogProps) {
  const toast = useToast();
  const [session, setSession] = useState<Session>({
    items,
    changes: NO_TAG_CHANGES,
    phase: { kind: 'editing' },
  });
  // Each opening starts from the items as they are then, with nothing decided.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession({ items, changes: NO_TAG_CHANGES, phase: { kind: 'editing' } });
  }

  const noun = NOUNS[tags.scope];
  const { changes, phase } = session;
  const edited = session.items;
  const single = edited.length === 1 ? edited[0] : undefined;
  const tagLists = edited.map((item) => item.tagIds);
  const dirty = changes.add.size + changes.remove.size > 0;
  const saving = phase.kind === 'saving';

  const setChanges = (next: TagChanges) => {
    setSession((current) => ({ ...current, changes: next }));
  };

  const run = async (jobs: readonly Job[], earlier: BulkOutcome<Job, unknown> | null) => {
    const total = earlier === null ? jobs.length : earlier.done.length + jobs.length;
    const already = earlier === null ? 0 : earlier.done.length;
    setSession((current) => ({
      ...current,
      phase: { kind: 'saving', finished: already, total },
    }));
    const attempt = await runInSequence(
      jobs,
      (job) => saveTags(tags.scope, job),
      (finished) => {
        setSession((current) => ({
          ...current,
          phase: { kind: 'saving', finished: already + finished, total },
        }));
      },
    );
    const outcome = earlier === null ? attempt : mergeBulkOutcomes(earlier, attempt);
    // Usage counts changed, and a refusal may mean a tag is gone.
    tags.reload();
    if (attempt.done.length > 0) onSaved?.(attempt.done.map((done) => done.item.item.id));
    if (outcome.failed.length === 0) {
      onClose();
      toast.success(
        total === 1 && single !== undefined
          ? `Tags saved for ${single.name}`
          : `Tags saved for ${countOf(total, noun)}`,
      );
      return;
    }
    setSession((current) => ({ ...current, phase: { kind: 'failed', outcome, total } }));
  };

  const save = () => {
    const jobs: Job[] = [];
    for (const item of edited) {
      const tagIds = applyTagChanges(item.tagIds, changes);
      if (tagIds !== null) jobs.push({ item, tagIds, name: item.name });
    }
    if (jobs.length === 0) {
      onClose();
      return;
    }
    void run(jobs, null);
  };

  // A refusal by role is the same for every item and every retry: only Close is left.
  const roleRefused =
    phase.kind === 'failed' && phase.outcome.failed.some((failure) => isRoleRefusal(failure.error));

  const retry = () => {
    if (phase.kind !== 'failed' || roleRefused) return;
    void run(
      phase.outcome.failed.map((failure) => failure.item),
      phase.outcome,
    );
  };

  const title = single !== undefined ? 'Edit tags' : `Edit tags of ${countOf(edited.length, noun)}`;
  const description =
    phase.kind === 'failed'
      ? undefined
      : single !== undefined
        ? single.name
        : `A tick puts the tag on all ${edited.length}. A dash means only some have it; it stays that way unless you press it.`;

  return (
    <Dialog
      testId={testId}
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      busy={saving}
      footerStart={
        saving ? (
          <Spinner
            label={`Saving ${Math.min(phase.finished + 1, phase.total)} of ${phase.total}`}
          />
        ) : undefined
      }
      footer={
        phase.kind === 'failed' ? (
          <>
            <Button onClick={onClose}>Close</Button>
            {!roleRefused && (
              <Button variant="primary" onClick={retry} data-testid={`${testId}-retry`}>
                Try again
              </Button>
            )}
          </>
        ) : (
          <>
            <Button onClick={onClose} aria-disabled={saving || undefined}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={saving}
              aria-disabled={!dirty || undefined}
              onClick={save}
              data-testid={`${testId}-save`}
            >
              Save tags
            </Button>
          </>
        )
      }
    >
      <div className="tx-stack">
        {phase.kind === 'failed' ? (
          <BulkFailures
            title={bulkFailureTitle(phase.outcome.failed.length, phase.total, noun, 'updated')}
            failures={phase.outcome.failed.map((failure) => ({
              item: { name: failure.item.name },
              error: failure.error,
            }))}
            note={failureNote(phase.outcome.done.length, edited.length - phase.total, noun)}
          />
        ) : (
          <TagChecklist
            tags={tags}
            stateOf={(tagId) => tagStateWithChanges(tagCoverage(tagLists, tagId), changes, tagId)}
            onToggle={(tag: TagDto) => {
              setChanges(toggleTagChange(tagCoverage(tagLists, tag.id), changes, tag.id));
            }}
            onCreated={(tag: TagDto) => {
              setSession((current) => ({
                ...current,
                changes: {
                  add: new Set([...current.changes.add, tag.id]),
                  remove: current.changes.remove,
                },
              }));
            }}
            allowCreate={allowCreate}
            disabled={saving}
            someHint={`on some of the selected ${noun}s`}
            testId={`${testId}-checklist`}
          />
        )}
      </div>
    </Dialog>
  );
}
