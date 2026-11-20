import type { TagDto } from '@tinnox/contracts';
import { useId, useState } from 'react';
import { countOf } from '../../lib/bulkOutcome.ts';
import { MAX_TAGS_PER_ITEM, resolveTags } from '../../lib/tagColours.ts';
import { ChevronDown, ChevronUp, Tags } from '../../ui/icons.ts';
import { Button, Chip, ChipList, cx, Skeleton } from '../../ui/index.ts';
import './shared.css';
import { TagChecklist } from './TagChecklist.tsx';
import type { TagsResource } from './useTags.ts';

export interface TagPickerProps {
  /** The page's tags, from `useTags(scope)`. Tags created in the picker are created in its scope. */
  readonly tags: TagsResource;
  /** The chosen tag ids: the `tagIds` of the item, or the form's draft of them. */
  readonly value: readonly string[];
  /** The complete new list. Nothing is saved: the page sends it with its own Save. */
  readonly onChange: (tagIds: readonly string[]) => void;
  /** Accessible name of the group. Default "Tags". */
  readonly label?: string;
  readonly disabled?: boolean;
  /** False when the role may not create tags in this scope: the list searches only. Default true. */
  readonly allowCreate?: boolean;
  /**
   * Starts as the chosen chips and an "Add or remove tags" button that opens the list, for a
   * form where the list should not take room until it is wanted. Default false: the list is
   * always open (a dialog, a Tags tab).
   */
  readonly collapsible?: boolean;
  /** Default `shared-tag-picker`. */
  readonly testId?: string;
  /** From a `Field`: `{(control) => <TagPicker {...control} … />}`. */
  readonly id?: string;
  readonly 'aria-describedby'?: string | undefined;
  readonly 'aria-invalid'?: true | undefined;
  readonly 'aria-required'?: true | undefined;
  readonly className?: string;
}

/**
 * Chooses the tags of one item: the chosen tags as removable chips, and a searchable list
 * with ticks. A name that is not a tag yet can be created on the spot, in a chosen colour;
 * the new tag is added to the item's draft. One item carries at most 50 tags.
 */
export function TagPicker({
  tags,
  value,
  onChange,
  label = 'Tags',
  disabled = false,
  allowCreate = true,
  collapsible = false,
  testId = 'shared-tag-picker',
  id,
  'aria-describedby': describedBy,
  className,
}: TagPickerProps) {
  const panelId = useId();
  const [open, setOpen] = useState(!collapsible);
  const chosenIds = new Set(value);
  const chosen = resolveTags(value, tags.byId);
  const atLimit = value.length >= MAX_TAGS_PER_ITEM;
  const showList = !collapsible || open;

  const toggle = (tag: TagDto) => {
    onChange(
      chosenIds.has(tag.id) ? value.filter((other) => other !== tag.id) : [...value, tag.id],
    );
  };

  return (
    <div
      id={id}
      className={cx('tx-shared-tagpicker', className)}
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      data-testid={testId}
    >
      <div className="tx-shared-tagpicker__chosen" data-testid={`${testId}-chosen`}>
        {value.length === 0 && <span className="tx-small tx-muted">No tags chosen.</span>}
        {value.length > 0 && tags.status === 'loading' && (
          <Skeleton variant="pill" width="72px" height="28px" />
        )}
        {value.length > 0 && tags.status === 'error' && (
          <span className="tx-small tx-muted">{countOf(value.length, 'tag')} chosen.</span>
        )}
        {chosen.length > 0 && (
          <ChipList label="Chosen tags">
            {chosen.map((tag) => (
              <li key={tag.id}>
                <Chip
                  colour={tag.colour}
                  disabled={disabled}
                  onRemove={() => {
                    onChange(value.filter((other) => other !== tag.id));
                  }}
                  removeLabel={`Remove tag ${tag.name}`}
                >
                  {tag.name}
                </Chip>
              </li>
            ))}
          </ChipList>
        )}
        {collapsible && (
          <Button
            size="sm"
            variant="ghost"
            icon={Tags}
            trailingIcon={open ? ChevronUp : ChevronDown}
            aria-expanded={open}
            aria-controls={panelId}
            disabled={disabled}
            data-testid={`${testId}-toggle`}
            onClick={() => {
              setOpen(!open);
            }}
          >
            {open ? 'Hide tag list' : 'Add or remove tags'}
          </Button>
        )}
      </div>
      <div id={panelId} className="tx-shared-tagpicker__panel" hidden={!showList}>
        {showList && (
          <TagChecklist
            tags={tags}
            stateOf={(tagId) => (chosenIds.has(tagId) ? 'all' : 'none')}
            onToggle={toggle}
            onCreated={(tag) => {
              if (!chosenIds.has(tag.id)) onChange([...value, tag.id]);
            }}
            allowCreate={allowCreate}
            disabled={disabled}
            atLimit={atLimit}
            testId={`${testId}-checklist`}
          />
        )}
      </div>
    </div>
  );
}
