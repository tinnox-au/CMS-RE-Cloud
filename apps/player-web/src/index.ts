import { PlayerApp } from './app.ts';
import { requireElement } from './ui/dom.ts';

const app = new PlayerApp(
  requireElement('stage'),
  requireElement('screen'),
  requireElement('diagnostics'),
);

// "d" opens and closes the diagnostics panel. Errors never cover content by themselves.
addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (event.key === 'd' || event.key === 'D') {
    event.preventDefault();
    app.toggleDiagnostics();
  } else if (event.key === 'Escape') {
    app.closeDiagnostics();
  }
});

app.boot().catch((err: unknown) => {
  // Last resort: say that start-up failed instead of leaving a blank page.
  console.error('player: start-up failed', err instanceof Error ? err.message : 'unknown error');
  const screen = requireElement('screen');
  const message = document.createElement('p');
  message.textContent =
    'The player could not start. Reload the page; if this persists, open diagnostics with "d".';
  screen.replaceChildren(message);
  screen.hidden = false;
});
