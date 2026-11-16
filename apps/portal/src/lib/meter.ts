/** Maths for the storage meter. Pure. */

export type MeterTone = 'ok' | 'warn' | 'danger';

/** Share of `max` that is used, from 0 to 1. A missing or zero limit reads as empty. */
export function meterFraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/** Attention from 80 per cent, danger from 95 per cent. */
export function meterTone(fraction: number): MeterTone {
  if (fraction >= 0.95) return 'danger';
  if (fraction >= 0.8) return 'warn';
  return 'ok';
}

/** "0%", "37%", "100%"; anything above zero shows at least 1% and anything below full at most 99%. */
export function meterPercentLabel(fraction: number): string {
  if (fraction <= 0) return '0%';
  if (fraction >= 1) return '100%';
  return `${Math.min(99, Math.max(1, Math.round(fraction * 100)))}%`;
}
