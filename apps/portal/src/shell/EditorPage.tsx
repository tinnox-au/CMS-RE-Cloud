import type { ReactNode } from 'react';
import { AccountMenu } from './AccountMenu.tsx';
import { PageHeader, PageMain, usePageFrame, type PageBackLink } from './PageHeader.tsx';

export interface EditorPageProps {
  /** The object's name as the page's one `h1`. Use a plain noun while the object loads. */
  readonly title: string;
  /** The page part of the document title when it should differ from the `h1`. */
  readonly documentTitle?: string;
  /** The link above the title, back to the list the object belongs to. */
  readonly back: PageBackLink;
  /**
   * A quiet label before the actions: "Saved" or "Unsaved changes". Pass plain text or an
   * element with `role="status"` when the change should be announced.
   */
  readonly status?: ReactNode;
  /** The header actions, quiet Cancel first and primary Save last. */
  readonly actions?: ReactNode;
  /** The editor content, inside the `main` landmark. */
  readonly children: ReactNode;
}

/**
 * The editor page frame (design-system.md, sections 4 and 8): a back link, the object's name
 * as `h1`, a status label and the Cancel and Save actions. The global controls are reduced to
 * the account menu, whose heading then carries the organisation name.
 *
 * It must be below `AppShell`. Lay the content out with the `tx-editor` class.
 */
export function EditorPage({
  title,
  documentTitle,
  back,
  status,
  actions,
  children,
}: EditorPageProps) {
  usePageFrame(documentTitle ?? title);
  const hasStatus = status !== undefined && status !== null && status !== false;
  const hasActions = actions !== undefined && actions !== null && actions !== false;
  return (
    <>
      <PageHeader
        title={title}
        back={back}
        actions={
          hasStatus || hasActions ? (
            <>
              {hasStatus && <span className="tx-page-header__status">{status}</span>}
              {hasActions && actions}
            </>
          ) : undefined
        }
        global={<AccountMenu showOrganisation />}
      />
      <PageMain>{children}</PageMain>
    </>
  );
}
