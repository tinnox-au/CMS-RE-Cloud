import {
  ABSOLUTE,
  DEFAULT_TAG_COLOUR,
  TAG_COLOURS,
  TagNameSchema,
  type TagColour,
  type TagDto,
} from '@tinnox/contracts';
import { matchesSearch } from './listView.ts';

/**
 * Tags as the portal shows and edits them: colour names, ordering, lookups, the "+N" summary
 * of a row, searching the picker, and the arithmetic of editing the tags of several items at
 * once. Pure functions, no DOM.
 */

/** The colour names an operator reads next to the swatches. */
export const TAG_COLOUR_LABELS: { readonly [K in TagColour]: string } = {
  teal: 'Teal',
  sky: 'Sky',
  slate: 'Slate',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  violet: 'Violet',
  pink: 'Pink',
};

export function tagColourLabel(colour: TagColour): string {
  return TAG_COLOUR_LABELS[colour];
}

/**
 * The colour proposed for a new tag: the one the existing tags use least, so a fresh set of
 * tags spreads over the palette. Ties go to the earlier colour; with no tags it is the
 * API's default.
 */
export function suggestTagColour(tags: readonly Pick<TagDto, 'colour'>[]): TagColour {
  if (tags.length === 0) return DEFAULT_TAG_COLOUR;
  const counts = new Map<TagColour, number>(TAG_COLOURS.map((colour) => [colour, 0]));
  for (const tag of tags) counts.set(tag.colour, (counts.get(tag.colour) ?? 0) + 1);
  let best: TagColour = DEFAULT_TAG_COLOUR;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const colour of TAG_COLOURS) {
    const count = counts.get(colour) ?? 0;
    if (count < bestCount) {
      best = colour;
      bestCount = count;
    }
  }
  return best;
}

const collator = new Intl.Collator('en-AU', { numeric: true, sensitivity: 'base' });

/** A copy ordered by name, ignoring case, digits by number. */
export function sortTags<T extends Pick<TagDto, 'name'>>(tags: readonly T[]): T[] {
  return tags.slice().sort((a, b) => collator.compare(a.name, b.name));
}

export function tagsById<T extends Pick<TagDto, 'id'>>(tags: readonly T[]): ReadonlyMap<string, T> {
  return new Map(tags.map((tag) => [tag.id, tag]));
}

/**
 * The tags behind a list of ids, ordered by name. Ids that are not in `byId` (a tag deleted
 * a moment ago, or a list that is still loading) are left out.
 */
export function resolveTags<T extends Pick<TagDto, 'id' | 'name'>>(
  tagIds: readonly string[],
  byId: ReadonlyMap<string, T>,
): T[] {
  const found: T[] = [];
  const seen = new Set<string>();
  for (const id of tagIds) {
    const tag = byId.get(id);
    if (tag !== undefined && !seen.has(id)) {
      seen.add(id);
      found.push(tag);
    }
  }
  return sortTags(found);
}

export interface TagSummary<T> {
  /** The tags to draw as chips. */
  readonly shown: readonly T[];
  /** The tags behind the "+N" chip, in order. */
  readonly hidden: readonly T[];
}

/**
 * Splits a row's tags into the chips that are drawn and the rest behind "+N". A "+1" chip
 * would take the room of the tag it hides, so one tag over the limit is simply drawn.
 */
export function summariseTags<T>(tags: readonly T[], max: number): TagSummary<T> {
  const limit = Math.max(1, Math.floor(max));
  if (tags.length <= limit + 1) return { shown: tags, hidden: [] };
  return { shown: tags.slice(0, limit), hidden: tags.slice(limit) };
}

/** The tags whose name matches every word of the query; all of them for an empty query. */
export function searchTags<T extends Pick<TagDto, 'name'>>(tags: readonly T[], query: string): T[] {
  return tags.filter((tag) => matchesSearch([tag.name], query));
}

/** The tag that already has this name, ignoring case and outer spaces, as the API compares. */
export function findTagByName<T extends Pick<TagDto, 'name'>>(
  tags: readonly T[],
  name: string,
): T | undefined {
  const wanted = name.trim().toLowerCase();
  if (wanted === '') return undefined;
  return tags.find((tag) => tag.name.trim().toLowerCase() === wanted);
}

/**
 * Checks a new tag name the way the API will. Returns the message to show, or null when the
 * name can be sent. The API remains the authority; its refusal is shown as it arrives.
 */
export function tagNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name for the tag.';
  if (trimmed.length > ABSOLUTE.maxTagNameLength) {
    return `Use ${ABSOLUTE.maxTagNameLength} characters or fewer.`;
  }
  if (!TagNameSchema.safeParse(trimmed).success) {
    return 'The name contains characters that cannot be used.';
  }
  return null;
}

/**
 * True when an item passes the tag filter. With nothing selected everything passes;
 * otherwise the item must carry at least one of the selected tags (`any`, the default) or
 * every one of them (`all`).
 */
export function matchesTagFilter(
  itemTagIds: readonly string[],
  selected: ReadonlySet<string>,
  mode: 'any' | 'all' = 'any',
): boolean {
  if (selected.size === 0) return true;
  const carried = new Set(itemTagIds);
  if (mode === 'all') {
    for (const id of selected) if (!carried.has(id)) return false;
    return true;
  }
  for (const id of selected) if (carried.has(id)) return true;
  return false;
}

/** How many of the edited items carry a tag. */
export type TagCoverage = 'all' | 'some' | 'none';

/** The coverage of one tag over the tag lists of the items being edited. */
export function tagCoverage(
  itemTagLists: readonly (readonly string[])[],
  tagId: string,
): TagCoverage {
  if (itemTagLists.length === 0) return 'none';
  let count = 0;
  for (const tagIds of itemTagLists) if (tagIds.includes(tagId)) count += 1;
  if (count === 0) return 'none';
  return count === itemTagLists.length ? 'all' : 'some';
}

/**
 * What the operator decided in the tags dialog: tags to put on every item and tags to take
 * off every item. A tag in neither set is left as each item has it.
 */
export interface TagChanges {
  readonly add: ReadonlySet<string>;
  readonly remove: ReadonlySet<string>;
}

export const NO_TAG_CHANGES: TagChanges = { add: new Set(), remove: new Set() };

/** What the checklist shows for a tag: the decision if there is one, else the coverage. */
export function tagStateWithChanges(
  coverage: TagCoverage,
  changes: TagChanges,
  tagId: string,
): TagCoverage {
  if (changes.add.has(tagId)) return 'all';
  if (changes.remove.has(tagId)) return 'none';
  return coverage;
}

/**
 * A press on a tag in the checklist. A tag that is on every item comes off; any other tag
 * goes on every item. A decision that merely restates how things already are is dropped, so
 * undoing a press leaves nothing to save.
 */
export function toggleTagChange(
  coverage: TagCoverage,
  changes: TagChanges,
  tagId: string,
): TagChanges {
  const add = new Set(changes.add);
  const remove = new Set(changes.remove);
  const turnOn = tagStateWithChanges(coverage, changes, tagId) !== 'all';
  add.delete(tagId);
  remove.delete(tagId);
  if (turnOn && coverage !== 'all') add.add(tagId);
  if (!turnOn && coverage !== 'none') remove.add(tagId);
  return { add, remove };
}

/**
 * The new complete tag list of one item, or null when the changes leave it as it is (no
 * request is needed). The order of the kept tags does not change; added tags go last.
 */
export function applyTagChanges(current: readonly string[], changes: TagChanges): string[] | null {
  const next = current.filter((id) => !changes.remove.has(id));
  const carried = new Set(next);
  for (const id of changes.add) {
    if (!carried.has(id)) {
      carried.add(id);
      next.push(id);
    }
  }
  const unchanged =
    next.length === current.length && next.every((id, index) => id === current[index]);
  return unchanged ? null : next;
}

/** The most tags one item may carry. */
export const MAX_TAGS_PER_ITEM = ABSOLUTE.maxTagsPerItem;
