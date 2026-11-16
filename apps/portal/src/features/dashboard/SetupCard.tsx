import type { SetupProgress, SetupStep } from '../../lib/dashboard.ts';
import { Button, ButtonLink, Card, CardHeader, cx, Icon, VisuallyHidden } from '../../ui/index.ts';
import { ArrowRight, Check, Send } from '../../ui/icons.ts';
import { usePush } from '../push/PushContext.tsx';

interface SetupCardProps {
  readonly progress: SetupProgress;
}

/**
 * "Get set up": the four steps from an empty organisation to content on a screen. Each step
 * is done or not from what the API answered, and links to the place to do it. The page
 * stops showing the card once all four are done.
 */
export function SetupCard({ progress }: SetupCardProps) {
  return (
    <Card as="section" aria-labelledby="dashboard-setup-title" className="tx-dashboard-setup">
      <CardHeader
        id="dashboard-setup-title"
        title="Get set up"
        size="title"
        description="Four steps from an empty organisation to your content on a screen."
        actions={
          <span
            className="tx-dashboard-setup__summary tx-num"
            data-testid="dashboard-setup-summary"
          >
            {progress.summary}
          </span>
        }
      />
      <div
        className="tx-dashboard-setup__bar"
        role="progressbar"
        aria-label="Set-up progress"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.doneCount}
        aria-valuetext={progress.summary}
      >
        {progress.steps.map((step) => (
          <span
            key={step.id}
            className={cx('tx-dashboard-setup__segment', step.done && 'is-done')}
          />
        ))}
      </div>
      <ol className="tx-dashboard-setup__steps" data-testid="dashboard-setup">
        {progress.steps.map((step, index) => (
          <SetupStepItem key={step.id} step={step} number={index + 1} />
        ))}
      </ol>
    </Card>
  );
}

function SetupStepItem({ step, number }: { readonly step: SetupStep; readonly number: number }) {
  const { openDialog } = usePush();
  const action = step.action;
  return (
    <li
      className={cx('tx-dashboard-step', step.done && 'tx-dashboard-step--done')}
      data-testid={`dashboard-setup-step-${step.id}`}
      data-done={step.done ? 'true' : 'false'}
    >
      <span className="tx-dashboard-step__marker" aria-hidden="true">
        {step.done ? <Icon icon={Check} size={16} /> : <span className="tx-num">{number}</span>}
      </span>
      <div className="tx-dashboard-step__body">
        <h3 className="tx-dashboard-step__title">
          {step.title}
          <VisuallyHidden>{step.done ? ', done' : ', to do'}</VisuallyHidden>
        </h3>
        <p className="tx-dashboard-step__text">{step.done ? step.doneText : step.text}</p>
        {action !== null && (
          <div className="tx-dashboard-step__action">
            {action.kind === 'link' ? (
              <ButtonLink
                to={action.to}
                size="sm"
                variant="secondary"
                trailingIcon={ArrowRight}
                data-testid={`dashboard-setup-action-${step.id}`}
              >
                {action.label}
              </ButtonLink>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon={Send}
                onClick={() => {
                  openDialog();
                }}
                data-testid={`dashboard-setup-action-${step.id}`}
              >
                {action.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
