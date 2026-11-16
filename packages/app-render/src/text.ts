import type { ClockSettings, DateSettings } from '@tinnox/contracts';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** en-AU formatter in `timeZone` (null: this device's zone), cached per zone and options. */
export function formatter(
  timeZone: string | null,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${timeZone ?? ''}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (found === undefined) {
    try {
      found = new Intl.DateTimeFormat('en-AU', { ...options, timeZone: timeZone ?? undefined });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      // fail open: an old ICU must not blank an app
      found = new Intl.DateTimeFormat('en-AU', options);
    }
    formatters.set(key, found);
  }
  return found;
}

export function clockText(
  epochMs: number,
  timeZone: string | null,
  { hourCycle, showSeconds }: Pick<ClockSettings, 'hourCycle' | 'showSeconds'>,
): string {
  return formatter(timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    ...(showSeconds ? { second: '2-digit' } : {}),
    hourCycle: hourCycle === '12' ? 'h12' : 'h23',
  }).format(epochMs);
}

const DATE_OPTIONS: Record<DateSettings['format'], Intl.DateTimeFormatOptions> = {
  long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  short: { weekday: 'short', day: 'numeric', month: 'short' },
  numeric: { day: '2-digit', month: '2-digit', year: 'numeric' },
};

export function dateText(
  epochMs: number,
  timeZone: string | null,
  format: DateSettings['format'],
): string {
  return formatter(timeZone, DATE_OPTIONS[format]).format(epochMs);
}

const two = (n: number): string => String(n).padStart(2, '0');

/** "2 days 04:05:06", "04:05", or null once the moment has come. Rounds up to the shown unit. */
export function countdownText(remainingMs: number, showSeconds: boolean): string | null {
  if (remainingMs <= 0) return null;
  const unit = showSeconds ? 1000 : 60_000;
  const total = Math.ceil(remainingMs / unit);
  const perDay = showSeconds ? 86_400 : 1440;
  const days = Math.floor(total / perDay);
  const rest = total % perDay;
  const parts = showSeconds
    ? [Math.floor(rest / 3600), Math.floor(rest / 60) % 60, rest % 60]
    : [Math.floor(rest / 60), rest % 60];
  const prefix = days === 0 ? '' : days === 1 ? '1 day ' : `${String(days)} days `;
  return prefix + parts.map(two).join(':');
}
