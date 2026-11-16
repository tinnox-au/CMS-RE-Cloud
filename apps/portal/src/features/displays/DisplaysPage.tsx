import { Page } from '../../shell/Page.tsx';
import { ScreensList } from './list/ScreensList.tsx';

/**
 * The screens list (`/screens`; docs/portal-v2/stage-a.md, section 3.6). The folder and the
 * component keep the code's word, `display`; everything an operator sees says "screen".
 */
export function DisplaysPage() {
  return (
    <Page title="Screens">
      <ScreensList />
    </Page>
  );
}
