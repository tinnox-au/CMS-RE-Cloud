import {
  eventCovers,
  localWallClock,
  manifestPlaylists,
  withinWorkingHours,
  type Manifest,
  type ManifestV1,
  type ManifestV4,
  type WallClock,
} from '@tinnox/contracts';

/** No playlist is skipped (the default of `playableIndexes`). */
const NO_SLICES: ReadonlySet<number> = new Set<number>();

/**
 * The site's wall clock for a manifest with time rules, or null when it cannot be trusted:
 * the two fail-open tests every time rule shares.
 */
function trustedWallClock(
  manifest: Exclude<Manifest, ManifestV1>,
  epochMs: number,
): WallClock | null {
  // fail open: clock behind the publication is untrustworthy; never blank on a dead RTC
  if (epochMs < Date.parse(manifest.createdAt) - 300_000) return null;
  // Same fail-open rule: a zone this browser does not know must not blank the screen.
  return localWallClock(epochMs, manifest.timeZone);
}

/** The playlists the events name at `local`, in priority order, each once. */
function coveringAt(manifest: ManifestV4, local: WallClock): number[] {
  const slices: number[] = [];
  for (const event of manifest.schedule.events) {
    if (eventCovers(event, local.day, local.time) && !slices.includes(event.playlist)) {
      slices.push(event.playlist);
    }
  }
  return slices;
}

/**
 * The playlists (indexes into `manifestPlaylists(manifest)`) that the schedule's events name
 * for `epochMs`, in priority order, each once. Empty when the manifest has no schedule, when
 * the clock or the zone cannot be trusted, or when no event covers the moment. It may contain
 * 0: an event may name the default playlist to cut a hole in a lower event.
 */
export function coveringSlices(manifest: Manifest, epochMs: number): number[] {
  if (manifest.schemaVersion !== 4) return [];
  const local = trustedWallClock(manifest, epochMs);
  return local === null ? [] : coveringAt(manifest, local);
}

/** The manifest indexes of a playlist slice, `from` to `from + count - 1`, in listed order. */
export function sliceIndexes({ from, count }: { from: number; count: number }): number[] {
  return Array.from({ length: count }, (_, offset) => from + offset);
}

/**
 * Manifest indexes that may be shown at `epochMs`: inside the screen's working hours, in the
 * playlist the schedule picks, and inside each item's availability window, all read in the
 * site's zone. The result never mixes playlists: every index is in the same slice.
 *
 * With a schedule the events are checked from the top. The first covering event whose
 * playlist has something to show now wins; a playlist in `skipSlices` (it just failed) is
 * passed over; the default playlist (slice 0, never skipped) plays when no covering event has
 * anything. An untrusted clock or zone plays the default playlist only, windows ignored.
 */
// shortcut: an edge inside the repeated DST fall-back hour is ambiguous; upgrade if reported. An event in the repeated hour plays twice; one wholly inside the skipped hour does not play that day.
// shortcut: a clock that is wrong but not behind the publication picks the wrong event with no signal; add time-sync gating (spec section 11 rule 7) with hardware players.
export function playableIndexes(
  manifest: Manifest,
  epochMs: number,
  skipSlices: ReadonlySet<number> = NO_SLICES,
): number[] {
  const slices = manifestPlaylists(manifest);
  const indexesOf = (slice: number): number[] =>
    sliceIndexes(slices[slice] ?? { from: 0, count: 0 });
  if (manifest.schemaVersion === 1) return indexesOf(0);
  const local = trustedWallClock(manifest, epochMs);
  // Versions 2 and 3 have one slice, the whole list; version 4 falls back to its default playlist.
  if (local === null) return indexesOf(0);
  if (!withinWorkingHours(manifest.workingHours, local)) return [];
  const covering = manifest.schemaVersion === 4 ? coveringAt(manifest, local) : [];
  for (const candidate of [...covering, 0]) {
    if (candidate !== 0 && skipSlices.has(candidate)) continue;
    // Apps have no availability window; working hours above apply to them too.
    const playable = indexesOf(candidate).filter((index) => {
      const asset = manifest.assets[index];
      return (
        asset !== undefined &&
        (asset.kind === 'app' ||
          ((asset.availableFrom ?? '') <= local.stamp &&
            (asset.availableUntil === null || local.stamp < asset.availableUntil)))
      );
    });
    if (playable.length > 0) return playable;
  }
  return [];
}
