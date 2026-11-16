import { z } from 'zod';
import { TagIdSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';
import { labelSchema } from './text.ts';

/** What a tag can be put on. A tag belongs to one scope for life. */
export const TAG_SCOPES = ['media', 'display'] as const;
export const TagScopeSchema = z.enum(TAG_SCOPES);
export type TagScope = z.infer<typeof TagScopeSchema>;

/** Names of the tag colours. The portal maps each name to its own design tokens. */
export const TAG_COLOURS = [
  'teal',
  'sky',
  'slate',
  'green',
  'amber',
  'red',
  'violet',
  'pink',
] as const;
export const TagColourSchema = z.enum(TAG_COLOURS);
export type TagColour = z.infer<typeof TagColourSchema>;

export const DEFAULT_TAG_COLOUR: TagColour = 'teal';

/** Tag name in a request body. Unique per organisation and scope, ignoring case. */
export const TagNameSchema = labelSchema(ABSOLUTE.maxTagNameLength, 'tag name');

export const TagDtoSchema = z
  .object({
    id: TagIdSchema,
    scope: TagScopeSchema,
    name: z.string().min(1).max(ABSOLUTE.maxTagNameLength),
    colour: TagColourSchema,
    /**
     * How many media items (scope `media`, deleted ones not counted) or displays
     * (scope `display`) carry the tag.
     */
    usageCount: z.number().int().nonnegative(),
  })
  .strict();
export type TagDto = z.infer<typeof TagDtoSchema>;

/** Query of `GET /api/tags`. Without `scope` the tags of both scopes are listed. */
export const TagListQuerySchema = z.object({ scope: TagScopeSchema.optional() }).strict();
export type TagListQuery = z.infer<typeof TagListQuerySchema>;

/** `GET /api/tags`: ordered by scope, then by name ignoring case. */
export const TagListResponseSchema = z
  .object({ items: z.array(TagDtoSchema).max(ABSOLUTE.maxListItems) })
  .strict();
export type TagListResponse = z.infer<typeof TagListResponseSchema>;

/**
 * `POST /api/tags` answers 201 with the `TagDto`. A name already used in the
 * same scope answers 409 `conflict`.
 */
export const TagCreateSchema = z
  .object({
    scope: TagScopeSchema,
    name: TagNameSchema,
    colour: TagColourSchema.default(DEFAULT_TAG_COLOUR),
  })
  .strict();
export type TagCreate = z.infer<typeof TagCreateSchema>;
export type TagCreateInput = z.input<typeof TagCreateSchema>;

/**
 * `PATCH /api/tags/:id` renames or recolours a tag and answers with the `TagDto`.
 * The scope cannot be changed. `DELETE /api/tags/:id` answers 204 and removes the
 * tag from everything that carried it.
 */
export const TagPatchSchema = z
  .object({
    name: TagNameSchema.optional(),
    colour: TagColourSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'at least one field is required' });
export type TagPatch = z.infer<typeof TagPatchSchema>;

/** The tags of one media item or one display in a response. The order carries no meaning. */
export const TagIdsSchema = z.array(TagIdSchema).max(ABSOLUTE.maxTagsPerItem);

/**
 * The complete set of tags for one media item or one display in a request body;
 * it replaces the current set. Every id must be a tag of the matching scope in
 * the caller's organisation, otherwise the API answers 404.
 */
export const TagIdsInputSchema = TagIdsSchema.refine(
  (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
  { message: 'a tag may be listed only once' },
);
export type TagIds = z.infer<typeof TagIdsSchema>;
