import { createApiClient } from './client.ts';
import { createEndpoints } from './endpoints.ts';

type Listener = () => void;
const unauthenticatedListeners = new Set<Listener>();

/** The session provider subscribes here so that any 401 returns the operator to sign-in. */
export function onUnauthenticated(listener: Listener): () => void {
  unauthenticatedListeners.add(listener);
  return () => {
    unauthenticatedListeners.delete(listener);
  };
}

export const apiClient = createApiClient({
  fetch: (input, init) => window.fetch(input, init),
  onUnauthenticated: () => {
    for (const listener of unauthenticatedListeners) listener();
  },
});

export const api = createEndpoints(apiClient);
