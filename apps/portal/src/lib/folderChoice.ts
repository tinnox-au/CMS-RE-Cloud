import { ABSOLUTE, FolderNameSchema, type FolderDto } from '@tinnox/contracts';
import { matchesSearch } from './listView.ts';

/**
 * Media folders as the portal offers them: flat, one per item, with the root of the library
 * as the place of everything that is in no folder. Pure functions, no DOM.
 */

/** How the root of the library is named wherever a folder can be chosen. */
export const LIBRARY_ROOT_LABEL = 'Library root';

const collator = new Intl.Collator('en-AU', { numeric: true, sensitivity: 'base' });

/** A copy ordered by name, ignoring case, digits by number. */
export function sortFolders<T extends Pick<FolderDto, 'name'>>(folders: readonly T[]): T[] {
  return folders.slice().sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * The name of the place an item is in. `null` is the root. An id that is not in the list
 * (a folder deleted a moment ago) reads "Folder not found" instead of a blank.
 */
export function folderLabel(
  folderId: string | null,
  byId: ReadonlyMap<string, Pick<FolderDto, 'name'>>,
): string {
  if (folderId === null) return LIBRARY_ROOT_LABEL;
  return byId.get(folderId)?.name ?? 'Folder not found';
}

/** The folder that already has this name, ignoring case and outer spaces, as the API compares. */
export function findFolderByName<T extends Pick<FolderDto, 'name'>>(
  folders: readonly T[],
  name: string,
): T | undefined {
  const wanted = name.trim().toLowerCase();
  if (wanted === '') return undefined;
  return folders.find((folder) => folder.name.trim().toLowerCase() === wanted);
}

/**
 * Checks a new folder name the way the API will, and against the folders already listed.
 * Returns the message to show, or null when the name can be sent. The API remains the
 * authority; its refusal is shown as it arrives.
 */
export function folderNameProblem(
  name: string,
  existing: readonly Pick<FolderDto, 'name'>[] = [],
): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name for the folder.';
  if (trimmed.length > ABSOLUTE.maxFolderNameLength) {
    return `Use ${ABSOLUTE.maxFolderNameLength} characters or fewer.`;
  }
  if (!FolderNameSchema.safeParse(trimmed).success) {
    return 'The name contains characters that cannot be used.';
  }
  if (findFolderByName(existing, trimmed) !== undefined) {
    return 'A folder with this name already exists.';
  }
  return null;
}

/** The folders whose name matches every word of the query; all of them for an empty query. */
export function searchFolders<T extends Pick<FolderDto, 'name'>>(
  folders: readonly T[],
  query: string,
): T[] {
  return folders.filter((folder) => matchesSearch([folder.name], query));
}

/**
 * The items a move would actually change: those not already in the target (`null` is the
 * root). Moving the rest would be a request that changes nothing.
 */
export function itemsToMove<T extends { readonly folderId: string | null }>(
  items: readonly T[],
  targetFolderId: string | null,
): T[] {
  return items.filter((item) => item.folderId !== targetFolderId);
}
