import { z } from 'zod';
import { DisplayIdSchema, PlaylistIdSchema } from './ids.ts';
import { ABSOLUTE } from './limits.ts';

const refName = z.string().min(1).max(ABSOLUTE.maxNameLength);

/** A display named inside another response: enough to show it and link to it. */
export const DisplayRefSchema = z.object({ id: DisplayIdSchema, name: refName }).strict();
export type DisplayRef = z.infer<typeof DisplayRefSchema>;

/** A playlist named inside another response: enough to show it and link to it. */
export const PlaylistRefSchema = z.object({ id: PlaylistIdSchema, name: refName }).strict();
export type PlaylistRef = z.infer<typeof PlaylistRefSchema>;
