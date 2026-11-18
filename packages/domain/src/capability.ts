import type { CapabilityProfile } from '@tinnox/contracts';
import type { PublicationDraft, PublishIssue } from './types.ts';

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why the playlists of a schedule or a layout are refused together: their item total is over the route's limit. */
export function contentTotalMessage(
  owner: 'schedule' | 'layout',
  total: number,
  route: string,
  max: number,
): string {
  return `The playlists of this ${owner} hold ${total} items in total; ${route} supports up to ${max}.`;
}

// shortcut: a layout may put video in every zone (up to 8 <video> elements while items swap); add CapabilityProfile.maxVideoRegions if Pi-class players lag (AV4:56).
/** How many content regions a draft needs: one per zone of a layout, else one. */
export function regionCount(draft: PublicationDraft): number {
  return draft.zones?.length ?? 1;
}

/**
 * Compares a publication draft with a route's capability profile.
 * Returns human-readable rejection reasons; an empty array means the route can show it.
 * Pure data comparison: no route-specific code.
 */
export function checkCapabilities(
  draft: PublicationDraft,
  profile: CapabilityProfile,
): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const route = profile.label;

  if (regionCount(draft) > profile.maxRegions) {
    issues.push({
      index: null,
      code: 'multiple_regions_unsupported',
      message: `${route} can show ${profile.maxRegions} content region(s); this publication needs ${regionCount(draft)}.`,
    });
  }
  if (draft.audio && !profile.audio) {
    issues.push({
      index: null,
      code: 'audio_unsupported',
      message: `${route} plays video muted; audio is not available.`,
    });
  }
  if (
    draft.canvas.width > profile.maxCanvas.width ||
    draft.canvas.height > profile.maxCanvas.height
  ) {
    issues.push({
      index: null,
      code: 'canvas_too_large',
      message: `The screen canvas is ${draft.canvas.width}x${draft.canvas.height}; ${route} supports up to ${profile.maxCanvas.width}x${profile.maxCanvas.height}.`,
    });
  }
  if (draft.contentRect !== null && !profile.supportsContentRect) {
    issues.push({
      index: null,
      code: 'content_rect_unsupported',
      message: `${route} cannot place content in a sub-rectangle of the output frame. Remove the content rectangle from the screen.`,
    });
  }
  // shortcut: every route is the browser route, which plays schedules; add schedules to CapabilityProfile when a route that cannot evaluate them ships.
  if (draft.items.length > profile.maxItems) {
    issues.push({
      index: null,
      code: 'too_many_items',
      message:
        draft.zones !== null
          ? contentTotalMessage('layout', draft.items.length, route, profile.maxItems)
          : draft.schedule !== null
            ? contentTotalMessage('schedule', draft.items.length, route, profile.maxItems)
            : `The playlist has ${draft.items.length} items; ${route} supports up to ${profile.maxItems}.`,
    });
  }

  draft.items.forEach((item, index) => {
    // shortcut: every route is the browser route, which draws apps; add apps to CapabilityProfile when a route that cannot draw them ships.
    if (item.kind === 'app') return;
    const n = index + 1;
    if (!profile.mediaTypes.includes(item.mediaType)) {
      issues.push({
        index,
        code: 'unsupported_media_type',
        message: `Item ${n} is ${item.mediaType}, which ${route} cannot show. Supported types: ${profile.mediaTypes.join(', ')}.`,
      });
      return;
    }
    if (item.kind === 'video') {
      if (item.codec === null || !profile.videoCodecs.includes(item.codec.toLowerCase())) {
        issues.push({
          index,
          code: 'unsupported_codec',
          message: `Item ${n} uses the video codec ${item.codec ?? 'unknown'}, which ${route} cannot play. Supported codecs: ${profile.videoCodecs.join(', ') || 'none'}.`,
        });
      }
      if (item.width > profile.maxVideoWidthPx || item.height > profile.maxVideoHeightPx) {
        issues.push({
          index,
          code: 'video_resolution_too_large',
          message: `Item ${n} is a ${item.width}x${item.height} video; ${route} supports up to ${profile.maxVideoWidthPx}x${profile.maxVideoHeightPx}.`,
        });
      }
    }
    if (!profile.fitModes.includes(item.fit)) {
      issues.push({
        index,
        code: 'unsupported_fit',
        message: `Item ${n} uses the fit mode "${item.fit}", which ${route} does not support.`,
      });
    }
    if (item.bytes > profile.maxAssetBytes) {
      issues.push({
        index,
        code: 'asset_too_large',
        message: `Item ${n} is ${megabytes(item.bytes)}; ${route} accepts files up to ${megabytes(profile.maxAssetBytes)}.`,
      });
    }
  });

  return issues;
}
