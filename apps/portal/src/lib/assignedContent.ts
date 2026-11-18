/**
 * What a screen has assigned: a playlist, a schedule or a layout (docs/portal-v2/stage-b.md,
 * slice 4, section 7). Pure functions, no DOM. One place reads the three fields, so a page
 * that names, links or compares a screen's content needs no branch per kind.
 */
import type { DisplayDto, PushPlanRow } from '@tinnox/contracts';

export type ContentKind = 'playlist' | 'schedule' | 'layout';

export interface ContentRef {
  readonly kind: ContentKind;
  readonly id: string;
  readonly name: string;
}

/** The Record makes TypeScript ask for a fourth kind. */
export const CONTENT_KIND_LABEL: Record<ContentKind, string> = {
  playlist: 'Playlist',
  schedule: 'Schedule',
  layout: 'Layout',
};

function ref(kind: ContentKind, named: { readonly id: string; readonly name: string }): ContentRef {
  return { kind, id: named.id, name: named.name };
}

/** What a screen has assigned, or null. At most one of the three is set. */
export function assignedContent(
  display: Pick<DisplayDto, 'assignedPlaylist' | 'assignedSchedule' | 'assignedLayout'>,
): ContentRef | null {
  if (display.assignedLayout !== null) return ref('layout', display.assignedLayout);
  if (display.assignedSchedule !== null) return ref('schedule', display.assignedSchedule);
  if (display.assignedPlaylist !== null) return ref('playlist', display.assignedPlaylist);
  return null;
}

/**
 * What a push-plan row is about: its layout, else its schedule, else its playlist; null for
 * nothing assigned. A row of a layout or a schedule also carries a playlist (the main zone's
 * or the default), so the container wins.
 */
export function planRowContent(
  row: Pick<PushPlanRow, 'playlist' | 'schedule' | 'layout'>,
): ContentRef | null {
  if (row.layout !== null) return ref('layout', row.layout);
  if (row.schedule !== null) return ref('schedule', row.schedule);
  if (row.playlist !== null) return ref('playlist', row.playlist);
  return null;
}

/** `/playlists/:id`, `/schedules/:id` or `/layouts/:id`. */
export function contentHref(kind: ContentKind, id: string): string {
  return `/${kind}s/${id}`;
}

/** The sentence a playlist-assign dialog adds when a screen it is about has a schedule or a layout. */
export const CONTENT_REPLACED_NOTE =
  'A screen that has a schedule or a layout gets this playlist instead.';

/** True when any of the screens has a schedule or a layout: assigning a playlist replaces it. */
export function anyHasOtherContent(
  displays: readonly Pick<DisplayDto, 'assignedPlaylist' | 'assignedSchedule' | 'assignedLayout'>[],
): boolean {
  return displays.some((display) => {
    const kind = assignedContent(display)?.kind;
    return kind === 'schedule' || kind === 'layout';
  });
}
