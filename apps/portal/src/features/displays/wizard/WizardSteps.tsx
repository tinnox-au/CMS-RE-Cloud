import type { WizardStepId, WizardStepView } from '../../../lib/screenWizard.ts';
import { Check } from '../../../ui/icons.ts';
import { Icon, VisuallyHidden } from '../../../ui/index.ts';
import './wizard.css';

export interface WizardStepsProps {
  /** From `wizardStepViews` in lib/screenWizard.ts. */
  readonly steps: readonly WizardStepView[];
  /** A step the operator may jump to was pressed. */
  readonly onSelect: (step: WizardStepId) => void;
}

function StepContent({ step }: { readonly step: WizardStepView }) {
  return (
    <>
      <span className="tx-screen-wizard__step-marker" aria-hidden="true">
        {step.complete ? <Icon icon={Check} size={16} /> : step.number}
      </span>
      <span className="tx-screen-wizard__step-text">
        <VisuallyHidden>{step.position}: </VisuallyHidden>
        <span className="tx-screen-wizard__step-label">{step.label}</span>
        <span className="tx-screen-wizard__step-note">{step.note}</span>
      </span>
    </>
  );
}

/**
 * The progress header of the Add screen wizard: an ordered list of the three steps inside
 * a navigation landmark. The current step carries `aria-current="step"`; every step says
 * its position and whether it is completed in words, so nothing rests on the colour or the
 * tick alone. A step is a button only when the operator may jump to it.
 */
export function WizardSteps({ steps, onSelect }: WizardStepsProps) {
  return (
    <nav
      className="tx-screen-wizard__steps"
      aria-label="Add screen steps"
      data-testid="screen-wizard-steps"
    >
      <ol className="tx-screen-wizard__step-list">
        {steps.map((step) => (
          <li
            key={step.id}
            className="tx-screen-wizard__step"
            data-current={step.current ? '' : undefined}
            data-complete={step.complete ? '' : undefined}
            data-testid={`screen-wizard-step-${step.id}`}
          >
            {step.reachable ? (
              <button
                type="button"
                className="tx-screen-wizard__step-body tx-screen-wizard__step-body--link"
                onClick={() => {
                  onSelect(step.id);
                }}
              >
                <StepContent step={step} />
              </button>
            ) : (
              <span
                className="tx-screen-wizard__step-body"
                aria-current={step.current ? 'step' : undefined}
              >
                <StepContent step={step} />
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
