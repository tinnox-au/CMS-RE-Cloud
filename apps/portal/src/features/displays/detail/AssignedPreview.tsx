import type { DisplayDto } from '@tinnox/contracts';
import {
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
 * with the content rectangle where content goes. It is a mock-up made from the library file,
 * never a picture of the physical screen, and says so.
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
    display.assignedPlaylist?.name ?? null,
    first === null ? null : first.name,
  );
  const shape = shapeOfDisplay(display);

  return (
    <figure className="tx-screen-detail-summary__part tx-screen-detail-preview">
      <div className="tx-screen-detail-summary__caption">
        <h2 className="tx-h2" id="screen-detail-preview-title">
          Assigned content preview
        </h2>
        <p className="tx-screen-detail-note">{PREVIEW_DISCLAIMER}</p>
      </div>
      <CanvasFrame
        shape={shape}
        description={`Assigned content preview. ${caption}`}
        testId="screen-detail-preview"
      >
        {state === 'ready' ? (
          first !== null && <MediaThumb media={first.media} size="fill" fit={first.fit} noBadge />
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
