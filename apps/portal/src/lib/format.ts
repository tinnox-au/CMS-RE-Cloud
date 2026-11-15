/** Presentation helpers. Pure functions, no DOM. */

const BYTE_UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(value < 10 ? 1 : 0);
  return `${text} ${BYTE_UNITS[unit] ?? 'bytes'}`;
}

/** 4500 -> "4.5 s", 65000 -> "1 min 5 s", 3600000 -> "1 h 0 min". */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return `${Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)} s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 3600) {
    return `${Math.floor(totalSeconds / 60)} min ${totalSeconds % 60} s`;
  }
  return `${Math.floor(totalSeconds / 3600)} h ${Math.floor((totalSeconds % 3600) / 60)} min`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** Relative age for "last heard from" displays. Negative ages (clock skew) read as "just now". */
export function formatAge(ageSeconds: number): string {
  if (!Number.isFinite(ageSeconds)) return 'unknown';
  const seconds = Math.max(0, Math.floor(ageSeconds));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${plural(seconds, 'second')} ago`;
  if (seconds < 3600) return `${plural(Math.floor(seconds / 60), 'minute')} ago`;
  if (seconds < 86_400) return `${plural(Math.floor(seconds / 3600), 'hour')} ago`;
  return `${plural(Math.floor(seconds / 86_400), 'day')} ago`;
}

const timestampFormat = new Intl.DateTimeFormat('en-AU', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});

/** A UTC timestamp from the API in the viewer's local time zone, with the zone named. */
export function formatTimestamp(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return timestampFormat.format(time);
}

/** First block of a UUID, for compact display next to the full value. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
