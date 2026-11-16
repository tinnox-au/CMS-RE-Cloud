import type { ReactNode } from 'react';
import { useSession } from '../session/SessionContext.tsx';
import { AccountMenu } from './AccountMenu.tsx';
import { PageHeader, PageMain, usePageFrame } from './PageHeader.tsx';
import { PushButton } from './PushButton.tsx';

export interface PageProps {
  /** The page's one `h1`, shown in the header. Also the document title unless overridden. */
  readonly title: string;
  /** The page part of the document title when it should differ from the `h1`. */
  readonly documentTitle?: string;
  /**
   * Page-level actions in the header, before the global controls. Most list pages leave this
   * empty: their create button sits at the end of the filter row.
   */
  readonly actions?: ReactNode;
  /** The page content, inside the `main` landmark. */
  readonly children: ReactNode;
}

/**
 * The standard page frame (design-system.md, section 4): a sticky glass header with the `h1`
 * on the left, the page's own actions, and the global controls on the right in this order:
 * organisation label, account menu, "Push to screens". The content column scrolls under it.
 *
 * Every list and overview page renders exactly one `Page`. It must be below `AppShell`.
 * The organisation name is written once on the page, here.
 */
export function Page({ title, documentTitle, actions, children }: PageProps) {
  const session = useSession();
  usePageFrame(documentTitle ?? title);
  return (
    <>
      <PageHeader
        title={title}
        actions={actions}
        organisation={session.organization.name}
        global={
          <>
            <AccountMenu />
            <PushButton />
          </>
        }
      />
      <PageMain>{children}</PageMain>
    </>
  );
}
