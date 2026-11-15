import { z } from 'zod';
import { CanvasSchema, FitModeSchema } from './canvas.ts';
import { DeliveryRouteIdSchema } from './display.ts';
import { MediaMimeTypeSchema } from './media.ts';

/**
 * What one delivery route can show. A publication is checked against the
 * profile of the target display's route before it is created.
 */
export const CapabilityProfileSchema = z
  .object({
    routeId: DeliveryRouteIdSchema,
    profileVersion: z.number().int().positive(),
    /** Short human-readable route name used in rejection messages. */
    label: z.string().min(1).max(80),
    mediaTypes: z.array(MediaMimeTypeSchema).min(1),
    /** Codec names as reported by media inspection (ffprobe codec_name). */
    videoCodecs: z.array(z.string().min(1).max(40)),
    fitModes: z.array(FitModeSchema).min(1),
    /** Number of simultaneous content regions. 1 means full-frame playlists only. */
    maxRegions: z.number().int().positive(),
    audio: z.boolean(),
    supportsContentRect: z.boolean(),
    maxCanvas: CanvasSchema,
    maxVideoWidthPx: z.number().int().positive(),
    maxVideoHeightPx: z.number().int().positive(),
    maxAssetBytes: z.number().int().positive(),
    maxItems: z.number().int().positive(),
  })
  .strict();
export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;
