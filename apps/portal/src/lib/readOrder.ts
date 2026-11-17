/**
 * Orders reads against local replacements (FCX-05 in docs/reviews/2026-11-17-frontend-round-2).
 * A read takes a ticket when it starts; replacing the data with a save's answer invalidates
 * every ticket taken before it. A read whose ticket is no longer current is discarded, so a
 * slow answer from before a save cannot overwrite the newer answer of that save.
 */
export interface ReadOrder {
  /** Call when a read starts; pass the result to `isCurrent` when it ends. */
  readonly begin: () => number;
  /** True when nothing replaced the data since the read began. */
  readonly isCurrent: (ticket: number) => boolean;
  /** Call when the data is replaced without a read, for example with a save's answer. */
  readonly invalidate: () => void;
}

export function createReadOrder(): ReadOrder {
  let generation = 0;
  return {
    begin: () => generation,
    isCurrent: (ticket) => ticket === generation,
    invalidate: () => {
      generation += 1;
    },
  };
}
