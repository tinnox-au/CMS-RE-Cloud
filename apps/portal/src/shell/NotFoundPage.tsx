import { ButtonLink, EmptyState } from '../ui/index.ts';
import { SearchX } from '../ui/icons.ts';
import { HOME_PATH } from './nav.ts';
import { Page } from './Page.tsx';

/** The page for an address no route matches, inside the shell. */
export function NotFoundPage() {
  return (
    <Page title="Page not found">
      <EmptyState
        icon={SearchX}
        title="There is no page at this address"
        action={
          <ButtonLink variant="primary" size="lg" to={HOME_PATH}>
            Go to dashboard
          </ButtonLink>
        }
      >
        The link may be out of date. Start again from the dashboard.
      </EmptyState>
    </Page>
  );
}
