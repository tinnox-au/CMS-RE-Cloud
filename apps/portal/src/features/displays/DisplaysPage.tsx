import { ScreensList } from './list/ScreensList.tsx';

/**
 * The screens list (`/screens`; docs/portal-v2/stage-a.md, section 3.6). The folder and the
 * component keep the code's word, `display`; everything an operator sees says "screen".
 * `ScreensList` renders the page frame itself: its subtitle carries the count of screens and
 * the header holds "Add screen".
 */
export function DisplaysPage() {
  return <ScreensList />;
}
