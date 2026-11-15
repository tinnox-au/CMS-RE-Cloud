/// <reference lib="webworker" />
/**
 * Service worker for the TINNOX browser player. Its only job is to make the
 * player SHELL (index.html and the built script and style files) load without a
 * network, so that a reload during an outage still starts the player.
 *
 * What it deliberately does not do:
 * - It never handles a request to another origin, so API responses, signed media
 *   URLs and credentials never pass through it and are never cached by it.
 * - It never caches anything that is not on the build-time shell list.
 * - It does not store media. Media bytes are written to Cache Storage by the page
 *   after verification, and read back by the page.
 *
 * This file must stay free of imports: it is built as one self-contained script.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

/** Replaced at build time (build/shell-plugin.mjs) with URI-encoded JSON. */
const SHELL_MANIFEST = '__TINNOX_SHELL_MANIFEST__';
const SHELL_CACHE_PREFIX = 'tinnox-player-shell-';
const INDEX_PATH = '/index.html';
const NAVIGATION_TIMEOUT_MS = 4_000;

interface ShellManifest {
  readonly version: string;
  readonly files: readonly string[];
}

function readManifest(): ShellManifest | null {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(SHELL_MANIFEST));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { version, files } = parsed as { version?: unknown; files?: unknown };
    if (typeof version !== 'string' || !/^[0-9a-f]{8,64}$/.test(version)) return null;
    if (
      !Array.isArray(files) ||
      !files.every((f): f is string => typeof f === 'string' && f.startsWith('/'))
    ) {
      return null;
    }
    return { version, files };
  } catch {
    return null;
  }
}

const manifest = readManifest();
const cacheName = manifest === null ? null : `${SHELL_CACHE_PREFIX}${manifest.version}`;
const shellPaths = new Set(manifest?.files ?? []);

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (manifest === null || cacheName === null) {
        throw new Error('shell manifest missing: this worker was not produced by the build');
      }
      const cache = await caches.open(cacheName);
      // `reload` bypasses the HTTP cache so the precache holds exactly this build.
      // addAll is atomic: if any file fails, the install fails and the old worker stays.
      await cache.addAll(manifest.files.map((path) => new Request(path, { cache: 'reload' })));
      // Safe to take over at once: a running player page has already loaded its single
      // script bundle and reads media straight from Cache Storage, so it requests nothing
      // further from the shell. The new shell is used from the next page load.
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        // Only old SHELL caches are removed. Media caches belong to the page.
        if (name.startsWith(SHELL_CACHE_PREFIX) && name !== cacheName) await caches.delete(name);
      }
      await sw.clients.claim();
    })(),
  );
});

async function fromShell(path: string): Promise<Response | undefined> {
  if (cacheName === null) return undefined;
  const cache = await caches.open(cacheName);
  return cache.match(path);
}

async function navigation(request: Request): Promise<Response> {
  // Prefer the network so a new build is picked up; fall back to the cached shell
  // when the server is unreachable, slow or failing.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, NAVIGATION_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.ok) return response;
  } catch {
    // Offline or timed out.
  } finally {
    clearTimeout(timer);
  }
  const cached = await fromShell(INDEX_PATH);
  if (cached !== undefined) return cached;
  return new Response('The player is offline and its files are not cached yet.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

async function shellFile(request: Request, path: string): Promise<Response> {
  const cached = await fromShell(path);
  return cached ?? fetch(request);
}

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Cross-origin requests (the API, media downloads) are never touched.
  if (url.origin !== sw.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
    return;
  }
  if (shellPaths.has(url.pathname)) {
    event.respondWith(shellFile(request, url.pathname));
  }
  // Anything else on this origin goes to the network untouched and is not cached.
});
