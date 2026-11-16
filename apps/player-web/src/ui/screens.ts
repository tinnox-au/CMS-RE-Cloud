import { formatPairingCode } from '@tinnox/contracts';
import { el } from './dom.ts';

function countdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Full-window information screens. Hidden whenever content is playing. */
// shortcut: pairing and slate screens are not rotated (rotation arrives with a publication).
export class Screens {
  readonly #root: HTMLElement;
  #pairing: { code: HTMLElement; expiry: HTMLElement; note: HTMLElement; shown: string } | null =
    null;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  #show(children: readonly Node[]): void {
    this.#pairing = null;
    this.#root.replaceChildren(el('div', { className: 'card' }, children));
    this.#root.hidden = false;
  }

  hide(): void {
    if (this.#root.hidden) return;
    this.#pairing = null;
    this.#root.hidden = true;
    this.#root.replaceChildren();
  }

  starting(text: string): void {
    this.#show([el('p', { className: 'brand', text: 'TINNOX Player' }), el('p', { text })]);
  }

  /** Not registered and no code yet (first request, or the server cannot be reached). */
  unpaired(note: string | null): void {
    this.#show([
      el('p', { className: 'brand', text: 'TINNOX Player' }),
      el('h1', { text: 'This screen is not paired' }),
      el('p', { text: 'Requesting a pairing code…' }),
      el('p', { className: 'note', text: note ?? '' }),
    ]);
  }

  /** Shows the pairing code large. Calling it again with the same code only updates the countdown. */
  pairing(code: string, secondsLeft: number, note: string | null): void {
    const expiryText = `This code expires in ${countdown(secondsLeft)}. A new one appears automatically.`;
    if (this.#pairing?.shown === code && !this.#root.hidden) {
      this.#pairing.expiry.textContent = expiryText;
      this.#pairing.note.textContent = note ?? '';
      return;
    }
    const codeEl = el('div', { className: 'code', text: formatPairingCode(code) });
    codeEl.setAttribute('data-testid', 'pairing-code');
    const expiry = el('p', { text: expiryText });
    const noteEl = el('p', { className: 'note', text: note ?? '' });
    this.#show([
      el('p', { className: 'brand', text: 'TINNOX Player' }),
      el('h1', { text: 'Pair this screen' }),
      el('p', { text: 'In the TINNOX portal, open the display and enter this code:' }),
      codeEl,
      expiry,
      noteEl,
    ]);
    this.#pairing = { code: codeEl, expiry, note: noteEl, shown: code };
  }

  /** Registered, nothing to play. Neutral by design: it may be visible to the public. */
  slate(displayName: string, detail: string): void {
    const title = el('h1', { text: displayName });
    title.setAttribute('data-testid', 'slate-display-name');
    const body = el('p', { text: detail });
    body.setAttribute('data-testid', 'slate-detail');
    this.#show([el('p', { className: 'brand', text: 'TINNOX Player' }), title, body]);
  }

  revoked(displayName: string | null, onReset: () => void): void {
    const button = el('button', { className: 'danger', text: 'Reset this player' });
    button.type = 'button';
    button.setAttribute('data-testid', 'reset-player');
    button.addEventListener('click', onReset, { once: true });
    const title = el('h1', { text: 'This player was unregistered' });
    title.setAttribute('data-testid', 'revoked-title');
    this.#show([
      el('p', { className: 'brand', text: 'TINNOX Player' }),
      title,
      el('p', {
        text:
          displayName === null
            ? 'The server no longer accepts this player.'
            : `The server no longer accepts this player for "${displayName}".`,
      }),
      el('p', {
        text: 'Its content and credential have been removed from this browser. Reset to pair it again.',
      }),
      button,
    ]);
  }

  standby(): void {
    this.#show([
      el('p', { className: 'brand', text: 'TINNOX Player' }),
      el('h1', { text: 'The player is already running in another tab' }),
      el('p', { text: 'This tab will take over if that one is closed.' }),
    ]);
  }

  fatal(title: string, detail: string): void {
    this.#show([
      el('p', { className: 'brand', text: 'TINNOX Player' }),
      el('h1', { text: title }),
      el('p', { text: detail }),
    ]);
  }
}
