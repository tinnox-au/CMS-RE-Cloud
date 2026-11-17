import { scheduleTotalMessage } from './capability.ts';
import type { PlanPublicationResult } from './manifest.ts';
import type { PublicationDraft, PublicationValidator, PublishIssue } from './types.ts';

export interface SchedulePlanInput {
  readonly defaultPlaylistId: string;
  /** In priority order. */
  readonly events: readonly {
    readonly playlistId: string;
    readonly days: readonly boolean[];
    readonly start: string;
    readonly end: string;
  }[];
  /**
   * One playlist for the target display: its name, its number of items, and `plan`, which
   * plans it (planPublication with the display, records, limits and route bound) when
   * called. Undefined: the playlist no longer exists. Called once per distinct playlist,
   * with the id in lower case; `plan` at most once.
   */
  readonly planPlaylist: (playlistId: string) =>
    | {
        readonly name: string;
        readonly itemCount: number;
        readonly plan: () => PlanPublicationResult;
      }
    | undefined;
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

  const found = [...sources].map(([id, source]) => ({ source, playlist: input.planPlaylist(id) }));
  if (sources.size > 1 && found.every(({ playlist }) => playlist !== undefined)) {
    const total = found.reduce((sum, { playlist }) => sum + (playlist?.itemCount ?? 0), 0);
    const profile = input.route.capabilities();
    // shortcut: one total for all playlists of a schedule; give schedules their own limit if 200 proves tight.
    if (total > profile.maxItems) {
      return {
        ok: false,
        issues: [
          {
            index: null,
            code: 'too_many_items',
            path: 'schedule',
            message: scheduleTotalMessage(total, profile.label, profile.maxItems),
          },
        ],
      };
    }
  }

  // shortcut: a display-level refusal (canvas, content rectangle) is repeated once per playlist; the browser route never raises one. De-duplicate when a route that can ships.
  const issues: PublishIssue[] = [];
  const drafts: PublicationDraft[] = [];
  for (const { source, playlist } of found) {
    if (playlist === undefined) {
      issues.push({
        index: null,
        code: 'playlist_empty',
        path: `${source}.playlist`,
        message:
          'A playlist of this schedule no longer exists. Open the schedule and choose another.',
      });
      continue;
    }
    const plan = playlist.plan();
    if (!plan.ok) {
      for (const issue of plan.issues) {
        issues.push({
          index: issue.index,
          code: issue.code,
          path: `${source}.${issue.index === null ? 'playlist' : `items[${issue.index}]`}`,
          message: `In playlist "${playlist.name}": ${issue.message}`,
        });
      }
    } else {
      drafts.push(plan.draft);
    }
  }
  if (issues.length > 0) return { ok: false, issues };

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
