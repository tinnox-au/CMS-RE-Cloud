import type { CSSProperties } from 'react';

/**
 * Types a set of `--tx-*` custom properties for React's `style` prop. React writes them with
 * `style.setProperty`, through the CSSOM, which the portal's Content-Security-Policy allows
 * (a `style="..."` attribute in markup would not be). Use it only for values that are truly
 * dynamic, such as a fill fraction or an index; everything else belongs in a class.
 */
export function cssVars(vars: Readonly<Record<`--tx-${string}`, string | number>>): CSSProperties {
  return vars;
}
