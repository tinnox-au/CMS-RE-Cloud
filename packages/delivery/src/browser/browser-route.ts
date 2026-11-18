import {
  ABSOLUTE,
  CapabilityProfileSchema,
  DEFAULT_LIMITS,
  HeartbeatV1Schema,
  manifestEtag,
  type CapabilityProfile,
  type Manifest,
} from '@tinnox/contracts';
import { checkCapabilities, type PublicationDraft, type PublishIssue } from '@tinnox/domain';
import type { DeliveryRoute, NormalizeStatusResult } from '../port.ts';

/** The browser player pulls its manifest; nothing is pushed. */
export interface BrowserPreparedPublication {
  readonly kind: 'pull';
  readonly etag: string;
  readonly manifest: Manifest;
}

export interface BrowserRouteOptions {
  /** Largest single asset the route accepts. Defaults to the default upload limit. */
  readonly maxAssetBytes?: number;
  readonly maxItems?: number;
  readonly maxVideoWidthPx?: number;
  readonly maxVideoHeightPx?: number;
}

/**
 * Browser route, capability profile version 2: JPEG, PNG and MP4 (H.264), muted, up to four
 * regions (the zones of a layout; one without a layout), contain or cover, optional content
 * rectangle. Version 1 had one full-frame region. Tested in desktop Chrome only; it says nothing
 * about LED controllers.
 */
export function createBrowserRoute(
  options: BrowserRouteOptions = {},
): DeliveryRoute<BrowserPreparedPublication> {
  const profile: CapabilityProfile = Object.freeze(
    CapabilityProfileSchema.parse({
      routeId: 'browser',
      profileVersion: 2,
      label: 'The browser player',
      mediaTypes: ['image/jpeg', 'image/png', 'video/mp4'],
      videoCodecs: ['h264'],
      fitModes: ['contain', 'cover'],
      maxRegions: ABSOLUTE.maxLayoutZones,
      audio: false,
      supportsContentRect: true,
      maxCanvas: { width: ABSOLUTE.maxCanvasSidePx, height: ABSOLUTE.maxCanvasSidePx },
      maxVideoWidthPx: options.maxVideoWidthPx ?? DEFAULT_LIMITS.maxVideoWidthPx,
      maxVideoHeightPx: options.maxVideoHeightPx ?? DEFAULT_LIMITS.maxVideoHeightPx,
      maxAssetBytes: options.maxAssetBytes ?? DEFAULT_LIMITS.maxUploadBytes,
      maxItems: options.maxItems ?? DEFAULT_LIMITS.maxPlaylistItems,
    }),
  );

  return Object.freeze({
    id: 'browser' as const,
    capabilities(): CapabilityProfile {
      return profile;
    },
    validate(draft: PublicationDraft): readonly PublishIssue[] {
      return checkCapabilities(draft, profile);
    },
    prepare(manifest: Manifest): BrowserPreparedPublication {
      return { kind: 'pull', etag: manifestEtag(manifest.publicationId), manifest };
    },
    normalizeStatus(report: unknown): NormalizeStatusResult {
      const parsed = HeartbeatV1Schema.safeParse(report);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return {
          ok: false,
          message: first
            ? `${first.path.join('.') || 'report'}: ${first.message}`
            : 'report failed validation',
        };
      }
      return { ok: true, report: parsed.data, evidence: 'player_software' };
    },
  });
}
