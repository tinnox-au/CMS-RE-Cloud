import type { DisplayDto } from '@tinnox/contracts';
import { isTimeBased, previewZoneNote } from '../../../lib/apps.ts';
import {
  APP_PREVIEW_DISCLAIMER,
  PREVIEW_DISCLAIMER,
  previewCaption,
  previewStateOf,
  type PreviewState,
} from '../../../lib/screenDetail.ts';
import { canvasShapeCaption, shapeOfDisplay } from '../../../lib/screenDetailCanvas.ts';
import {
  ImageOff,
  ListPlus,
  ListVideo,
  TriangleExclamationPoint,
  type IconComponent,
} from '../../../ui/icons.ts';
import { Icon, Spinner } from '../../../ui/index.ts';
import { MediaThumb } from '../../shared/index.ts';
import { AppPreview } from '../../apps/AppPreview.tsx';
import { CanvasFrame } from './CanvasFrame.tsx';
import type { AssignedPlaylistState } from './useAssignedPlaylist.ts';

const MARKS: {
  readonly [K in Exclude<PreviewState, 'ready' | 'loading' | 'processing'>]: IconComponent;
} = {
  nothing_assigned: ListVideo,
  empty_playlist: ListPlus,
  unavailable: ImageOff,
  failed: TriangleExclamationPoint,
};

export interface AssignedPreviewProps {
  readonly display: DisplayDto;
  readonly assigned: AssignedPlaylistState;
}

/**
 * The first item of the assigned playlist, drawn inside a frame in the shape of the canvas
 * with the content rectangle where content goes. It is a mock-up made from the library file (or,
 * for an app, by the player's renderer), never a picture of the physical screen, and says so.
 * With a schedule assigned it draws the schedule's default playlist, and the caption says so.
 */
export function AssignedPreview({ display, assigned }: AssignedPreviewProps) {
  const content =
    assigned.status === 'ready'
      ? assigned.content
      : assigned.status === 'error'
        ? 'unavailable'
        : 'loading';
  const state = previewStateOf(assigned.status !== 'none', content);
  const first = assigned.status === 'ready' ? assigned.content.first : null;
  const caption = previewCaption(
    state,
    display.assignedPlaylist?.name ?? display.assignedSchedule?.defaultPlaylist.name ?? null,
    first === null ? null : first.name,
    display.assignedSchedule?.name ?? null,
  );
  const shape = shapeOfDisplay(display);
  const app = first !== null && 'app' in first ? first.app : null;

  return (
    <figure className="tx-screen-detail-summary__part tx-screen-detail-preview">
      <div className="tx-screen-detail-summary__caption">
        <h2 className="tx-h2" id="screen-detail-preview-title">
          Assigned content preview
        </h2>
        <p className="tx-screen-detail-note">
          {app === null ? PREVIEW_DISCLAIMER : APP_PREVIEW_DISCLAIMER}
        </p>
        {app !== null && isTimeBased(app.content.type) && (
          <p className="tx-screen-detail-note">
            {previewZoneNote(Intl.DateTimeFormat().resolvedOptions().timeZone)}
          </p>
        )}
      </div>
      <CanvasFrame
        shape={shape}
        description={`Assigned content preview. ${caption}`}
        testId="screen-detail-preview"
      >
        {state === 'ready' ? (
          first === null ? null : 'app' in first ? (
            <AppPreview content={first.app.content} />
          ) : (
            <MediaThumb media={first.media} size="fill" fit={first.fit} noBadge />
          )
        ) : state === 'loading' || state === 'processing' ? (
          <span className="tx-screen-detail-frame__mark">
            <Spinner />
          </span>
        ) : (
          <span className="tx-screen-detail-frame__mark">
            <Icon icon={MARKS[state]} size={28} />
          </span>
        )}
      </CanvasFrame>
      <figcaption className="tx-screen-detail-preview__caption">
        <span>{caption}</span>
        <span className="tx-muted tx-num" data-testid="screen-detail-canvas-size">
          {canvasShapeCaption(shape)}
        </span>
      </figcaption>
    </figure>
  );
}
