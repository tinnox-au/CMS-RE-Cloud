/** What the diagnostics overlay says about the service worker. */
export type ShellCacheStatus =
  | 'not supported by this browser'
  | 'off in the development server (build and preview to test offline reload)'
  | 'registering'
  | 'installed; this page is not controlled yet (reload once)'
  | 'active; shell is cached for offline reload'
  | 'registration failed';

let status: ShellCacheStatus = 'registering';

export function shellCacheStatus(): ShellCacheStatus {
  return status;
}

/**
 * Registers the shell service worker (production builds only; the Vite development
 * server has no precache list). The worker caches only the player's own static
 * files; see sw/sw.ts.
 */
export async function registerShellWorker(enabled: boolean): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    status = 'not supported by this browser';
    return;
  }
  if (!enabled) {
    status = 'off in the development server (build and preview to test offline reload)';
    return;
  }
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    status =
      navigator.serviceWorker.controller === null
        ? 'installed; this page is not controlled yet (reload once)'
        : 'active; shell is cached for offline reload';
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      status = 'active; shell is cached for offline reload';
    });
  } catch {
    status = 'registration failed';
  }
}
