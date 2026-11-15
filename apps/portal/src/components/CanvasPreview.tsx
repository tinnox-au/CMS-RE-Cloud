import { canvasToViewport } from '@tinnox/domain';
import type { CanvasPreviewShape } from '../lib/displayForm.ts';

const BOX = { width: 320, height: 220 };

/**
 * Scaled drawing of the output frame and, when set, the content rectangle inside it.
 * It shows proportions only; it is not a rendering of any content.
 */
export function CanvasPreview({ shape }: { readonly shape: CanvasPreviewShape | null }) {
  if (shape === null) {
    return (
      <div className="canvas-preview canvas-preview-empty">
        <p className="muted">Enter a valid width and height to see the canvas shape.</p>
      </div>
    );
  }
  const { canvas, contentRect } = shape;
  const { scale } = canvasToViewport(canvas, BOX);
  const width = Math.max(2, canvas.width * scale);
  const height = Math.max(2, canvas.height * scale);
  const description =
    contentRect === null
      ? `Canvas ${canvas.width} by ${canvas.height} pixels. Content fills the whole canvas.`
      : `Canvas ${canvas.width} by ${canvas.height} pixels with a content rectangle of ${contentRect.width} by ${contentRect.height} pixels at ${contentRect.x}, ${contentRect.y}.`;
  return (
    <figure className="canvas-preview">
      <svg
        role="img"
        aria-label={description}
        width={width}
        height={height}
        viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        preserveAspectRatio="none"
      >
        <rect className="canvas-frame" x={0} y={0} width={canvas.width} height={canvas.height} />
        {contentRect !== null && (
          <rect
            className="canvas-content"
            x={contentRect.x}
            y={contentRect.y}
            width={contentRect.width}
            height={contentRect.height}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <figcaption className="small muted">
        {canvas.width} × {canvas.height} px
        {contentRect !== null &&
          `, content ${contentRect.width} × ${contentRect.height} at (${contentRect.x}, ${contentRect.y})`}
        {shape.contentRectOutOfBounds && ' — content rectangle does not fit inside the canvas'}
      </figcaption>
    </figure>
  );
}
