/**
 * Draws built-in apps for the player and the portal preview. No network, no HTML strings, no
 * style attribute: text via textContent, styles via `style.setProperty`, motion via the Web Animations API.
 */
export { renderApp, type AppEnv, type AppView } from './render.ts';
export { countdownText } from './text.ts';
export { wallToEpoch } from './zone.ts';
