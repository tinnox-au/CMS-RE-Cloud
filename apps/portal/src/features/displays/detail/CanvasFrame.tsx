import type { ReactNode } from 'react';
import type { CanvasPreviewShape } from '../../../lib/displayForm.ts';
import { canvasShapeDescription, frameGeometry } from '../../../lib/screenDetailCanvas.ts';
import { cssVars, cx } from '../../../ui/index.ts';
import '../canvasDiagram.css';
import './screenDetail.css';

export interface CanvasFrameProps {
  /** The canvas and its content rectangle. Null when the typed numbers give no shape yet. */
  readonly shape: CanvasPreviewShape | null;
  /** Said after the shape to assistive technology: what is drawn inside the frame. */
  readonly description?: string;
  /** Shown instead of the frame while `shape` is null. */
  readonly emptyText?: string;
  /**
   * The tallest the frame may be: `sm` 150 px, `md` (the default) 200 px, `lg` 176 px on a
   * taller stage, `xl` 360 px (the app editor's preview).
   */
  readonly size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Drawn inside the content area. Left out, the frame shows proportions only. */
  readonly children?: ReactNode;
  readonly testId?: string;
}

/**
 * A frame in the shape of a screen's canvas, with the content rectangle drawn where content
 * goes. It shows proportions (and, with children, a mock-up of content); it is never a
 * picture of a physical screen. The geometry is dynamic, so it is passed as custom
 * properties through the CSSOM, which the Content-Security-Policy allows.
 */
export function CanvasFrame({
  shape,
  description,
  emptyText = 'Enter a valid width and height to see the canvas shape.',
  size = 'md',
  children,
  testId,
}: CanvasFrameProps) {
  const stage = cx(
    'tx-screen-detail-stage',
    size === 'sm' && 'tx-screen-detail-stage--sm',
    size === 'lg' && 'tx-screen-detail-stage--lg',
    size === 'xl' && 'tx-screen-detail-stage--xl',
  );
  if (shape === null) {
    return (
      <div className={stage} data-testid={testId} data-canvas="none">
        <p className="tx-screen-detail-stage__empty">{emptyText}</p>
      </div>
    );
  }
  const geometry = frameGeometry(shape);
  const label = [canvasShapeDescription(shape), description]
    .filter((part) => part !== undefined)
    .join(' ');
  return (
    <div className={stage}>
      <div
        className="tx-screen-detail-frame"
        role="img"
        aria-label={label}
        data-testid={testId}
        data-canvas={`${shape.canvas.width}x${shape.canvas.height}`}
        style={cssVars({ '--tx-frame-ratio': geometry.ratio })}
      >
        <div
          className={cx(
            'tx-screen-detail-frame__content',
            geometry.limited && 'tx-screen-detail-frame__content--limited',
            children === undefined && 'tx-screen-detail-frame__content--bare',
          )}
          data-testid={testId === undefined ? undefined : `${testId}-content`}
          style={cssVars({
            '--tx-content-left': `${geometry.content.left}%`,
            '--tx-content-top': `${geometry.content.top}%`,
            '--tx-content-width': `${geometry.content.width}%`,
            '--tx-content-height': `${geometry.content.height}%`,
          })}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
