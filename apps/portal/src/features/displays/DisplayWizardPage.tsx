import type { DisplayDto, SiteDto } from '@tinnox/contracts';
import { useCallback, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import {
  displayFormFromDto,
  EMPTY_DISPLAY_FORM,
  type DisplayFormValues,
} from '../../lib/displayForm.ts';
import {
  parseWizardLocation,
  safeToLeaveNote,
  sameDisplayForm,
  wizardPath,
  wizardStepViews,
  type WizardStepId,
} from '../../lib/screenWizard.ts';
import { EditorPage } from '../../shell/EditorPage.tsx';
import { CircleCheck, Info, RefreshCw } from '../../ui/icons.ts';
import {
  Banner,
  Button,
  ButtonLink,
  ErrorNotice,
  Icon,
  Skeleton,
  SkeletonGroup,
} from '../../ui/index.ts';
import { useLeaveGuard } from '../shared/useLeaveGuard.tsx';
import { ContentStep } from './wizard/ContentStep.tsx';
import { DetailsStep } from './wizard/DetailsStep.tsx';
import { PairStep } from './wizard/PairStep.tsx';
import { useWizardScreen } from './wizard/useWizardScreen.ts';
import { WizardSteps } from './wizard/WizardSteps.tsx';
import './wizard/wizard.css';

const BACK = { to: '/screens', label: 'All screens' } as const;

function StepSkeleton() {
  return (
    <SkeletonGroup label="Loading" className="tx-screen-wizard__panel">
      <Skeleton width="40%" height="24px" />
      <Skeleton width="70%" />
      <Skeleton variant="block" height="160px" />
      <Skeleton variant="block" height="96px" />
    </SkeletonGroup>
  );
}

/**
 * Add screen (docs/portal-v2/stage-a.md, section 3.7): three steps, Details, Pair and
 * Content, under one progress header. The first step creates the screen; from then on the
 * address names it (`/screens/new?screen=<id>&step=pair`), so a reload resumes the wizard
 * and going back to Details edits the same screen instead of creating another. Leaving at
 * any point after creation is safe: the screen exists and the page says so.
 */
export function DisplayWizardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { displayId, step } = parseWizardLocation(location.search);
  const screen = useWizardScreen(displayId);

  const loadSites = useCallback((signal: AbortSignal) => api.listSites(signal), []);
  const sites = useLoad<SiteDto[]>(loadSites);

  const [values, setValues] = useState<DisplayFormValues>(EMPTY_DISPLAY_FORM);
  /** The screen the form was last filled from, so a loaded screen fills it once. */
  const [formFor, setFormFor] = useState<string | null>(null);
  const [siteDefaulted, setSiteDefaulted] = useState(false);
  /** Screens for which a pairing code was accepted during this visit. */
  const [claimedFor, setClaimedFor] = useState<string | null>(null);
  /** The address the page opened on: a step reached later takes keyboard focus. */
  const [firstKey] = useState(location.key);

  const display = screen.state.status === 'ready' ? screen.state.display : null;

  // Fill the form from a screen that was loaded by its address (render-time state update).
  if (display !== null && formFor !== display.id) {
    setFormFor(display.id);
    setValues(displayFormFromDto(display));
  }
  const onlySite =
    sites.state.status === 'ready' && sites.state.data.length === 1
      ? sites.state.data[0]
      : undefined;
  // A new screen in an organisation with one site starts on that site, as in M0.
  if (!siteDefaulted && sites.state.status === 'ready') {
    setSiteDefaulted(true);
    if (displayId === null && onlySite !== undefined && values.siteId === '') {
      setValues({ ...values, siteId: onlySite.id });
    }
  }
  // Back on the bare address after a screen was made: start a new, empty form.
  if (displayId === null && display === null && formFor !== null) {
    setFormFor(null);
    setClaimedFor(null);
    setValues({ ...EMPTY_DISPLAY_FORM, siteId: onlySite?.id ?? '' });
  }

  const dirty = display !== null && !sameDisplayForm(values, displayFormFromDto(display));
  // Before the screen exists, anything typed into the details is unsaved too.
  const unsaved =
    dirty ||
    (display === null &&
      screen.state.status !== 'error' &&
      !sameDisplayForm({ ...values, siteId: '' }, EMPTY_DISPLAY_FORM));
  const leaveGuard = useLeaveGuard(unsaved, values.name.trim() === '' ? null : values.name.trim());
  const focusHeading = location.key !== firstKey;

  const goTo = (target: WizardStepId) => {
    if (display === null) return;
    void navigate(wizardPath(display.id, target));
  };

  const accept = (updated: DisplayDto) => {
    screen.set(updated);
    setFormFor(updated.id);
    setValues(displayFormFromDto(updated));
  };

  const finish = () => {
    if (display !== null) void navigate(`/screens/${display.id}`);
  };

  const steps = wizardStepViews({
    // A screen that could not be loaded leaves nothing to show beyond the first step.
    step: screen.state.status === 'error' ? 'details' : step,
    screenName: display?.name ?? null,
    paired: display !== null && (display.player !== null || claimedFor === display.id),
    assignedPlaylistName: display?.assignedPlaylist?.name ?? null,
    detailsDirty: dirty,
  });

  let body: ReactNode;
  if (displayId !== null && screen.state.status === 'error') {
    body = (
      <div className="tx-screen-wizard__panel">
        <ErrorNotice
          error={screen.state.error}
          title="The screen could not be loaded"
          onRetry={screen.reload}
        />
        <div className="tx-cluster">
          <ButtonLink to="/screens/new" data-testid="screen-wizard-restart">
            Add a new screen instead
          </ButtonLink>
        </div>
      </div>
    );
  } else if (displayId !== null && display === null) {
    body = <StepSkeleton />;
  } else if (step === 'details' || display === null) {
    if (sites.state.status === 'loading') {
      body = <StepSkeleton />;
    } else if (sites.state.status === 'error') {
      body = (
        <div className="tx-screen-wizard__panel">
          <ErrorNotice
            error={sites.state.error}
            title="The form could not be loaded"
            onRetry={sites.reload}
          />
        </div>
      );
    } else if (sites.state.data.length === 0) {
      body = (
        <div className="tx-screen-wizard__panel">
          <Banner
            tone="danger"
            live="assertive"
            title="No site available"
            actions={
              <Button size="sm" icon={RefreshCw} onClick={sites.reload}>
                Try again
              </Button>
            }
          >
            This organisation has no site. A site is created by the seed step.
          </Banner>
        </div>
      );
    } else {
      body = (
        <DetailsStep
          sites={sites.state.data}
          created={display}
          values={values}
          onChange={setValues}
          dirty={dirty}
          onDiscard={() => {
            if (display !== null) setValues(displayFormFromDto(display));
          }}
          focusHeading={focusHeading}
          onCreated={(created) => {
            accept(created);
            // Replace the empty form in the history: going back must not offer to create
            // the same screen a second time.
            void navigate(wizardPath(created.id, 'pair'), { replace: true });
          }}
          onSaved={(saved) => {
            accept(saved);
            void navigate(wizardPath(saved.id, 'pair'));
          }}
          onContinue={() => {
            goTo('pair');
          }}
        />
      );
    }
  } else if (step === 'pair') {
    body = (
      <PairStep
        key={display.id}
        display={display}
        claimed={claimedFor === display.id}
        focusHeading={focusHeading}
        onClaimed={() => {
          setClaimedFor(display.id);
          screen.reload();
        }}
        onBack={() => {
          goTo('details');
        }}
        onNext={() => {
          goTo('content');
        }}
      />
    );
  } else {
    body = (
      <ContentStep
        key={display.id}
        display={display}
        focusHeading={focusHeading}
        onAssigned={accept}
        onBack={() => {
          goTo('pair');
        }}
        onFinish={finish}
      />
    );
  }

  return (
    <EditorPage
      title="Add screen"
      back={BACK}
      status={
        unsaved ? (
          <span role="status" data-testid="screen-wizard-unsaved">
            Unsaved changes
          </span>
        ) : display !== null ? (
          <span className="tx-cluster" data-testid="screen-wizard-created">
            <Icon icon={CircleCheck} size={16} />
            Screen created
          </span>
        ) : undefined
      }
    >
      <div className="tx-screen-wizard" data-testid="screen-wizard">
        <div className="tx-screen-wizard__card">
          <WizardSteps steps={steps} onSelect={goTo} />
          {body}
        </div>
        {display !== null && (
          <p className="tx-screen-wizard__aside-note" data-testid="screen-wizard-safe-note">
            <Icon icon={Info} size={16} />
            <span>{safeToLeaveNote(display.name)}</span>
          </p>
        )}
      </div>
      {leaveGuard.dialog}
    </EditorPage>
  );
}
