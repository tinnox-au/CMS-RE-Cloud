import type { AppContent } from '@tinnox/contracts';
import { renderApp } from '@tinnox/app-render';
import { useEffect, useRef } from 'react';
import { useMediaQuery } from '../../shell/useMediaQuery.ts';
import './apps.css';

export interface AppPreviewProps {
  readonly content: AppContent;
  /** Told when the text starts or stops overflowing the box. */
  readonly onOverflow?: (overflowing: boolean) => void;
}

/**
 * An app drawn by the shared renderer (`@tinnox/app-render`), the code the player runs, so
 * the preview is proportionally honest. It fills its parent, which must be positioned and
 * sized (the content area of a `CanvasFrame`). Times use this computer's zone: the portal has
 * no screen's site to take one from. The view is disposed on every change and on unmount.
 */
export function AppPreview({ content, onOverflow }: AppPreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // Kept in a ref, so a new callback from the parent does not draw the app again.
  const overflowRef = useRef(onOverflow);
  useEffect(() => {
    overflowRef.current = onOverflow;
  }, [onOverflow]);

  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const view = renderApp(content, {
      now: Date.now,
      timeZone: null,
      reducedMotion,
      onOverflow: (overflowing) => overflowRef.current?.(overflowing),
    });
    box.append(view.element);
    return () => {
      view.dispose();
      view.element.remove();
    };
  }, [content, reducedMotion]);

  return (
    <div
      ref={boxRef}
      className="tx-app-preview"
      aria-hidden="true"
      data-testid="app-preview"
      data-app-type={content.type}
    />
  );
}
