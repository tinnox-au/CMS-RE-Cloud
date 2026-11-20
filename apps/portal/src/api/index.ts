import { createApiClient } from './client.ts';
import { createEndpoints } from './endpoints.ts';

type Listener = () => void;
const unauthenticatedListeners = new Set<Listener>();
const forbiddenListeners = new Set<Listener>();
const sessionChangedListeners = new Set<Listener>();

/** The session provider subscribes here so that any 401 returns the operator to sign-in. */
export function onUnauthenticated(listener: Listener): () => void {
  unauthenticatedListeners.add(listener);
  return () => {
    unauthenticatedListeners.delete(listener);
  };
}

/** The session provider subscribes here so that a refusal by role reloads the session. */
export function onForbidden(listener: Listener): () => void {
  forbiddenListeners.add(listener);
  return () => {
    forbiddenListeners.delete(listener);
  };
}

/**
 * The session provider subscribes here so that a request refused because another member signed
 * in meanwhile (in this browser) reloads the session and starts the portal again.
 */
export function onSessionChanged(listener: Listener): () => void {
  sessionChangedListeners.add(listener);
  return () => {
    sessionChangedListeners.delete(listener);
  };
}

export const apiClient = createApiClient({
  fetch: (input, init) => window.fetch(input, init),
  onUnauthenticated: () => {
    for (const listener of unauthenticatedListeners) listener();
  },
  onForbidden: () => {
    for (const listener of forbiddenListeners) listener();
  },
  onSessionChanged: () => {
    for (const listener of sessionChangedListeners) listener();
  },
});

export const api = createEndpoints(apiClient);
