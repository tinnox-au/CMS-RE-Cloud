import type { Manifest } from '@tinnox/contracts';

/** A moment as read on a wall clock in some zone. `day` 0 is Monday. */
export interface WallClock {
  /** 'YYYY-MM-DDTHH:mm', comparable as a string with manifest windows. */
  readonly stamp: string;
  readonly day: number;
  /** 'HH:mm', comparable as a string with working hours. */
  readonly time: string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      // This browser's ICU does not know the zone.
      formatter = null;
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall clock in `timeZone` at `epochMs`, or null when the browser refuses the zone. */
export function localWallClock(epochMs: number, timeZone: string): WallClock | null {
  const formatter = formatterFor(timeZone);
  if (formatter === null) return null;
  const part: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of formatter.formatToParts(epochMs)) part[type] = value;
  const time = `${part.hour ?? ''}:${part.minute ?? ''}`;
  return {
    stamp: `${part.year ?? ''}-${part.month ?? ''}-${part.day ?? ''}T${time}`,
    day: WEEKDAYS.indexOf(part.weekday ?? ''),
    time,
  };
}

/**
 * Manifest indexes that may be shown at `epochMs`: inside the screen's working
 * hours and inside each item's availability window, read in the site's zone.
 */
// shortcut: an edge inside the repeated DST fall-back hour is ambiguous; upgrade if reported.
export function playableIndexes(manifest: Manifest, epochMs: number): number[] {
  const all = manifest.assets.map((_, index) => index);
  if (manifest.schemaVersion === 1) return all;
  // fail open: clock behind the publication is untrustworthy; never blank on a dead RTC
  if (epochMs < Date.parse(manifest.createdAt) - 300_000) return all;
  const local = localWallClock(epochMs, manifest.timeZone);
  // Same fail-open rule: a zone this browser does not know must not blank the screen.
  if (local === null) return all;
  if (manifest.workingHours !== null) {
    const today = manifest.workingHours[local.day];
    if (
      today === null ||
      today === undefined ||
      !(today.start <= local.time && local.time < today.end)
    )
      return [];
  }
  // Apps have no availability window; working hours above apply to them too.
  return manifest.assets.flatMap((asset, index) =>
    asset.kind === 'app' ||
    ((asset.availableFrom ?? '') <= local.stamp &&
      (asset.availableUntil === null || local.stamp < asset.availableUntil))
      ? [index]
      : [],
  );
}
