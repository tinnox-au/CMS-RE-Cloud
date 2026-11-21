import { ALERT_CONFIRM_TTL_DAYS } from '@tinnox/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiRequestError } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useDocumentTitle } from '../../shell/useDocumentTitle.ts';
import { Wordmark } from '../../shell/Wordmark.tsx';
import { Banner, ErrorNotice, Spinner } from '../../ui/index.ts';

type Outcome =
  | { readonly kind: 'checking' | 'confirmed' | 'invalid' }
  | { readonly kind: 'error'; readonly error: unknown };

/**
 * `/alerts/confirm#<token>` (docs/portal-v2/stage-c-alerts.md section 6): the link in the
 * confirmation e-mail. Shown without a session. The token is in the fragment, so it never
 * reaches a server log; the page posts it once and removes it from the address.
 */
export function AlertConfirmPage() {
  useDocumentTitle('Confirm alert e-mails');
  // Read once, before the fragment is cleared.
  const [token] = useState(() => window.location.hash.slice(1));
  const [outcome, setOutcome] = useState<Outcome>({ kind: token === '' ? 'invalid' : 'checking' });
  const started = useRef(false);

  const post = useCallback(() => {
    api.confirmAlertRecipient(token).then(
      () => {
        setOutcome({ kind: 'confirmed' });
      },
      (error: unknown) => {
        // 404: unknown, used or expired; 400: not a token at all.
        const invalid = isApiRequestError(error) && (error.status === 404 || error.status === 400);
        setOutcome(invalid ? { kind: 'invalid' } : { kind: 'error', error });
      },
    );
  }, [token]);

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
    // Once: StrictMode runs effects twice, and a second post of a used link is "not valid".
    if (started.current || token === '') return;
    started.current = true;
    post();
  }, [post, token]);

  return (
    <main className="tx-screen">
      <div className="tx-screen__card">
        <Wordmark size="lg" />
        <h1 className="tx-screen__title">Alert e-mails</h1>
        {outcome.kind === 'checking' && <Spinner size="lg" label="Confirming the address…" />}
        {outcome.kind === 'confirmed' && (
          <Banner tone="ok" live="polite" title="Alerts confirmed">
            <p>This address will now receive screen alerts.</p>
          </Banner>
        )}
        {outcome.kind === 'invalid' && (
          <Banner tone="warn" live="polite" title="This link is not valid any more">
            <p>
              A confirmation link works once, within {ALERT_CONFIRM_TTL_DAYS} days. If it was
              already used, nothing more is needed. Otherwise ask an Admin of the organisation to
              add the address again.
            </p>
          </Banner>
        )}
        {outcome.kind === 'error' && (
          <ErrorNotice
            error={outcome.error}
            title="The address could not be confirmed"
            onRetry={() => {
              setOutcome({ kind: 'checking' });
              post();
            }}
          />
        )}
      </div>
    </main>
  );
}
