import { ButtonLink, EmptyState } from '../ui/index.ts';
import { Lock } from '../ui/icons.ts';
import { HOME_PATH } from './nav.ts';
import { Page } from './Page.tsx';

/** In place of a page the member's role does not open (`RequirePermission`), inside the shell. */
export function ForbiddenPage() {
  return (
    <Page title="Your role doesn't allow this">
      <EmptyState
        icon={Lock}
        title="This page is not open to your role"
        action={
          <ButtonLink variant="primary" size="lg" to={HOME_PATH}>
            Go to dashboard
          </ButtonLink>
        }
      >
        Ask the Owner or an Admin of your organisation if you need this.
      </EmptyState>
    </Page>
  );
}
