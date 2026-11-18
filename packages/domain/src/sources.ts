import { contentTotalMessage } from './capability.ts';
import type { PlanPublicationResult } from './manifest.ts';
import type { PublicationDraft, PublicationValidator, PublishIssue } from './types.ts';

/**
 * One playlist for the target display: its name, its number of items, and `plan`, which plans
 * it (planPublication with the display, records, limits and route bound) when called.
 * Undefined: the playlist no longer exists. Called once per source, with the id in lower case.
 * A layout may name one playlist in two zones, so `plan` may run twice for one id and must be pure.
 */
export type PlanPlaylist = (playlistId: string) =>
  | {
      readonly name: string;
      readonly itemCount: number;
      readonly plan: () => PlanPublicationResult;
    }
  | undefined;

/** One playlist of a schedule or a layout, and where it is used: `default`, `events[n]` or `zones[n]`. */
export interface PlanSource {
  readonly source: string;
  readonly playlistId: string;
}

export type PlannedSources =
  | { readonly ok: true; readonly drafts: readonly PublicationDraft[] }
  | { readonly ok: false; readonly issues: readonly PublishIssue[] };

/**
 * The planning step a schedule and a layout share: every source's playlist is planned on its
 * own, so an issue keeps the item number of its own playlist and says where the playlist is
 * used (`${source}.playlist` or `${source}.items[n]`). When the playlists together hold more
 * items than the route takes, that is the only issue, and no playlist is planned: a successful
 * plan keeps every item, so the count is the total. On success the drafts are in source order.
 */
export function planSources(
  sources: readonly PlanSource[],
  planPlaylist: PlanPlaylist,
  route: PublicationValidator,
  owner: 'schedule' | 'layout',
): PlannedSources {
  const found = sources.map(({ source, playlistId }) => ({
    source,
    playlist: planPlaylist(playlistId),
  }));
  if (sources.length > 1 && found.every(({ playlist }) => playlist !== undefined)) {
    const total = found.reduce((sum, { playlist }) => sum + (playlist?.itemCount ?? 0), 0);
    const profile = route.capabilities();
    // shortcut: one total for all playlists of a schedule or a layout; give them their own limit if 200 proves tight.
    if (total > profile.maxItems) {
      return {
        ok: false,
        issues: [
          {
            index: null,
            code: 'too_many_items',
            path: owner,
            message: contentTotalMessage(owner, total, profile.label, profile.maxItems),
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
        message: `A playlist of this ${owner} no longer exists. Open the ${owner} and choose another.`,
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
  return { ok: true, drafts };
}
