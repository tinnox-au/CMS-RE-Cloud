import { formatPairingCode, normalisePairingCode, type DisplayDto } from '@tinnox/contracts';
import { useState, type FormEvent } from 'react';
import { api } from '../../../api/index.ts';
import { formatTimestamp } from '../../../lib/format.ts';
import {
  endPairingWords,
  PAIRING_CODE_PROBLEM,
  pairingAcceptedText,
  pairingHelp,
  pairingHint,
  pairingStateText,
  pairingTtlMinutes,
} from '../../../lib/screenDetail.ts';
import { useSession } from '../../../session/SessionContext.tsx';
import { KeyRound, Unlink } from '../../../ui/icons.ts';
import { Banner, Button, ErrorNotice, Field, StatusPill, TextInput } from '../../../ui/index.ts';
import { apiErrorCode } from './errors.ts';
import type { RevokeState } from './types.ts';

export interface PairingTabProps {
  readonly display: DisplayDto;
  /** After a code was accepted: read the screen and its status again. */
  readonly onPaired: () => void;
  /** Opens the confirmation to revoke the player or, with none paired, cancel a pending pairing. */
  readonly onRevoke: () => void;
  /** The revocation started from this tab, while its outcome is shown. */
  readonly revoke: RevokeState | null;
  readonly onDismissRevoke: () => void;
}

/**
 * Pair a player with the code it shows, replace the paired player, or revoke it (as M0).
 * With no player paired, the last action cancels a code accepted but not yet collected.
 */
export function PairingTab({
  display,
  onPaired,
  onRevoke,
  revoke,
  onDismissRevoke,
}: PairingTabProps) {
  const { limits } = useSession();
  const ttlMinutes = pairingTtlMinutes(limits.pairingCodeTtlSeconds);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<{ replaced: boolean } | null>(null);
  const paired = display.player !== null;
  const endPairing = endPairingWords(paired);

  // A revocation that went through also cancelled the code accepted here, so the banner
  // that says its player is about to collect a credential no longer holds.
  if (claimed !== null && revoke !== null && revoke.result !== null) setClaimed(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // One request about the player at a time: not while a revocation is on its way either.
    if (busy || revoke?.busy === true) return;
    setClaimed(null);
    setError(null);
    onDismissRevoke();
    const normalised = normalisePairingCode(code);
    if (normalised === null) {
      setFieldError(PAIRING_CODE_PROBLEM);
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    api
      .claimPairing(display.id, normalised)
      .then((result) => {
        setBusy(false);
        setClaimed({ replaced: result.replacedRegistrationId !== null });
        setCode('');
        onPaired();
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setError(reason);
      });
  };

  const preview = normalisePairingCode(code);
  const help = pairingHelp(apiErrorCode(error), ttlMinutes);

  return (
    <div className="tx-screen-detail-pairing" data-testid="screen-detail-pairing">
      <section className="tx-screen-detail-section" aria-labelledby="screen-detail-player-title">
        <h3 id="screen-detail-player-title" className="tx-screen-detail-caption">
          Player
        </h3>
        <p className="tx-screen-detail-pairing__state">
          <StatusPill tone="neutral">{paired ? 'Paired' : 'Not paired'}</StatusPill>
        </p>
        <p data-testid="screen-detail-pairing-state">
          {pairingStateText(
            display.player === null ? null : formatTimestamp(display.player.registeredAt),
          )}
        </p>
      </section>

      <section className="tx-screen-detail-section" aria-labelledby="screen-detail-pair-title">
        <h3 id="screen-detail-pair-title" className="tx-screen-detail-caption">
          {paired ? 'Pair a different player' : 'Pair a player'}
        </h3>
        <form
          className="tx-screen-detail-pairform"
          noValidate
          onSubmit={submit}
          aria-labelledby="screen-detail-pair-title"
        >
          <Field
            label="Pairing code shown on the player"
            error={fieldError}
            hint={pairingHint(ttlMinutes)}
          >
            {(control) => (
              <TextInput
                {...control}
                mono
                width="sm"
                value={code}
                maxLength={32}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                data-testid="screen-detail-pairing-code"
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
            )}
          </Field>
          <div className="tx-screen-detail-form__actions">
            <Button
              type="submit"
              variant="primary"
              icon={KeyRound}
              busy={busy}
              data-testid="screen-detail-pair"
            >
              Pair player
            </Button>
            {preview !== null && !busy && (
              <span className="tx-screen-detail-note" data-testid="screen-detail-pairing-preview">
                Will be sent as <span className="tx-mono">{formatPairingCode(preview)}</span>
              </span>
            )}
          </div>
        </form>
        {claimed !== null && (
          <Banner
            tone="ok"
            title="Code accepted"
            live="polite"
            onDismiss={() => {
              setClaimed(null);
            }}
          >
            {pairingAcceptedText(claimed.replaced)}
          </Banner>
        )}
        {error !== null && (
          <>
            <ErrorNotice error={error} title="The player was not paired" />
            {help !== null && <p data-testid="screen-detail-pairing-help">{help}</p>}
          </>
        )}
      </section>

      <section className="tx-screen-detail-section" aria-labelledby="screen-detail-revoke-title">
        <h3 id="screen-detail-revoke-title" className="tx-screen-detail-caption">
          {paired ? 'Revoke' : 'Pending pairing'}
        </h3>
        <p id="screen-detail-revoke-note" className="tx-screen-detail-note">
          {endPairing.note}
        </p>
        <div className="tx-screen-detail-form__actions">
          <Button
            variant={paired ? 'danger' : 'secondary'}
            icon={Unlink}
            busy={revoke?.busy === true}
            // Not while a code is being sent: the two answers could arrive in either order.
            aria-disabled={busy || undefined}
            aria-describedby="screen-detail-revoke-note"
            onClick={onRevoke}
            data-testid="screen-detail-revoke"
          >
            {endPairing.button}
          </Button>
        </div>
        {revoke !== null && revoke.result !== null && (
          <Banner tone="ok" live="polite" onDismiss={onDismissRevoke}>
            {revoke.result}
          </Banner>
        )}
        {revoke !== null && revoke.error !== null && (
          <ErrorNotice
            error={revoke.error}
            title={endPairing.errorTitle}
            onDismiss={onDismissRevoke}
          />
        )}
      </section>
    </div>
  );
}
