import type { Limits } from '@tinnox/contracts';

export type DurationResult =
  { readonly ok: true; readonly ms: number } | { readonly ok: false; readonly message: string };

type DurationLimits = Pick<Limits, 'minImageItemDurationMs' | 'maxImageItemDurationMs'>;

function secondsText(ms: number): string {
  return String(ms / 1000);
}

/**
 * Parses the seconds an operator typed for an image item. Whole seconds or up to
 * three decimals; the result is whole milliseconds inside the configured range.
 */
export function parseImageDuration(text: string, limits: DurationLimits): DurationResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, message: 'Enter a duration in seconds.' };
  if (!/^[0-9]{1,7}(\.[0-9]{1,3})?$/.test(trimmed)) {
    return { ok: false, message: 'Use a number of seconds, for example 10 or 7.5.' };
  }
  const ms = Math.round(Number(trimmed) * 1000);
  if (ms < limits.minImageItemDurationMs) {
    return {
      ok: false,
      message: `Must be at least ${secondsText(limits.minImageItemDurationMs)} s.`,
    };
  }
  if (ms > limits.maxImageItemDurationMs) {
    return {
      ok: false,
      message: `Must be at most ${secondsText(limits.maxImageItemDurationMs)} s.`,
    };
  }
  return { ok: true, ms };
}

/** Text shown in the seconds field for a stored duration. */
export function durationFieldText(ms: number): string {
  return secondsText(ms);
}
