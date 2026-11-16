import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { WizardStepId } from '../../../lib/screenWizard.ts';
import { cx } from '../../../ui/index.ts';
import './wizard.css';

export interface StepPanelProps {
  readonly step: WizardStepId;
  /** The step's heading, an `h2` under the page's "Add screen". */
  readonly title: string;
  readonly description?: ReactNode;
  /**
   * Move keyboard focus to the heading when the panel appears, so a step change made inside
   * the wizard is announced and the next Tab starts at the top of the new step. Left off
   * for the step the page opens on: the shell announces the page itself.
   */
  readonly focusHeading: boolean;
  /** Keeps the content in a narrow, centred column: the pairing and content steps. */
  readonly narrow?: boolean;
  readonly children: ReactNode;
}

/** The body of one wizard step: a labelled region with its heading and content. */
export function StepPanel({
  step,
  title,
  description,
  focusHeading,
  narrow = false,
  children,
}: StepPanelProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Decided when the panel appears; a later change of the flag must not steal focus.
  const focusOnMount = useRef(focusHeading);

  useEffect(() => {
    if (!focusOnMount.current) return;
    // The step indicator is above the heading: show the whole card from its top.
    window.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      className={cx('tx-screen-wizard__panel', narrow && 'tx-screen-wizard__panel--narrow')}
      aria-labelledby={headingId}
      data-testid={`screen-wizard-panel-${step}`}
    >
      <header className="tx-screen-wizard__panel-head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="tx-screen-wizard__title">
          {title}
        </h2>
        {description !== undefined && <p className="tx-screen-wizard__lead">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export interface StepFooterProps {
  /** The quiet actions at the start of the row: Cancel, Back. */
  readonly start?: ReactNode;
  /** The actions at the end, the primary one last. */
  readonly children: ReactNode;
}

/** The action row under a step, separated from it by a hairline. */
export function StepFooter({ start, children }: StepFooterProps) {
  return (
    <div className="tx-screen-wizard__footer">
      <div className="tx-screen-wizard__footer-start">{start}</div>
      <div className="tx-screen-wizard__footer-end">{children}</div>
    </div>
  );
}
