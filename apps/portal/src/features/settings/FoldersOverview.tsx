import type { FolderDto } from '@tinnox/contracts';
import { useCallback, useId } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { folderCountLabel, folderItemsLabel, folderPath } from '../../lib/settingsView.ts';
import { ArrowRight, Folder } from '../../ui/icons.ts';
import {
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Icon,
  Skeleton,
  SkeletonGroup,
} from '../../ui/index.ts';
import './settings.css';

/**
 * The media folders, read-only, with how many files each holds. Folders are created,
 * renamed and deleted in the media library; each name opens the library on that folder.
 */
export function FoldersOverview() {
  const titleId = useId();
  const load = useCallback((signal: AbortSignal) => api.listFolders(signal), []);
  const { state, reload } = useLoad<FolderDto[]>(load);

  let body;
  if (state.status === 'loading') {
    body = (
      <SkeletonGroup label="Loading folders" className="tx-settings-folders__skeleton">
        <Skeleton width="45%" height="16px" />
        <Skeleton width="30%" height="16px" />
        <Skeleton width="38%" height="16px" />
      </SkeletonGroup>
    );
  } else if (state.status === 'error') {
    body = (
      <div className="tx-settings-folders__state">
        <ErrorNotice error={state.error} title="The folders could not be loaded" onRetry={reload} />
      </div>
    );
  } else if (state.data.length === 0) {
    body = (
      <EmptyState variant="inline" icon={Folder} title="No folders yet" level={3}>
        Folders group files in the media library. Create one there with New folder.
      </EmptyState>
    );
  } else {
    body = (
      <>
        {state.refreshError !== null && (
          <div className="tx-settings-folders__state">
            <ErrorNotice
              error={state.refreshError}
              title="The folders could not be refreshed"
              onRetry={reload}
            />
          </div>
        )}
        <ul className="tx-settings-folders" aria-labelledby={titleId}>
          {state.data.map((folder) => (
            <li
              key={folder.id}
              className="tx-settings-folders__item"
              data-testid={`settings-folder-${folder.id}`}
            >
              <span className="tx-settings-folders__icon">
                <Icon icon={Folder} size={18} />
              </span>
              <Link
                className="tx-settings-folders__name"
                to={folderPath(folder.id)}
                title={folder.name}
              >
                {folder.name}
              </Link>
              <span className="tx-settings-folders__count">
                {folderItemsLabel(folder.itemCount)}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <Card as="section" flush aria-labelledby={titleId} data-testid="settings-folders">
      <div className="tx-settings-folders__header">
        <CardHeader
          id={titleId}
          title="Folders"
          size="title"
          description={
            <>
              Managed in the media library.{' '}
              {state.status === 'ready' && (
                <span data-testid="settings-folders-count">
                  {folderCountLabel(state.data.length)}.
                </span>
              )}
            </>
          }
          actions={
            <ButtonLink
              variant="ghost"
              size="sm"
              to="/media"
              trailingIcon={ArrowRight}
              data-testid="settings-folders-library"
            >
              Open media library
            </ButtonLink>
          }
        />
      </div>
      {body}
    </Card>
  );
}
