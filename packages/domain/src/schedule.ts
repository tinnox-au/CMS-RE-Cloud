import type { PlanPublicationResult } from './manifest.ts';
import { planSources, type PlanPlaylist } from './sources.ts';
import type { PublicationDraft, PublicationValidator } from './types.ts';

export interface SchedulePlanInput {
  readonly defaultPlaylistId: string;
  /** In priority order. */
  readonly events: readonly {
    readonly playlistId: string;
    readonly days: readonly boolean[];
    readonly start: string;
    readonly end: string;
  }[];
  /** Called once per distinct playlist, so `plan` runs at most once per playlist. */
  readonly planPlaylist: PlanPlaylist;
  /** Judges the combined draft: the total number of items. */
  readonly route: PublicationValidator;
}

/**
 * The publishing rule for a display that has a schedule assigned. Every playlist of the
 * schedule is planned on its own, so an issue keeps the item number of its own playlist and
 * says where the playlist is used (`default`, or `events[n]` for the first event that uses
 * it). A schedule that can only ever play its default playlist (no events, or every event
 * names the default) gives exactly the default playlist's draft, so the screen keeps the
 * lowest manifest version that fits. Otherwise the draft holds every playlist's items in one
 * list, default playlist first, and a `schedule` block that names the runs and the events.
 * When the playlists together hold more items than the route takes, that is the only issue,
 * and no playlist is planned: a successful plan keeps every item, so the count is the total.
 */
export function planSchedulePublication(input: SchedulePlanInput): PlanPublicationResult {
  // Distinct playlists in slice order: the default, then event playlists in first-use order.
  // Identifiers are UUIDs, which compare without regard to letter case.
  const sources = new Map<string, string>([[input.defaultPlaylistId.toLowerCase(), 'default']]);
  input.events.forEach((event, n) => {
    const id = event.playlistId.toLowerCase();
    if (!sources.has(id)) sources.set(id, `events[${n}]`);
  });

  const planned = planSources(
    [...sources].map(([playlistId, source]) => ({ source, playlistId })),
    input.planPlaylist,
    input.route,
    'schedule',
  );
  if (!planned.ok) return planned;
  const drafts = planned.drafts;

  const [defaultDraft] = drafts;
  // Unreachable: with no issue there is one draft per playlist, and the default is the first.
  if (defaultDraft === undefined) throw new Error('a schedule always has a default playlist');
  // The player could only ever pick slice 0.
  if (drafts.length === 1) return { ok: true, draft: defaultDraft };

  const slices = [...sources.keys()];
  const combined: PublicationDraft = {
    ...defaultDraft,
    items: drafts.flatMap((draft) => draft.items),
    schedule: {
      playlists: drafts.map((draft) => ({
        count: draft.items.length,
        transition: draft.transition,
        shuffle: draft.shuffle,
      })),
      events: input.events.map((event) => ({
        playlist: slices.indexOf(event.playlistId.toLowerCase()),
        days: [...event.days],
        start: event.start,
        end: event.end,
      })),
    },
  };
  // Each playlist already passed on its own and the total was checked above; the route
  // judges the combined draft all the same.
  const total = input.route.validate(combined);
  if (total.length > 0) {
    return { ok: false, issues: total.map((issue) => ({ ...issue, path: 'schedule' })) };
  }
  return { ok: true, draft: combined };
}
