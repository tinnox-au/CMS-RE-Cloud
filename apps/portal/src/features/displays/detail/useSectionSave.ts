import { useMemo, useState } from 'react';
import type { SectionSave } from './types.ts';

/** One tab's save state, kept by the page so it outlives the tab (see `SectionSave`). */
export function useSectionSave(): SectionSave {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return useMemo(() => ({ saving, error, setSaving, setError }), [saving, error]);
}
