import type { DisplayDto } from '@tinnox/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbort } from '../../../api/client.ts';
import { api } from '../../../api/index.ts';

export type WizardScreenState =
  | { readonly status: 'none' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly display: DisplayDto };

export interface WizardScreen {
  readonly state: WizardScreenState;
  /** Replaces the screen with the answer of a save, without a request. */
  readonly set: (display: DisplayDto) => void;
  /** Reads the screen again; on failure the last good answer stays. */
  readonly reload: () => void;
}

/**
 * The screen the wizard works on, named by the address (`?screen=<id>`). The screen the
 * wizard has just created is handed over with `set` before the address names it, so moving
 * on to the next step costs no request and shows no loading state. A screen named only by
 * the address (a reload, a link) is read with `GET /api/displays/:id`.
 */
export function useWizardScreen(displayId: string | null): WizardScreen {
  const [state, setState] = useState<WizardScreenState>(
    displayId === null ? { status: 'none' } : { status: 'loading' },
  );
  const [nonce, setNonce] = useState(0);
  const current = useRef<DisplayDto | null>(null);
  const forced = useRef(false);

  const set = useCallback((display: DisplayDto) => {
    current.current = display;
    setState({ status: 'ready', display });
  }, []);

  const reload = useCallback(() => {
    forced.current = true;
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (displayId === null) {
      current.current = null;
      setState({ status: 'none' });
      return;
    }
    const known = current.current?.id === displayId;
    if (known && !forced.current) return;
    forced.current = false;
    if (!known) setState({ status: 'loading' });
    const controller = new AbortController();
    api
      .getDisplay(displayId, controller.signal)
      .then((display) => {
        current.current = display;
        setState({ status: 'ready', display });
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        // A failed refresh keeps the screen that is on the page.
        if (current.current?.id !== displayId) setState({ status: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [displayId, nonce]);

  return { state, set, reload };
}
