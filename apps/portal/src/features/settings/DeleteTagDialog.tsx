import type { TagDto } from '@tinnox/contracts';
import { useState } from 'react';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { tagDeleteConsequence, tagScopeWords } from '../../lib/settingsView.ts';
import { Button, Chip, Dialog, ErrorNotice, useToast } from '../../ui/index.ts';
import { useRowFocusReturn, type RowFocusSource } from '../shared/index.ts';
import './settings.css';

export interface DeleteTagDialogProps {
  /** The tag to delete; null keeps the dialog closed. Read when it opens. */
  readonly tag: TagDto | null;
  readonly onClose: () => void;
  /** After the server deleted the tag. */
  readonly onDeleted: (tag: TagDto) => void;
  /** Where focus goes once the deleted row has left the list. Read when it opens. */
  readonly rowFocus?: RowFocusSource;
}

/**
 * Confirms deleting a tag, names it, and says how many items lose it. Focus starts on
 * Cancel, so Enter never deletes by accident. A refusal stays in the dialog with the
 * server's message and error code.
 */
export function DeleteTagDialog({ tag, onClose, onDeleted, rowFocus }: DeleteTagDialogProps) {
  const toast = useToast();
  const open = tag !== null;
  const returnFocus = useRowFocusReturn(open, tag === null ? [] : [tag.id], rowFocus);
  const [current, setCurrent] = useState<TagDto | null>(tag);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (tag !== null) {
      setCurrent(tag);
      setBusy(false);
      setError(null);
    }
  }

  const words = tagScopeWords(current?.scope ?? 'media');

  const confirm = async () => {
    if (current === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteTag(current.id);
      setBusy(false);
      onDeleted(current);
      onClose();
      toast.success(`Tag “${current.name}” deleted`);
    } catch (caught) {
      setBusy(false);
      setError(caught);
      // Someone else deleted it meanwhile: the list on the page is out of date.
      if (isApiRequestError(caught) && caught.status === 404) onDeleted(current);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Delete this ${words.tag}?`}
      size="sm"
      busy={busy}
      returnFocus={returnFocus}
      footer={
        <>
          <Button onClick={onClose} data-autofocus data-testid="settings-tag-delete-cancel">
            Cancel
          </Button>
          <Button
            variant="danger-solid"
            busy={busy}
            onClick={() => {
              void confirm();
            }}
            data-testid="settings-tag-delete-confirm"
          >
            Delete tag
          </Button>
        </>
      }
    >
      {current !== null && (
        <div className="tx-settings-confirm" data-testid="settings-tag-delete">
          {error !== null && <ErrorNotice error={error} title="The tag was not deleted" />}
          <div className="tx-settings-confirm__tag">
            <Chip colour={current.colour}>{current.name}</Chip>
          </div>
          <p data-testid="settings-tag-delete-consequence">
            {tagDeleteConsequence(current.scope, current.usageCount)}
          </p>
          <p className="tx-muted">This cannot be undone. The tag is removed for everyone.</p>
        </div>
      )}
    </Dialog>
  );
}
