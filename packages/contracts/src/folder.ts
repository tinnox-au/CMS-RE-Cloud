import { z } from 'zod';
import { FolderIdSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { labelSchema } from './text.ts';

/** Folder name in a request body. Unique per organisation, ignoring case. */
export const FolderNameSchema = labelSchema(ABSOLUTE.maxFolderNameLength, 'folder name');

/** A flat media folder. A media item is in one folder or in none (the root). */
export const FolderDtoSchema = z
  .object({
    id: FolderIdSchema,
    name: z.string().min(1).max(ABSOLUTE.maxFolderNameLength),
    /** Media items in the folder, not counting deleted ones. */
    itemCount: z.number().int().nonnegative(),
  })
  .strict();
export type FolderDto = z.infer<typeof FolderDtoSchema>;

/** `GET /api/folders`: ordered by name ignoring case. */
export const FolderListResponseSchema = z
  .object({ items: z.array(FolderDtoSchema).max(ABSOLUTE.maxListItems) })
  .strict();
export type FolderListResponse = z.infer<typeof FolderListResponseSchema>;

/** `POST /api/folders` answers 201 with the `FolderDto`. A name already in use answers 409 `conflict`. */
export const FolderCreateSchema = z.object({ name: FolderNameSchema }).strict();
export type FolderCreate = z.infer<typeof FolderCreateSchema>;

/**
 * `PATCH /api/folders/:id` renames a folder and answers with the `FolderDto`.
 * `DELETE /api/folders/:id` answers 204; the media in the folder moves to the root.
 */
export const FolderPatchSchema = z.object({ name: FolderNameSchema }).strict();
export type FolderPatch = z.infer<typeof FolderPatchSchema>;
