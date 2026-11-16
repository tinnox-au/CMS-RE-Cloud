import type { CapabilityProfile } from '@tinnox/contracts';
import type { PublicationDraft, PublishIssue } from './types.ts';

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  if (draft.regions > profile.maxRegions) {
    issues.push({
      index: null,
      code: 'multiple_regions_unsupported',
      message: `${route} can show ${profile.maxRegions} content region(s); this publication needs ${draft.regions}.`,
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
  if (draft.items.length > profile.maxItems) {
    issues.push({
      index: null,
      code: 'too_many_items',
      message: `The playlist has ${draft.items.length} items; ${route} supports up to ${profile.maxItems}.`,
    });
  }

  draft.items.forEach((item, index) => {
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
