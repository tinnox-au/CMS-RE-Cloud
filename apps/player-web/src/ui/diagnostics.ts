import type { PlayerError } from '@tinnox/contracts';
import { el } from './dom.ts';

export interface DiagnosticsModel {
  readonly sections: readonly {
    readonly title: string;
    readonly rows: readonly (readonly [label: string, value: string])[];
  }[];
  readonly errors: readonly PlayerError[];
}

const REFRESH_MS = 1_000;

/**
 * Diagnostics panel. Closed by default so problems never cover content; the "d"
 * key opens and closes it. It shows no credential and no signed URL.
 */
export class Diagnostics {
  readonly #root: HTMLElement;
  readonly #model: () => Promise<DiagnosticsModel>;
  readonly #body: HTMLElement;
  readonly #reset: HTMLButtonElement;
  #timer: ReturnType<typeof setInterval> | null = null;
  #armed = false;
  #refreshing = false;

  constructor(root: HTMLElement, model: () => Promise<DiagnosticsModel>, onReset: () => void) {
    this.#root = root;
    this.#model = model;
    this.#body = el('div');
    this.#reset = el('button', { className: 'danger', text: 'Reset this player…' });
    this.#reset.type = 'button';
    this.#reset.setAttribute('data-testid', 'diagnostics-reset');
    this.#reset.addEventListener('click', () => {
      if (!this.#armed) {
        // Two deliberate clicks: the first only arms the button.
        this.#armed = true;
        this.#reset.textContent = 'Confirm: remove registration and cached content';
        return;
      }
      onReset();
    });
    root.setAttribute('data-testid', 'diagnostics');
    root.replaceChildren(
      el('h2', { text: 'Player diagnostics' }),
      el('p', {
        className: 'hint',
        text: 'Press "d" to close. Nothing here is sent anywhere by opening it.',
      }),
      this.#body,
      el('h3', { text: 'Local reset' }),
      el('p', {
        className: 'hint',
        text: 'Removes the registration, the device credential and all cached media from this browser, then shows a new pairing code.',
      }),
      this.#reset,
    );
  }

  get open(): boolean {
    return !this.#root.hidden;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    this.#root.hidden = false;
    void this.#refresh();
    this.#timer ??= setInterval(() => void this.#refresh(), REFRESH_MS);
  }

  close(): void {
    this.#root.hidden = true;
    this.#armed = false;
    this.#reset.textContent = 'Reset this player…';
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async #refresh(): Promise<void> {
    if (this.#refreshing) return;
    this.#refreshing = true;
    try {
      const model = await this.#model();
      const nodes: Node[] = [];
      for (const section of model.sections) {
        nodes.push(el('h3', { text: section.title }));
        const list = el('dl');
        for (const [label, value] of section.rows) {
          list.append(el('dt', { text: label }), el('dd', { text: value }));
        }
        nodes.push(list);
      }
      nodes.push(el('h3', { text: `Recent problems (${model.errors.length})` }));
      if (model.errors.length === 0) {
        nodes.push(el('p', { className: 'hint', text: 'None recorded.' }));
      } else {
        const list = el('ol');
        for (const error of model.errors) {
          list.append(el('li', { text: `${error.at}  ${error.code}: ${error.message}` }));
        }
        nodes.push(list);
      }
      this.#body.replaceChildren(...nodes);
    } catch {
      this.#body.replaceChildren(el('p', { text: 'Diagnostics could not be read.' }));
    } finally {
      this.#refreshing = false;
    }
  }
}
