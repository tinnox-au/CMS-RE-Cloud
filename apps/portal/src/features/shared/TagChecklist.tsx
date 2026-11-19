import { TAG_COLOURS, type TagColour, type TagDto } from '@tinnox/contracts';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { moveIndex } from '../../lib/keyboardNav.ts';
import {
  findTagByName,
  searchTags,
  suggestTagColour,
  tagColourLabel,
  tagNameProblem,
  type TagCoverage,
} from '../../lib/tagColours.ts';
import { Check, CircleExclamationPoint, Minus, Plus } from '../../ui/icons.ts';
import {
  Button,
  cx,
  ErrorNotice,
  Icon,
  SearchField,
  Skeleton,
  SkeletonGroup,
  Spinner,
  VisuallyHidden,
} from '../../ui/index.ts';
import './shared.css';
import type { TagsResource } from './useTags.ts';

/** The padding of the list box: an option scrolled to its edge keeps this much air. */
const LIST_EDGE = 6;

export interface TagChecklistProps {
  readonly tags: TagsResource;
  /** `all` draws a tick, `some` a dash (several items, not all of them carry the tag). */
  readonly stateOf: (tagId: string) => TagCoverage;
  readonly onToggle: (tag: TagDto) => void;
  /** A tag was just created here; the owner turns it on. */
  readonly onCreated: (tag: TagDto) => void;
  /** False when the role may not create tags in this scope: search only, no "Create tag". */
  readonly allowCreate?: boolean;
  readonly disabled?: boolean;
  /** No further tag can be turned on: the limit of tags on one item is reached. */
  readonly atLimit?: boolean;
  /** Read after the name of a tag in the `some` state: "on some of the selected files". */
  readonly someHint?: string;
  readonly testId: string;
}

/**
 * The searchable list behind `TagPicker` and `TagsDialog`: a search field that drives a
 * multi-select list box (the ARIA combobox pattern: Arrow keys move, Enter turns a tag on or
 * off, Escape clears the search), and, when the typed name is not a tag yet, an offer to
 * create it in a chosen colour. A refusal by the server (a name taken a moment ago, the limit
 * of tags) is shown with its code; nothing is added before the server has answered.
 */
export function TagChecklist({
  tags,
  stateOf,
  onToggle,
  onCreated,
  allowCreate = true,
  disabled = false,
  atLimit = false,
  someHint = 'on some of the selected items',
  testId,
}: TagChecklistProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [colourChoice, setColourChoice] = useState<TagColour | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState('');

  const ready = tags.status === 'ready';
  const matches = ready ? searchTags(tags.tags, query) : [];
  const newName = query.trim();
  const offerCreate =
    allowCreate && ready && newName !== '' && findTagByName(tags.tags, newName) === undefined;
  const nameProblem = offerCreate ? tagNameProblem(newName) : null;
  const optionCount = matches.length + (offerCreate ? 1 : 0);
  const activeIndex = optionCount === 0 ? -1 : Math.min(active, optionCount - 1);
  const colour = colourChoice ?? suggestTagColour(tags.tags);
  const createBlocked = disabled || atLimit || nameProblem !== null;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const activeId = activeIndex >= 0 ? optionId(activeIndex) : undefined;

  // Keep the option the keyboard is on inside the scrolling list. Only the list is scrolled:
  // `scrollIntoView` would also move the page, and a picker in a form must never do that.
  useEffect(() => {
    const list = listRef.current;
    const option = activeId === undefined ? null : document.getElementById(activeId);
    if (list === null || option === null) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < list.scrollTop + LIST_EDGE) list.scrollTop = top - LIST_EDGE;
    else if (bottom > list.scrollTop + list.clientHeight - LIST_EDGE) {
      list.scrollTop = bottom - list.clientHeight + LIST_EDGE;
    }
  }, [activeId]);

  const isLocked = (tag: TagDto) => disabled || (atLimit && stateOf(tag.id) !== 'all');

  const toggle = (tag: TagDto) => {
    if (!isLocked(tag)) onToggle(tag);
  };

  const create = async () => {
    if (creating || !offerCreate || createBlocked) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await tags.createTag(newName, colour);
      onCreated(created);
      setQuery('');
      setActive(0);
      setColourChoice(null);
      setAnnouncement(`Tag ${created.name} created and added.`);
    } catch (error) {
      setCreateError(error);
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(
        moveIndex(activeIndex, optionCount, event.key === 'ArrowDown' ? 'next' : 'previous'),
      );
      return;
    }
    if (event.key !== 'Enter') return;
    // Never let Enter submit a form this picker happens to sit in.
    event.preventDefault();
    const tag = matches[activeIndex];
    if (tag !== undefined) toggle(tag);
    else if (offerCreate && activeIndex === matches.length) void create();
  };

  return (
    <div
      className="tx-shared-checklist"
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      }}
    >
      <SearchField
        label={allowCreate ? 'Search tags or type a new name' : 'Search tags'}
        placeholder={allowCreate ? 'Search or create a tag' : 'Search tags'}
        value={query}
        onChange={(next) => {
          setQuery(next);
          setActive(0);
          setCreateError(null);
        }}
        role="combobox"
        aria-expanded={optionCount > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        disabled={disabled || !ready}
        onKeyDown={onKeyDown}
        data-testid={`${testId}-search`}
      />

      {tags.status === 'loading' && (
        <SkeletonGroup
          label="Loading tags"
          className="tx-shared-options tx-shared-options--loading"
        >
          <Skeleton height="16px" width="55%" />
          <Skeleton height="16px" width="40%" />
          <Skeleton height="16px" width="62%" />
        </SkeletonGroup>
      )}
      {tags.status === 'error' && (
        <ErrorNotice
          error={tags.error}
          title="The tags could not be loaded"
          onRetry={tags.reload}
        />
      )}

      {ready && (
        <ul
          ref={listRef}
          id={listId}
          className="tx-shared-options"
          role="listbox"
          aria-label="Tags"
          aria-multiselectable="true"
          hidden={optionCount === 0}
          data-testid={`${testId}-list`}
        >
          {matches.map((tag, index) => {
            const state = stateOf(tag.id);
            const locked = isLocked(tag);
            return (
              <li
                key={tag.id}
                id={optionId(index)}
                className="tx-shared-option"
                role="option"
                aria-selected={state === 'all'}
                aria-disabled={locked || undefined}
                data-active={index === activeIndex || undefined}
                data-state={state}
                data-tag-id={tag.id}
                // Keep the focus in the search field, where the keyboard works.
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onPointerMove={() => {
                  if (index !== activeIndex) setActive(index);
                }}
                onClick={() => {
                  toggle(tag);
                }}
              >
                <span className="tx-shared-option__box" aria-hidden="true">
                  {state === 'all' && <Icon icon={Check} size={14} />}
                  {state === 'some' && <Icon icon={Minus} size={14} />}
                </span>
                <span
                  className={cx('tx-shared-dot', `tx-shared-colour--${tag.colour}`)}
                  aria-hidden="true"
                />
                <span className="tx-shared-option__name">{tag.name}</span>
                {state === 'some' && (
                  <span className="tx-shared-option__note">
                    <span aria-hidden="true">Some</span>
                    <VisuallyHidden>({someHint})</VisuallyHidden>
                  </span>
                )}
              </li>
            );
          })}
          {offerCreate && (
            <li
              id={optionId(matches.length)}
              className="tx-shared-option tx-shared-option--create"
              role="option"
              aria-selected={false}
              aria-disabled={createBlocked || creating || undefined}
              data-active={activeIndex === matches.length || undefined}
              data-testid={`${testId}-create`}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onPointerMove={() => {
                if (activeIndex !== matches.length) setActive(matches.length);
              }}
              onClick={() => {
                void create();
              }}
            >
              <span
                className="tx-shared-option__box tx-shared-option__box--plain"
                aria-hidden="true"
              >
                {creating ? <Spinner /> : <Icon icon={Plus} size={16} />}
              </span>
              <span className="tx-shared-option__name">
                {creating ? 'Creating' : 'Create'} tag “{newName}”
              </span>
            </li>
          )}
        </ul>
      )}

      {ready && optionCount === 0 && (
        <p className="tx-shared-checklist__empty">
          {tags.tags.length === 0
            ? allowCreate
              ? 'No tags yet. Type a name to create the first one.'
              : 'No tags yet.'
            : 'No tag matches the search.'}
        </p>
      )}

      {offerCreate && nameProblem !== null && (
        <p className="tx-field__error" role="alert">
          <Icon icon={CircleExclamationPoint} size={16} />
          <span>{nameProblem}</span>
        </p>
      )}
      {offerCreate && nameProblem === null && atLimit && (
        <p className="tx-shared-checklist__empty">
          The limit of tags on one item is reached. Remove a tag to add another.
        </p>
      )}
      {offerCreate && !createBlocked && (
        <fieldset className="tx-shared-swatches" data-testid={`${testId}-colours`}>
          <legend className="tx-shared-swatches__legend">
            Colour of the new tag: <span className="tx-strong">{tagColourLabel(colour)}</span>
          </legend>
          <div className="tx-shared-swatches__row">
            {TAG_COLOURS.map((option) => (
              <label key={option} className={cx('tx-shared-swatch', `tx-shared-colour--${option}`)}>
                <input
                  type="radio"
                  className="tx-shared-swatch__input"
                  name={`${baseId}-colour`}
                  value={option}
                  checked={colour === option}
                  disabled={creating}
                  aria-label={tagColourLabel(option)}
                  onChange={() => {
                    setColourChoice(option);
                  }}
                />
                <span className="tx-shared-swatch__dot" aria-hidden="true">
                  <Icon icon={Check} size={14} />
                </span>
              </label>
            ))}
            <Button
              size="sm"
              icon={Plus}
              busy={creating}
              className="tx-shared-swatches__create"
              data-testid={`${testId}-create-button`}
              onClick={() => {
                void create();
              }}
            >
              Create tag
            </Button>
          </div>
        </fieldset>
      )}

      {createError !== null && (
        <ErrorNotice
          error={createError}
          title="The tag was not created"
          onDismiss={() => {
            setCreateError(null);
          }}
        />
      )}
      <span className="tx-visually-hidden" role="status">
        {announcement}
      </span>
    </div>
  );
}
