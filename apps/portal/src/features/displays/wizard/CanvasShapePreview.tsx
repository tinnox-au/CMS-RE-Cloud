import type { CanvasPreviewShape } from '../../../lib/displayForm.ts';
import { canvasShapeCaption } from '../../../lib/screenWizard.ts';
import { TriangleExclamationPoint } from '../../../ui/icons.ts';
import { Icon } from '../../../ui/index.ts';
import { CanvasFrame } from '../detail/CanvasFrame.tsx';
import './wizard.css';

export interface CanvasShapePreviewProps {
  /** From `previewShape` in lib/displayForm.ts; null while the size typed is not usable. */
  readonly shape: CanvasPreviewShape | null;
}

/**
 * A scaled drawing of the output frame and, when one is set, the content rectangle inside
 * it. It shows proportions only: it is not a rendering of any content, and it says so.
 * The drawing is the screen page's `CanvasFrame`, so the canvas looks the same in the wizard,
 * on the screen page and in the screens list (colours: ../canvasDiagram.css).
 */
export function CanvasShapePreview({ shape }: CanvasShapePreviewProps) {
  if (shape === null) {
    return (
      <div className="tx-screen-wizard__preview" data-testid="screen-wizard-preview">
        <CanvasFrame shape={null} size="lg" />
      </div>
    );
  }
  const whole = shape.contentRect === null;
  return (
    <figure className="tx-screen-wizard__preview" data-testid="screen-wizard-preview">
      <CanvasFrame shape={shape} size="lg" testId="screen-wizard-drawing" />
      <figcaption className="tx-screen-wizard__preview-caption">
        <span className="tx-num" data-testid="screen-wizard-preview-size">
          {canvasShapeCaption(shape)}
        </span>
        <ul className="tx-screen-wizard__legend">
          <li>
            <span
              className="tx-screen-wizard__swatch tx-screen-wizard__swatch--content"
              aria-hidden="true"
            />
            Content area
          </li>
          {!whole && (
            <li>
              <span
                className="tx-screen-wizard__swatch tx-screen-wizard__swatch--frame"
                aria-hidden="true"
              />
              Stays black
            </li>
          )}
        </ul>
        {shape.contentRectOutOfBounds && (
          <span className="tx-screen-wizard__preview-warning">
            <Icon icon={TriangleExclamationPoint} size={16} />
            The content rectangle does not fit inside the canvas.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
