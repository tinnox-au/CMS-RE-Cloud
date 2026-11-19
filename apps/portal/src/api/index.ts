import { createApiClient } from './client.ts';
import { createEndpoints } from './endpoints.ts';

type Listener = () => void;
const unauthenticatedListeners = new Set<Listener>();
const forbiddenListeners = new Set<Listener>();

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

export const apiClient = createApiClient({
  fetch: (input, init) => window.fetch(input, init),
  onUnauthenticated: () => {
    for (const listener of unauthenticatedListeners) listener();
  },
  onForbidden: () => {
    for (const listener of forbiddenListeners) listener();
  },
});

export const api = createEndpoints(apiClient);
