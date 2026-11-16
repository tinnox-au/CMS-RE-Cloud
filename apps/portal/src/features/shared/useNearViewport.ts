import { useEffect, useState, type RefObject } from 'react';

/** How far outside the viewport an element counts as near, so it is ready when scrolled to. */
const MARGIN = '200px';

/**
 * False until the element has come near the viewport once, then true for good. Used to hold
 * back video thumbnails: a `<video>` has no lazy-loading attribute of its own, and a long
 * list would otherwise start a request for every row at once. With `enabled` false the
 * answer is true at once (images load lazily by themselves).
 */
export function useNearViewport(ref: RefObject<Element | null>, enabled: boolean): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (!enabled || near) return;
    const element = ref.current;
    if (element === null) return;
    if (typeof IntersectionObserver !== 'function') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: MARGIN },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, enabled, near]);

  return near || !enabled;
}
