import { normalisePairingCode, type DisplayDto } from '@tinnox/contracts';
import { useCallback, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { isApiRequestError } from '../../../api/client.ts';
import { api } from '../../../api/index.ts';
import { useLoad } from '../../../hooks/useLoad.ts';
import { formatTimestamp } from '../../../lib/format.ts';
import {
  PAIRING_CODE_FORMAT_PROBLEM,
  formatPairingCodeInput,
  localPlayerAddress,
  minutesLabel,
  pairingCodeMinutes,
  pairingRefusalAdvice,
} from '../../../lib/screenWizard.ts';
import { useCan, useSession } from '../../../session/AuthenticatedSession.tsx';
import { ArrowLeft, ArrowRight, ExternalLink, KeyRound } from '../../../ui/icons.ts';
import { Banner, Button, ErrorNotice, Field, Icon, TextInput } from '../../../ui/index.ts';
import { ScreenStatusPill } from '../../shared/index.ts';
import { StepFooter, StepPanel } from './StepPanel.tsx';
import './wizard.css';

/** How often the screen's status is read while the wizard waits for the player's report. */
const STATUS_POLL_MS = 3000;

export interface PairStepProps {
  readonly display: DisplayDto;
  /** A code was accepted for this screen during this visit to the wizard. */
  readonly claimed: boolean;
  readonly focusHeading: boolean;
  /** The server accepted a code. */
  readonly onClaimed: () => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
}

/** What the player last reported, read again every few seconds while the step is open. */
function PlayerStatus({ displayId }: { readonly displayId: string }) {
  const load = useCallback(
    (signal: AbortSignal) => api.getDisplayStatus(displayId, signal),
    [displayId],
  );
  const { state } = useLoad(load, STATUS_POLL_MS);
  return (
    <div className="tx-screen-wizard__player" data-testid="screen-wizard-player-status">
      <div className="tx-screen-wizard__player-text">
        <span className="tx-strong">Player status</span>
        <span className="tx-small tx-muted">
          Read every few seconds. Once the player has its credential it reports here.
        </span>
      </div>
      {state.status === 'error' ? (
        <span className="tx-small tx-muted">
          The status could not be read{' '}
          <span className="tx-code">
            {isApiRequestError(state.error) ? state.error.code : 'unknown_error'}
          </span>
        </span>
      ) : (
        <ScreenStatusPill
          view={state.status === 'ready' ? state.data : null}
          loading={state.status === 'loading'}
          fetchedAt={state.status === 'ready' ? state.fetchedAt : undefined}
          testId="screen-wizard-status"
        />
      )}
    </div>
  );
}

/**
 * Step 2: pair the screen's player. The player shows a one-time code; the operator types it
 * here and the server ties the player to this screen (`POST /api/displays/:id/pairing`).
 * The M0 messages for a malformed code and for each refusal stay. "Skip for now" is allowed:
 * the screen exists and can be paired later from its page. Without `screen.pair` (which goes
 * with `screen.setup`, the page's own key, today) there is no form and "Skip for now" is the
 * only way on.
 */
export function PairStep({
  display,
  claimed,
  focusHeading,
  onClaimed,
  onBack,
  onNext,
}: PairStepProps) {
  const { limits } = useSession();
  const canPair = useCan('screen.pair');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<{ readonly replaced: boolean } | null>(null);
  /** After a code was accepted the form folds away until the operator asks for it. */
  const [showForm, setShowForm] = useState(!claimed);

  const inputRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (caret.current === null || input === null || document.activeElement !== input) return;
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [code]);

  const minutes = pairingCodeMinutes(limits.pairingCodeTtlSeconds);
  const playerAddress = localPlayerAddress(window.location.hostname);
  const hasPlayer = display.player !== null;
  const paired = claimed || hasPlayer;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canPair || busy) return;
    setError(null);
    setAccepted(null);
    const normalised = normalisePairingCode(code);
    if (normalised === null) {
      setFieldError(PAIRING_CODE_FORMAT_PROBLEM);
      inputRef.current?.focus();
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    api
      .claimPairing(display.id, normalised)
      .then((result) => {
        setAccepted({ replaced: result.replacedRegistrationId !== null });
        setCode('');
        setShowForm(false);
        onClaimed();
      })
      .catch((reason: unknown) => {
        setError(reason);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const advice = isApiRequestError(error) ? pairingRefusalAdvice(error.code, minutes) : null;

  return (
    <>
      <StepPanel
        step="pair"
        title="Pair the player"
        description={`The screen “${display.name}” is created. Now connect the player that drives it.`}
        focusHeading={focusHeading}
        narrow
      >
        <ol className="tx-screen-wizard__howto" aria-label="How to pair">
          <li>
            <span className="tx-screen-wizard__howto-text">
              <span className="tx-strong">Open the player on the screen’s device</span>
              {playerAddress !== null ? (
                <span className="tx-small tx-muted">
                  On this development machine the browser player runs at{' '}
                  <a
                    className="tx-screen-wizard__address"
                    href={playerAddress}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="screen-wizard-player-link"
                  >
                    {playerAddress}
                    <Icon icon={ExternalLink} size={14} label="opens in a new tab" />
                  </a>
                </span>
              ) : (
                <span className="tx-small tx-muted">
                  Start the TINNOX player in a browser on the device that drives the screen.
                </span>
              )}
            </span>
          </li>
          <li>
            <span className="tx-screen-wizard__howto-text">
              <span className="tx-strong">Read the code it shows</span>
              <span className="tx-small tx-muted">
                Eight letters or digits, for example ABCD-2345. A code works once and lasts{' '}
                {minutesLabel(minutes)}.
              </span>
            </span>
          </li>
          <li>
            <span className="tx-screen-wizard__howto-text">
              <span className="tx-strong">Enter it here</span>
              <span className="tx-small tx-muted">
                The player collects its credential the next time it checks in.
              </span>
            </span>
          </li>
        </ol>

        {accepted !== null && (
          <Banner tone="ok" live="polite" title="Code accepted">
            The player collects its credential the next time it checks in, usually within a few
            seconds. {accepted.replaced && 'The previous player credential was revoked. '}
            The status below shows the player once it sends its first report.
          </Banner>
        )}
        {accepted === null && hasPlayer && display.player !== null && (
          <Banner tone="info" title="A player is paired with this screen">
            It has held a credential since {formatTimestamp(display.player.registeredAt)}. Pairing
            another player replaces it and revokes the current credential.
          </Banner>
        )}

        {paired && <PlayerStatus displayId={display.id} />}

        {!canPair ? null : showForm ? (
          <form
            noValidate
            onSubmit={submit}
            className="tx-screen-wizard__pair-form"
            data-testid="screen-wizard-pair-form"
          >
            <div className="tx-screen-wizard__pair-row">
              <Field
                label="Pairing code shown on the player"
                error={fieldError}
                hint="Upper or lower case; the dash is added for you."
              >
                {(control) => (
                  <TextInput
                    {...control}
                    ref={inputRef}
                    mono
                    className="tx-screen-wizard__code"
                    value={code}
                    placeholder="ABCD-2345"
                    maxLength={32}
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    data-testid="screen-wizard-code"
                    onChange={(event) => {
                      const edit = formatPairingCodeInput(
                        event.target.value,
                        event.target.selectionStart ?? event.target.value.length,
                      );
                      caret.current = edit.caret;
                      setCode(edit.text);
                      setFieldError(undefined);
                    }}
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant={hasPlayer || claimed ? 'secondary' : 'primary'}
                size="lg"
                icon={KeyRound}
                busy={busy}
                data-testid="screen-wizard-pair-submit"
              >
                Pair player
              </Button>
            </div>
            {error !== null && (
              <div className="tx-stack tx-stack--tight">
                <ErrorNotice error={error} title="The player was not paired" />
                {advice !== null && (
                  <p className="tx-small" data-testid="screen-wizard-pair-advice">
                    {advice}
                  </p>
                )}
              </div>
            )}
          </form>
        ) : (
          <div>
            <Button
              variant="ghost"
              size="sm"
              icon={KeyRound}
              onClick={() => {
                setShowForm(true);
                setAccepted(null);
              }}
              data-testid="screen-wizard-pair-again"
            >
              Enter a different code
            </Button>
          </div>
        )}
      </StepPanel>

      <StepFooter
        start={
          <Button
            variant="ghost"
            icon={ArrowLeft}
            onClick={onBack}
            data-testid="screen-wizard-pair-back"
          >
            Back
          </Button>
        }
      >
        {paired && canPair ? (
          <Button
            variant="primary"
            size="lg"
            trailingIcon={ArrowRight}
            onClick={onNext}
            data-testid="screen-wizard-pair-next"
          >
            Continue
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            trailingIcon={ArrowRight}
            onClick={onNext}
            data-testid="screen-wizard-pair-skip"
          >
            Skip for now
          </Button>
        )}
      </StepFooter>
    </>
  );
}
