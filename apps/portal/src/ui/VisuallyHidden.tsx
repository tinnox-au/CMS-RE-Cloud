import type { ReactNode } from 'react';

/** Text for assistive technology only, for example the item a row button acts on. */
export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return <span className="tx-visually-hidden">{children}</span>;
}
