import type { FolderDto, MemberDto, TagDto } from '@tinnox/contracts';
import { useCallback, useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/index.ts';
import { useLoad, type LoadState } from '../../hooks/useLoad.ts';
import { countOf } from '../../lib/bulkOutcome.ts';
import {
  folderCountLabel,
  PLANNED_SETTINGS,
  plannedStageLabel,
  tagCountLabel,
  tagScopeWords,
  tagsOfScope,
  tagsPath,
  type PlannedSettingId,
} from '../../lib/settingsView.ts';
import { useCan, useSession } from '../../session/AuthenticatedSession.tsx';
import { Page } from '../../shell/Page.tsx';
import {
  Bell,
  Building,
  ChevronRight,
  Clock,
  Folder,
  KeyRound,
  Monitor,
  ScrollText,
  ShieldCheck,
  Tags,
  Users,
} from '../../ui/icons.ts';
import { cx, ErrorNotice, Icon, Skeleton, StatusPill, type IconComponent } from '../../ui/index.ts';
import './settings.css';

interface SettingsRowProps {
  readonly icon: IconComponent;
  readonly title: string;
  /** One line under the title. */
  readonly description: string;
  /** The current value, at the end of the row. */
  readonly value?: ReactNode;
  /** Where the setting is managed. With it the whole row is a link. */
  readonly to?: string;
  /** A setting that does not exist yet: drawn quieter. */
  readonly planned?: boolean;
  readonly testId: string;
}

/** One setting: icon, title, description, current value, and a chevron when it opens a page. */
function SettingsRow({
  icon,
  title,
  description,
  value,
  to,
  planned = false,
  testId,
}: SettingsRowProps) {
  const content = (
    <>
      <span className="tx-settings-row__icon">
        <Icon icon={icon} />
      </span>
      <span className="tx-settings-row__text">
        <span className="tx-settings-row__title">{title}</span>
        <span className="tx-settings-row__description">{description}</span>
      </span>
      {value !== undefined && <span className="tx-settings-row__value">{value}</span>}
      {to !== undefined && (
        <span className="tx-settings-row__chevron">
          <Icon icon={ChevronRight} />
        </span>
      )}
    </>
  );
  return (
    <li className="tx-settings-list__item">
      {to === undefined ? (
        <div
          className={cx('tx-settings-row', planned && 'tx-settings-row--planned')}
          data-testid={testId}
        >
          {content}
        </div>
      ) : (
        <Link className="tx-settings-row tx-settings-row--link" to={to} data-testid={testId}>
          {content}
        </Link>
      )}
    </li>
  );
}

interface SettingsGroupProps {
  readonly title: string;
  /** A sentence under the group title. */
  readonly note?: string;
  readonly children: ReactNode;
}

function SettingsGroup({ title, note, children }: SettingsGroupProps) {
  const id = useId();
  return (
    <section className="tx-settings-group" aria-labelledby={id}>
      <div className="tx-settings-group__heading">
        <h2 id={id} className="tx-settings-group__title">
          {title}
        </h2>
        {note !== undefined && <p className="tx-settings-group__note">{note}</p>}
      </div>
      <ul className="tx-settings-list">{children}</ul>
    </section>
  );
}

/** The value of a row that counts something loaded from the API. */
function countValue<T>(state: LoadState<T>, label: (data: T) => string): ReactNode {
  if (state.status === 'loading') {
    return (
      <>
        <Skeleton variant="pill" width="64px" height="18px" />
        <span className="tx-visually-hidden">Loading</span>
      </>
    );
  }
  if (state.status === 'error') return 'Not loaded';
  return label(state.data);
}

const PLANNED_ICONS: { readonly [K in PlannedSettingId]: IconComponent } = {
  'working-hours': Clock,
  alerts: Bell,
  'api-tokens': KeyRound,
};

/**
 * "People": the Users row with the number of active members. Rendered only with `member.read`.
 * A failed count is reported like the tag and folder counts, before the group (not inside its
 * list).
 */
function PeopleGroup() {
  const loadMembers = useCallback((signal: AbortSignal) => api.listMembers(signal), []);
  const members = useLoad<MemberDto[]>(loadMembers);
  return (
    <>
      {members.state.status === 'error' && (
        <ErrorNotice
          error={members.state.error}
          title="The number of people could not be loaded"
          onRetry={members.reload}
        />
      )}
      <SettingsGroup title="People">
        <SettingsRow
          icon={Users}
          title="Users"
          description="People in this organisation, their roles and invites waiting for TINNOX."
          value={countValue(members.state, (list) =>
            countOf(list.filter((member) => member.removedAt === null).length, 'person', 'people'),
          )}
          to="/users"
          testId="settings-row-users"
        />
      </SettingsGroup>
    </>
  );
}

/**
 * Settings (docs/portal-v2/stage-a.md, section 3.10): rows in groups, each with an icon, a
 * title, one line of description and the current value. A row is a link where a page exists
 * for it. Settings that are planned say which stage brings them and are not links.
 */
export function SettingsPage() {
  const session = useSession();
  const canReadPeople = useCan('member.read');
  const fullLog = useCan('audit.read');
  const loadTags = useCallback((signal: AbortSignal) => api.listTags(undefined, signal), []);
  const loadFolders = useCallback((signal: AbortSignal) => api.listFolders(signal), []);
  const tags = useLoad<TagDto[]>(loadTags);
  const folders = useLoad<FolderDto[]>(loadFolders);

  const media = tagScopeWords('media');
  const screens = tagScopeWords('display');

  return (
    <Page title="Settings">
      <div className="tx-settings" data-testid="settings-page">
        {tags.state.status === 'error' && (
          <ErrorNotice
            error={tags.state.error}
            title="The number of tags could not be loaded"
            onRetry={tags.reload}
          />
        )}
        {folders.state.status === 'error' && (
          <ErrorNotice
            error={folders.state.error}
            title="The number of folders could not be loaded"
            onRetry={folders.reload}
          />
        )}

        <SettingsGroup title="Organisation">
          <SettingsRow
            icon={Building}
            title="Organisation name"
            description="The organisation you are signed in to. It cannot be changed here."
            value={
              <span className="tx-settings-row__strong" data-testid="settings-organisation-name">
                {session.organization.name}
              </span>
            }
            testId="settings-row-organisation"
          />
        </SettingsGroup>

        <SettingsGroup title="Content">
          <SettingsRow
            icon={Tags}
            title={media.title}
            description={media.description}
            value={countValue(tags.state, (list) =>
              tagCountLabel(tagsOfScope(list, 'media').length),
            )}
            to={tagsPath('media')}
            testId="settings-row-media-tags"
          />
          <SettingsRow
            icon={Monitor}
            title={screens.title}
            description={screens.description}
            value={countValue(tags.state, (list) =>
              tagCountLabel(tagsOfScope(list, 'display').length),
            )}
            to={tagsPath('display')}
            testId="settings-row-screen-tags"
          />
          <SettingsRow
            icon={Folder}
            title="Folders"
            description="Folders are created, renamed and deleted in the media library."
            value={countValue(folders.state, (list) => folderCountLabel(list.length))}
            to="/media"
            testId="settings-row-folders"
          />
        </SettingsGroup>

        {canReadPeople && <PeopleGroup />}

        <SettingsGroup title="Security">
          <SettingsRow
            icon={ScrollText}
            title="Audit log"
            description={
              fullLog
                ? 'Security and operational events for this organisation, newest first.'
                : 'Content and screen events in this organisation.'
            }
            to="/audit"
            testId="settings-row-audit"
          />
          <SettingsRow
            icon={ShieldCheck}
            title="Sign-in and MFA"
            description="Sign-in and the one-time code are handled by your organisation’s identity provider. There is nothing to set here."
            value="Identity provider"
            testId="settings-row-sign-in"
          />
        </SettingsGroup>

        <SettingsGroup
          title="Planned"
          note="These settings are not built yet. Nothing here can be changed."
        >
          {PLANNED_SETTINGS.map((row) => (
            <SettingsRow
              key={row.id}
              icon={PLANNED_ICONS[row.id]}
              title={row.title}
              description={row.description}
              value={<StatusPill tone="neutral">{plannedStageLabel(row.stage)}</StatusPill>}
              planned
              testId={`settings-row-${row.id}`}
            />
          ))}
        </SettingsGroup>
      </div>
    </Page>
  );
}
