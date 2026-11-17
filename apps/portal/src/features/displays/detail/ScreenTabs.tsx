import type { DeliveryStatusView, DisplayDto, Rotation, SiteDto } from '@tinnox/contracts';
import type { LoadState } from '../../../hooks/useLoad.ts';
import type { DisplayFormValues } from '../../../lib/displayForm.ts';
import {
  plannedTabReason,
  SCREEN_DETAIL_TABS,
  type ScreenDetailOpenTabId,
  type ScreenDetailTabId,
  type WorkingHoursDraft,
} from '../../../lib/screenDetail.ts';
import { Card, TabPanel, Tabs, type TabItem } from '../../../ui/index.ts';
import type { TagsResource } from '../../shared/index.ts';
import { CanvasTab } from './CanvasTab.tsx';
import { OverviewTab } from './OverviewTab.tsx';
import { PairingTab } from './PairingTab.tsx';
import type { RevokeState, SectionSave } from './types.ts';
import { TagsTab } from './TagsTab.tsx';
import { WorkingHoursTab } from './WorkingHoursTab.tsx';

const TAB_ITEMS: readonly TabItem<ScreenDetailTabId>[] = SCREEN_DETAIL_TABS.map((tab) =>
  tab.plannedStage === null
    ? { id: tab.id, label: tab.label }
    : {
        id: tab.id,
        label: tab.label,
        disabled: true,
        disabledReason: plannedTabReason(tab.plannedStage),
        note: 'Planned',
      },
);

export interface ScreenTabsProps {
  readonly tab: ScreenDetailOpenTabId;
  readonly onTab: (tab: ScreenDetailOpenTabId) => void;
  readonly display: DisplayDto;
  readonly site: SiteDto | null;
  readonly status: LoadState<DeliveryStatusView>;
  readonly onReloadStatus: () => void;
  readonly canvasDraft: DisplayFormValues | null;
  readonly onCanvasDraft: (draft: DisplayFormValues | null) => void;
  readonly rotationDraft: Rotation | null;
  readonly onRotationDraft: (rotation: Rotation | null) => void;
  readonly tags: TagsResource;
  readonly tagsDraft: readonly string[] | null;
  readonly onTagsDraft: (draft: readonly string[] | null) => void;
  readonly workingHoursDraft: WorkingHoursDraft | null;
  readonly onWorkingHoursDraft: (draft: WorkingHoursDraft | null) => void;
  readonly onSaved: (display: DisplayDto) => void;
  /** Save state of the Canvas, Tags and Working hours tabs, kept by the page (FCX-03). */
  readonly saves: {
    readonly canvas: SectionSave;
    readonly tags: SectionSave;
    readonly workingHours: SectionSave;
  };
  readonly onPaired: () => void;
  readonly onRevoke: () => void;
  readonly revoke: RevokeState | null;
  readonly onDismissRevoke: () => void;
}

function isOpenTab(id: ScreenDetailTabId): id is ScreenDetailOpenTabId {
  return SCREEN_DETAIL_TABS.some((tab) => tab.id === id && tab.plannedStage === null);
}

/** The screen's settings in tabs; the selected one is kept in the address as `?tab=`. */
export function ScreenTabs(props: ScreenTabsProps) {
  const { tab, onTab } = props;
  return (
    <Card
      as="section"
      className="tx-screen-detail-tabs"
      aria-labelledby="screen-detail-settings-title"
    >
      {/* The outline heading of the tabs, so the panels' h3 titles nest under it. */}
      <h2 id="screen-detail-settings-title" className="tx-visually-hidden">
        Screen settings
      </h2>
      <Tabs
        id="screen-detail"
        label="Screen settings"
        tabs={TAB_ITEMS}
        value={tab}
        onChange={(id) => {
          if (isOpenTab(id)) onTab(id);
        }}
        className="tx-screen-detail-tabs__list"
      />
      <TabPanel tabs="screen-detail" tab={tab} className="tx-screen-detail-tabs__panel">
        <TabContent {...props} />
      </TabPanel>
    </Card>
  );
}

function TabContent(props: ScreenTabsProps) {
  switch (props.tab) {
    case 'overview':
      return (
        <OverviewTab
          status={props.status}
          onReload={props.onReloadStatus}
          scheduled={props.display.assignedSchedule !== null}
        />
      );
    case 'canvas':
      return (
        <CanvasTab
          display={props.display}
          draft={props.canvasDraft}
          onDraft={props.onCanvasDraft}
          rotationDraft={props.rotationDraft}
          onRotationDraft={props.onRotationDraft}
          onSaved={props.onSaved}
          save={props.saves.canvas}
        />
      );
    case 'pairing':
      return (
        <PairingTab
          display={props.display}
          onPaired={props.onPaired}
          onRevoke={props.onRevoke}
          revoke={props.revoke}
          onDismissRevoke={props.onDismissRevoke}
        />
      );
    case 'tags':
      return (
        <TagsTab
          display={props.display}
          tags={props.tags}
          draft={props.tagsDraft}
          onDraft={props.onTagsDraft}
          onSaved={props.onSaved}
          save={props.saves.tags}
        />
      );
    case 'working-hours':
      return (
        <WorkingHoursTab
          display={props.display}
          site={props.site}
          draft={props.workingHoursDraft}
          onDraft={props.onWorkingHoursDraft}
          onSaved={props.onSaved}
          save={props.saves.workingHours}
        />
      );
  }
}
