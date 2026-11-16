import type { ReactNode } from 'react';

/** A key cap, for naming a keyboard key in help text: `<Kbd>Esc</Kbd>`. */
export function Kbd({ children }: { readonly children: ReactNode }) {
  return <kbd className="tx-kbd">{children}</kbd>;
}
