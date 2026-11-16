import { useEffect } from 'react';
import { documentTitle } from './nav.ts';

/** Sets the browser tab title to "<page> · TINNOX CMS" while the calling page is showing. */
export function useDocumentTitle(pageTitle: string): void {
  useEffect(() => {
    document.title = documentTitle(pageTitle);
  }, [pageTitle]);
}
