import { ABSOLUTE, type Canvas, type LayoutBox, type Rect } from '@tinnox/contracts';
import { effectiveContentRect, zoneRect } from './geometry.ts';
import type { PlanPublicationResult } from './manifest.ts';
import { planSources, type PlanPlaylist } from './sources.ts';
import type { PublicationDraft, PublicationValidator, PublishIssue } from './types.ts';

export interface LayoutPlanInput {
  readonly canvas: Canvas;
  readonly contentRect: Rect | null;
  /** Two to ABSOLUTE.maxLayoutZones zones in position order; [0] is the main zone. Basis points (LAYOUT_UNITS). */
  readonly zones: readonly ({ readonly playlistId: string } & LayoutBox)[];
  readonly planPlaylist: PlanPlaylist;
  /** Judges the combined draft: the number of regions and the item total. */
  readonly route: PublicationValidator;
}

/**
 * The publishing rule for a display that has a layout assigned. The zones are resolved to whole
 * pixels of this display's content area first; a zone under 16 px either way blocks the display
 * (`zone_too_small` at `zones[n]`) and nothing is planned. Then every zone's playlist is planned
 * on its own (`planSources`, issues at `zones[n].playlist` or `zones[n].items[k]`, the total at
 * `layout`), and the draft holds every zone's items in one list, main zone first, with one
 * `zones` entry per zone. The route judges the combined draft last (`layout`).
 */
export function planLayoutPublication(input: LayoutPlanInput): PlanPublicationResult {
  const area = effectiveContentRect(input.canvas, input.contentRect);
  const rects = input.zones.map((zone) => zoneRect(area, zone));
  const min = ABSOLUTE.minCanvasSidePx;
  const tooSmall: PublishIssue[] = [];
  rects.forEach((rect, n) => {
    if (rect.width < min || rect.height < min) {
      tooSmall.push({
        index: null,
        code: 'zone_too_small',
        path: `zones[${n}]`,
        message: `On this screen zone ${n + 1} of the layout is ${rect.width} × ${rect.height} px; a zone needs at least ${min} px each way. Make it larger in the layout, or assign other content.`,
      });
    }
  });
  // Without this check buildManifest's self-check would throw on the zone's rectangle.
  if (tooSmall.length > 0) return { ok: false, issues: tooSmall };

  // shortcut: a playlist in two zones is sent twice; share a run by index if the item total bites.
  const planned = planSources(
    input.zones.map((zone, n) => ({
      source: `zones[${n}]`,
      playlistId: zone.playlistId.toLowerCase(),
    })),
    input.planPlaylist,
    input.route,
    'layout',
  );
  if (!planned.ok) return planned;
  const { drafts } = planned;

  const [main] = drafts;
  // Unreachable: with no issue there is one draft per zone.
  if (main === undefined) throw new Error('a layout always has a main zone');
  const combined: PublicationDraft = {
    ...main,
    items: drafts.flatMap((d) => d.items),
    zones: drafts.map((d, n) => {
      const rect = rects[n];
      // Unreachable: there is one rectangle per zone.
      if (rect === undefined) throw new Error('a zone has no rectangle');
      // Every count is positive: an empty playlist is refused by its own plan.
      return { rect, count: d.items.length, transition: d.transition, shuffle: d.shuffle };
    }),
  };
  const issues = input.route.validate(combined);
  if (issues.length > 0) {
    return { ok: false, issues: issues.map((issue) => ({ ...issue, path: 'layout' })) };
  }
  return { ok: true, draft: combined };
}
