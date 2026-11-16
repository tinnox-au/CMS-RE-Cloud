import {
  ABSOLUTE,
  TAG_SCOPES,
  type TagColour,
  type TagDto,
  type TagPatch,
  type TagScope,
} from '@tinnox/contracts';
import { findTagByName, tagNameProblem } from './tagColours.ts';

/**
 * The settings pages: the two kinds of tag and what they are put on, the checks of the tag
 * form, the consequence of deleting a tag, and the rows of settings that are planned.
 * Pure functions, no DOM.
 *
 * The API's scope `display` is what an operator reads as "screen".
 */

/* ---------- Tag scopes ---------- */

export const DEFAULT_TAG_SCOPE: TagScope = 'media';

/** The scope in the address (`?scope=display`); anything else is the media tags. */
export function parseTagScope(value: string | null | undefined): TagScope {
  return TAG_SCOPES.find((scope) => scope === value) ?? DEFAULT_TAG_SCOPE;
}

export interface TagScopeWords {
  /** The tab and the settings row: "Media tags". */
  readonly title: string;
  /** In a sentence: "media tag". */
  readonly tag: string;
  /** What carries a tag of this scope: "file", "screen". */
  readonly item: string;
  readonly items: string;
  /** One line under the settings row. */
  readonly description: string;
}

const SCOPE_WORDS: { readonly [K in TagScope]: TagScopeWords } = {
  media: {
    title: 'Media tags',
    tag: 'media tag',
    item: 'file',
    items: 'files',
    description: 'Labels for sorting and filtering the media library.',
  },
  display: {
    title: 'Screen tags',
    tag: 'screen tag',
    item: 'screen',
    items: 'screens',
    description: 'Labels for grouping and filtering screens.',
  },
};

export function tagScopeWords(scope: TagScope): TagScopeWords {
  return SCOPE_WORDS[scope];
}

/** Where the tags of a scope are managed. */
export function tagsPath(scope: TagScope): string {
  return `/settings/tags?scope=${scope}`;
}

/* ---------- Counts ---------- */

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/** "No tags", "1 tag", "12 tags". */
export function tagCountLabel(value: number): string {
  return value === 0 ? 'No tags' : count(value, 'tag', 'tags');
}

/** "No folders", "1 folder", "3 folders". */
export function folderCountLabel(value: number): string {
  return value === 0 ? 'No folders' : count(value, 'folder', 'folders');
}

/** How many files a folder holds: "Empty", "1 file", "8 files". */
export function folderItemsLabel(itemCount: number): string {
  return itemCount === 0 ? 'Empty' : count(itemCount, 'file', 'files');
}

/** How many items carry a tag: "Not used", "1 file", "4 screens". */
export function tagUsageLabel(scope: TagScope, usageCount: number): string {
  const words = SCOPE_WORDS[scope];
  return usageCount === 0 ? 'Not used' : count(usageCount, words.item, words.items);
}

/** The tags of one scope out of a list that may hold both. */
export function tagsOfScope(tags: readonly TagDto[], scope: TagScope): TagDto[] {
  return tags.filter((tag) => tag.scope === scope);
}

/* ---------- The tag form ---------- */

/**
 * Checks the name in the tag form: the rules the API applies, and that no other tag of the
 * same scope has the name already (ignoring case, as the API compares). `selfId` is the tag
 * being edited, which may keep its own name or change only its letter case. Returns the
 * message for the field, or null. The API remains the authority.
 */
export function tagFormNameProblem(
  name: string,
  scope: TagScope,
  existing: readonly Pick<TagDto, 'id' | 'name'>[],
  selfId: string | null = null,
): string | null {
  const problem = tagNameProblem(name);
  if (problem !== null) return problem;
  const others = selfId === null ? existing : existing.filter((tag) => tag.id !== selfId);
  if (findTagByName(others, name) !== undefined) {
    return `Another ${SCOPE_WORDS[scope].tag} already has this name.`;
  }
  return null;
}

export interface TagFormValues {
  readonly name: string;
  readonly colour: TagColour;
}

/**
 * What to send for an edited tag: only the fields that differ from the stored tag, with the
 * name trimmed. Null when nothing changed, so no request is made.
 */
export function tagPatchFor(
  original: Pick<TagDto, 'name' | 'colour'>,
  values: TagFormValues,
): TagPatch | null {
  const name = values.name.trim();
  const patch: { name?: string; colour?: TagColour } = {};
  if (name !== original.name) patch.name = name;
  if (values.colour !== original.colour) patch.colour = values.colour;
  return Object.keys(patch).length === 0 ? null : patch;
}

/** What the toast says after an edit: which of the two things changed. */
export function tagSavedMessage(patch: TagPatch): string {
  if (patch.name !== undefined && patch.colour !== undefined) return 'Tag renamed and recoloured';
  if (patch.name !== undefined) return 'Tag renamed';
  return 'Tag colour changed';
}

/* ---------- Deleting a tag ---------- */

/**
 * The consequence of deleting a tag, for the confirmation: how many items lose it. The
 * number is the usage the list last showed.
 */
export function tagDeleteConsequence(scope: TagScope, usageCount: number): string {
  const words = SCOPE_WORDS[scope];
  if (usageCount === 0) return `No ${words.item} carries this tag, so nothing else changes.`;
  if (usageCount === 1) {
    return `1 ${words.item} will lose this tag. The ${words.item} itself is not changed.`;
  }
  return `${usageCount} ${words.items} will lose this tag. The ${words.items} themselves are not changed.`;
}

/* ---------- Planned settings ---------- */

export type PlannedSettingId = 'users' | 'working-hours' | 'alerts' | 'api-tokens';

export interface PlannedSetting {
  readonly id: PlannedSettingId;
  readonly title: string;
  readonly description: string;
  /** The stage of docs/portal-v2/README.md that brings it; null when no stage names it yet. */
  readonly stage: 'B' | 'C' | null;
}

export const PLANNED_SETTINGS: readonly PlannedSetting[] = [
  {
    id: 'users',
    title: 'Users and roles',
    description: 'Invite people and choose what an owner, an admin, an editor and a viewer may do.',
    stage: 'C',
  },
  {
    id: 'working-hours',
    title: 'Working hours',
    description: 'Set the hours in which screens show content.',
    stage: 'B',
  },
  {
    id: 'alerts',
    title: 'Alerts',
    description: 'Send an e-mail when a screen stops reporting.',
    stage: 'C',
  },
  {
    id: 'api-tokens',
    title: 'API tokens',
    description: 'Let other systems work with the CMS through tokens that can be revoked.',
    stage: null,
  },
];

/** "Planned for stage B"; "Planned for a later stage" when no stage names the setting. */
export function plannedStageLabel(stage: PlannedSetting['stage']): string {
  return stage === null ? 'Planned for a later stage' : `Planned for stage ${stage}`;
}

/* ---------- Refusals of the tag form ---------- */

/** What the portal needs of a refused request: the API's code and the fields it names. */
export interface TagRefusal {
  readonly code: string;
  readonly details?: readonly { readonly path?: string }[];
}

/**
 * The message for the name field when the server refused a tag because of its name: a name
 * already used in the scope (409 `conflict`), or a name the server's own check refused
 * (`validation_failed` naming `name`). The API also answers `conflict` when the organisation
 * already has the most tags it may have (`ABSOLUTE.maxListItems`, both scopes together), so a
 * conflict counts as a name problem only below that ceiling. Null for any other refusal,
 * which the dialog shows as an alert with the server's message and code.
 */
export function tagRefusalNameProblem(
  scope: TagScope,
  refusal: TagRefusal,
  organisationTagCount: number,
): string | null {
  if (refusal.code === 'conflict' && organisationTagCount < ABSOLUTE.maxListItems) {
    return `Another ${SCOPE_WORDS[scope].tag} already has this name. Choose a different name.`;
  }
  if (
    refusal.code === 'validation_failed' &&
    (refusal.details ?? []).some((detail) => detail.path === 'name')
  ) {
    return 'The server did not accept this name. Use letters, numbers and ordinary punctuation.';
  }
  return null;
}

/** Where the files carrying a media tag are listed; null for screen tags (no such filter). */
export function tagItemsPath(tag: Pick<TagDto, 'id' | 'scope'>): string | null {
  return tag.scope === 'media' ? `/media?tag=${encodeURIComponent(tag.id)}` : null;
}

/** Where the files of a folder are listed. */
export function folderPath(folderId: string): string {
  return `/media?folder=${encodeURIComponent(folderId)}`;
}
