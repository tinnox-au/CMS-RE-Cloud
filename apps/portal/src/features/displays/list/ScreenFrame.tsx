import type { DisplayDto } from '@tinnox/contracts';
import { contentInset, frameShape, WHOLE_CANVAS } from '../../../lib/screensList.ts';
import { cssVars, cx } from '../../../ui/index.ts';
import '../canvasDiagram.css';
import './screensList.css';

export interface ScreenFrameProps {
  readonly display: Pick<DisplayDto, 'canvas' | 'contentRect'>;
  /** `tile`: the 16:9 picture of a grid tile. `lead`: the 44 by 32 px frame before a row's name. */
  readonly size?: 'tile' | 'lead';
}

/**
 * The shape of a screen's canvas, drawn to scale inside a fixed stage: a wide strip, a
 * portrait panel and a 16:9 screen are told apart at a glance. A very long or very tall
 * canvas is drawn at a limit (lib/screensList.ts); the exact size is always written next to
 * it. A content rectangle that does not cover the whole canvas is marked inside the frame.
 *
 * It is a diagram of the configured canvas, not a picture of what the screen shows, and it
 * is decoration for assistive technology: the name and the size are text beside it.
 */
export function ScreenFrame({ display, size = 'tile' }: ScreenFrameProps) {
  const shape = frameShape(
    display.canvas.width,
    display.canvas.height,
    // The lead's drawing area is 28 by 20 px (screensList.css).
    size === 'lead' ? 28 / 20 : 16 / 9,
  );
  // A tile draws the content area (the whole canvas without a rectangle), as the screen page
  // and the wizard do; the small lead frame has no room for it.
  const inset = size === 'tile' ? (contentInset(display) ?? WHOLE_CANVAS) : null;
  return (
    <span
      className={cx('tx-screens-frame', size === 'lead' && 'tx-screens-frame--lead')}
      aria-hidden="true"
    >
      <span className="tx-screens-frame__area">
        <span
          className="tx-screens-frame__canvas"
          style={cssVars({
            '--tx-screens-frame-w': `${shape.widthPercent}%`,
            '--tx-screens-frame-h': `${shape.heightPercent}%`,
          })}
        >
          {inset !== null && (
            <span
              className="tx-screens-frame__content"
              style={cssVars({
                '--tx-screens-inset-x': `${inset.leftPercent}%`,
                '--tx-screens-inset-y': `${inset.topPercent}%`,
                '--tx-screens-inset-w': `${inset.widthPercent}%`,
                '--tx-screens-inset-h': `${inset.heightPercent}%`,
              })}
            />
          )}
        </span>
      </span>
    </span>
  );
}
