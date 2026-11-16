import { useEffect, type ReactNode } from 'react';
import { BackLink, ErrorNotice, Icon, IconButton, VisuallyHidden } from '../ui/index.ts';
import { cx } from '../ui/cx.ts';
import { Building, MenuIcon } from '../ui/icons.ts';
import { useShell } from './ShellContext.ts';
import { useDocumentTitle } from './useDocumentTitle.ts';

/** Where an editor page's back link leads and what it is called: "All playlists". */
export interface PageBackLink {
  readonly to: string;
  readonly label: string;
}

export interface PageHeaderProps {
  /** The page's one `h1`. */
  readonly title: string;
  /** Editor pages: a back link above the title. */
  readonly back?: PageBackLink | undefined;
  /** Page-level actions, between the title and the global controls. */
  readonly actions?: ReactNode;
  /**
   * The organisation's name, shown as a quiet label before the global controls. Its width is
   * capped, so a long name is shortened and the title keeps the rest of the line.
   */
  readonly organisation?: string | undefined;
  /** The global controls at the far end: account menu, push button. */
  readonly global: ReactNode;
}

/**
 * The sticky glass header shared by the two page frames. Pages do not render it directly:
 * use `Page` or `EditorPage`.
 */
export function PageHeader({ title, back, actions, organisation, global }: PageHeaderProps) {
  const { drawerMode, navOpen, openNav } = useShell();
  return (
    <header
      className={cx('tx-page-header tx-glass', back !== undefined && 'tx-page-header--editor')}
    >
      <div className="tx-page-header__inner">
        {drawerMode && (
          <IconButton
            icon={MenuIcon}
            label="Open navigation"
            className="tx-page-header__menu"
            aria-haspopup="dialog"
            aria-expanded={navOpen}
            onClick={openNav}
          />
        )}
        <div className="tx-page-header__heading">
          {back !== undefined && <BackLink to={back.to}>{back.label}</BackLink>}
          <h1 className="tx-page-header__title">{title}</h1>
        </div>
        {actions !== undefined && actions !== null && actions !== false && (
          <div className="tx-page-header__actions">{actions}</div>
        )}
        {organisation !== undefined && (
          // The label may be cut short; `title` lets a pointer read the whole name.
          <span className="tx-org-label" title={organisation}>
            <Icon icon={Building} size={16} className="tx-org-label__icon" />
            <VisuallyHidden>Organisation: </VisuallyHidden>
            <span className="tx-org-label__name">{organisation}</span>
          </span>
        )}
        <div className="tx-page-header__global">{global}</div>
      </div>
    </header>
  );
}

/**
 * The scrolling content column under the header: the `main` landmark the skip link targets.
 * A failed sign-out is reported here, at the top, as an alert.
 */
export function PageMain({ children }: { readonly children: ReactNode }) {
  const { signOut } = useShell();
  return (
    <main id="main" className="tx-page-main" tabIndex={-1}>
      {signOut.error !== null && (
        <ErrorNotice
          error={signOut.error}
          title="Sign-out did not complete"
          onDismiss={signOut.dismissError}
          className="tx-page-main__notice"
        />
      )}
      {children}
    </main>
  );
}

/** Sets the document title and tells the shell which page is showing. */
export function usePageFrame(documentTitleText: string): void {
  const { announcePage } = useShell();
  useDocumentTitle(documentTitleText);
  useEffect(() => {
    announcePage(documentTitleText);
  }, [announcePage, documentTitleText]);
}
