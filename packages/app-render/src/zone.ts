const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
  let found = zoneFormatters.get(timeZone);
  if (found === undefined) {
    try {
      // h23, as player core/time-rules.ts: `hour12: false` can give "24".
      found = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      found = null;
    }
    zoneFormatters.set(timeZone, found);
  }
  return found;
}

/** The wall clock of `epochMs` in the zone, read as if it were UTC, minus `epochMs`. */
function offset(format: Intl.DateTimeFormat, epochMs: number): number {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of format.formatToParts(epochMs)) p[type] = value;
  const wall = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return wall - Math.floor(epochMs / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` reads `stamp` ('YYYY-MM-DDTHH:mm').
 * A null or unknown zone uses this device's zone.
 */
// shortcut: a target inside the skipped DST hour moves by an hour, and one inside the repeated hour is ambiguous; upgrade if reported.
export function wallToEpoch(stamp: string, timeZone: string | null): number {
  const format = timeZone === null ? null : zoneFormatter(timeZone);
  if (format === null) return new Date(stamp).getTime();
  const guess = Date.parse(`${stamp}:00Z`);
  const o1 = offset(format, guess);
  const t = guess - o1;
  const o2 = offset(format, t);
  return o2 === o1 ? t : guess - o2;
}
