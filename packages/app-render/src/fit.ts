/** Largest font size in [min, max] for which `fits` holds (10 halvings), or `min` when none does. */
export function searchFontSize(fits: (px: number) => boolean, min: number, max: number): number {
  if (max <= min || fits(max)) return Math.max(min, max);
  let low = min;
  let high = max;
  for (let step = 0; step < 10; step++) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * Sets the largest font size at which `el` fits inside `box`. Returns true when the text
 * still overflows at `min` (it is then clipped).
 */
export function fitText(
  el: HTMLElement,
  box: HTMLElement,
  { max, min }: { max: number; min: number },
): boolean {
  const fits = (px: number): boolean => {
    el.style.setProperty('font-size', `${String(px)}px`);
    return el.scrollWidth <= box.clientWidth && el.scrollHeight <= box.clientHeight;
  };
  const px = searchFontSize(fits, min, max);
  return !fits(px);
}
