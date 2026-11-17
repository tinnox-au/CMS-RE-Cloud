# TINNOX browser player (`@tinnox/player-web`)

The player half of prototype M0: a web page that pairs with a display, downloads the
publication assigned to it, and plays it full screen from local storage.

**This is a browser tab, not a kiosk-grade dedicated player.** It proves the player
protocol, the cache and the renderer in software. It does not start by itself after a
power cut, it cannot stop the browser or the operating system from suspending it, and
the browser may delete its storage. See "Browser limits" before relying on it for
anything.

Protocol reference: `docs/player-protocol-v1.md`. Decisions: `docs/prototype-m0.md`
(D7, D8, D9, D13, D14).

## Run

From the repository root (dependencies are already installed by `npm ci`):

| Command | What it does |
|---|---|
| `npm run dev -w @tinnox/player-web` | Vite development server on `127.0.0.1:5174`. **No service worker**, so no offline reload. |
| `npm run build -w @tinnox/player-web` | Production build into `apps/player-web/dist`, including `sw.js`. |
| `npm run preview -w @tinnox/player-web` | Serves the build on `127.0.0.1:5174`. Use this to test offline reload. |
| `npm run typecheck -w @tinnox/player-web` | Type check the page and the service worker. |
| `npx vitest run --project unit apps/player-web` | Unit tests of this app only. |

Open the player as **`http://localhost:5174`**, not `http://127.0.0.1:5174`: the API
allows exactly one CORS origin (`PLAYER_ORIGIN` in `.env`, default
`http://localhost:5174`).

### API address

`VITE_API_BASE_URL` (process environment or `apps/player-web/.env.local`) is read at
build time. It must be an origin only, with no path. The default is
`http://localhost:4000`, which is the API's default `API_PUBLIC_ORIGIN`. The two must be
the same string: the API puts `API_PUBLIC_ORIGIN` into the signed media URLs, and the
player refuses a media URL on any other origin. A production build refuses a plain
`http://` API unless it is a loopback address. The value is written into the
Content-Security-Policy of `index.html` and into the script; nothing in the build is
secret.

### Keys

- `d`: open or close the diagnostics panel. `Esc` closes it.
- The panel is closed by default. Problems are recorded there and reported in the
  heartbeat; they are never drawn over content.

## How it works

```
src/core        Logic with no browser dependency (unit-tested with fakes)
  machine.ts      phases and allowed transitions
  sync.ts         manifest polling, backoff, the sync loop
  staging.ts      two-phase update, activation, garbage collection
  download.ts     streamed download with resume and retry
  playback.ts     the render loop: order, durations, watchdog, failure handling
  heartbeat.ts    building and sending status reports
  backoff.ts      exponential backoff and jitter
  errors.ts       fault types, message sanitising, the bounded error list
src/platform    Browser implementations of the interfaces in core/types.ts
  api.ts          fetch client for /player/*
  idb-store.ts    IndexedDB state
  cache-assets.ts Cache Storage for media bytes
  media.ts        SHA-256 (WebCrypto), decode probes
  leader.ts       one-tab-at-a-time guard
src/ui          DOM: the stage (presenter), information screens, diagnostics
sw/sw.ts        Service worker: offline player shell only
build/          Vite plugin: CSP origin and the service worker's file list
```

### Phases

`booting → unpaired ⇄ pairing → idle ⇄ playing`, plus `faulted` (every item of the
active publication failed), `revoked`, `standby` (another tab is the player) and
`resetting`. The table in `src/core/machine.ts` is the whole definition; an event that
is not allowed in the current phase is ignored and logged to the console.

| Phase | Screen | Heartbeat `playerState` |
|---|---|---|
| `unpaired` | "This screen is not paired", requesting a code | none sent |
| `pairing` | The code, large, with a countdown | none sent |
| `idle` | Display name and "Waiting for content" | `idle` |
| `playing` | Content only | `playing` |
| `faulted` | Display name and a notice that the content cannot be played | `error` |
| `revoked` | "This player was unregistered" and a reset button | none sent |
| `standby` | "The player is already running in another tab" | none sent |

### Pairing

The player asks for a pairing session (`POST /player/pairing`) and shows the 8-character
code. It polls with a secret polling token that never appears on screen. When the code
expires, is consumed or the session disappears, a new code is requested automatically;
repeated quick failures back off (5 s doubling to 2 min). A 429 waits at least the
server's `Retry-After` (capped at 10 min) and never less than that backoff. The session is
kept in IndexedDB so a reload shows the same code while it has at least 20 s left.

When an operator claims the code, one poll response carries the device token. The player
then, in this order: deletes every media cache of this origin, replaces all stored state
with the new registration in one IndexedDB transaction, and starts syncing. If that
response is lost, or the registration cannot be stored, the player starts a new pairing.

### Storage

| Where | What | Notes |
|---|---|---|
| IndexedDB `tinnox-player`, store `kv` | `registration` (ids, display, device token), `activeVersion`, `stagingVersion`, `heartbeatSeq`, `errors`, `pairing` | Every record is validated with a zod schema when read; a record that does not match is treated as absent. |
| Cache Storage `tinnox-media-v1:<orgId>:<registrationId>` | Media bytes, one entry per SHA-256 | Written by the page only after length and digest are verified. Keys are synthetic same-origin URLs that are never requested from the network. |
| Cache Storage `tinnox-player-shell-<build hash>` | `index.html`, script, stylesheet | Written by the service worker. No customer content. |

At start-up the player deletes every media cache that does not belong to the current
registration. `navigator.storage.persist()` is requested once at start-up; the answer is
shown in diagnostics and sent in every heartbeat as `storagePersisted`. It is a request,
not a guarantee.

The device token is readable by any script running on the player origin. That is why the
player is on its own origin, loads no third-party code, has a strict CSP and never
builds HTML from strings.

### Sync and update

Every 15 s (±20 %) the player polls `GET /player/manifest` with `If-None-Match` set to
the active publication. While the server is unreachable the delay backs off from 5 s to
5 min; while an update keeps failing it backs off from 30 s to 10 min. A 429 waits at
least the server's `Retry-After` (capped at 10 min) as well as that backoff, and a
publish hint does not cut that wait short. Coming back online, the tab becoming visible,
and a heartbeat reply naming a publication the player has not tried yet all trigger an
immediate poll.

A manifest is validated with the shared schema (`parseManifest`). A malformed manifest,
an unsupported schema version or a manifest for another display is reported and
otherwise ignored: the current version keeps playing.

A new publication goes through `stagePublication` (`src/core/staging.ts`):

1. Record the staging version in IndexedDB.
2. Work out which assets are missing from the cache. Check the browser's storage
   estimate; if the update cannot fit, fail with `quota_exceeded` before downloading.
3. Request signed media URLs for the missing assets. URLs on any origin but the API's are
   refused. URLs are requested again when they have under 20 s left, or when the server
   rejects one (401, 403 or 410).
4. Download each asset as a stream. A broken or short transfer is resumed with a `Range`
   request; if the server ignores the range, the transfer starts over. Up to 6 attempts
   with backoff (1 s doubling to 30 s), and at least a 429 `Retry-After`; an attempt that
   added 1 MiB or more resets the count. A transfer with no bytes for 30 s is abandoned.
   More bytes than the manifest states stops the transfer at once.
5. Check the exact length and the SHA-256 digest (WebCrypto). Only then store the bytes.
6. When all assets are stored, read each one back and probe it: images with
   `createImageBitmap`, videos by reaching `canplay` in a detached muted element within
   20 s.
7. Ask the server once more whether this is still the current publication. If something
   newer exists, drop this one and start on the newer (at most 3 hops per cycle). If the
   server cannot be asked, continue.
8. Activate: one IndexedDB transaction checks that the registration is unchanged and not
   revoked, writes `activeVersion` and deletes `stagingVersion`.
9. Garbage-collect.

Any failure in steps 1 to 8 leaves `activeVersion` untouched, so the previous
publication keeps playing. The failure is added to the error list with its code
(`download_failed`, `size_mismatch`, `integrity_mismatch`, `quota_exceeded`,
`storage_error`, `unsupported_media`, `decode_failed`, …). After `quota_exceeded` the
staging record is dropped and what only it needed is removed, to give the space back;
after other failures the staging record is kept as `failed`, so verified assets are
reused by the next attempt.

If the server answers 404 to the media URL request or to a media download, the player
asks for the manifest straight away and, if a newer publication exists, moves to it
without backoff.

The renderer reads `activeVersion` at every item boundary. A video is never cut short
by an activation. A still image's hold is ended early when a new version is activated,
so a long image duration does not delay the switch; the switch is still a clean cut from
one whole item to another.

**Garbage collection** deletes a cached asset only when it is referenced by neither the
active version nor the staging version and is not on screen or being prepared. It runs
after a successful activation and again when the renderer has switched versions. If the
state cannot be read, nothing is deleted.

### Clock and time rules (manifest v2)

Since `player-web/0.2.0` the player accepts manifest v1 and v2 (`docs/player-protocol-v1.md`
§5). A stored v1 record still loads after the upgrade.

The clock used for time rules is `Date.now()` plus an offset: `serverTime` of each
heartbeat reply minus the local time when it arrived, 0 until the first reply. Round-trip
time is ignored. `core/time-rules.ts` (pure) turns that time into the wall clock of the
manifest's `timeZone` (one `Intl.DateTimeFormat` per zone) and decides which items may play:

- v1: every item.
- Outside working hours: none. The stage goes black, no slate is shown, and the heartbeat
  reports `idle` with no active publication (the portal shows "Standing by").
- Otherwise the items whose availability window holds the local time (from inclusive,
  until exclusive).
- Fail open: when the corrected clock is more than 5 minutes before the publication's
  `createdAt`, or the browser does not know the zone, every item plays.

The rules are checked at item boundaries, so an item can run past an edge by its own
length; with nothing playable the loop looks again every `idleRecheckMs`. Diagnostics show
"Time zone", "Local time there", "Clock offset" and "Rotation".

The same corrected clock drives the Clock, Date and Countdown apps (manifest v3). The
offset is kept only in memory: while the page runs offline the last offset is used, and
after a reload without network the device clock is used until the first heartbeat reply.

### Renderer

The stage is the window, black. The publication canvas is scaled to fit and centred
(`canvasToViewport` from `@tinnox/domain`); the content rectangle, when the manifest has
one, is positioned inside it and content is clipped to it. Each item is an `<img>` or
`<video>` filling the content rectangle with `object-fit: contain` or `cover`.

Two layers give a cut with no black frame: the next item is built hidden on top, shown
once it can be displayed (image decoded, or video at `canplay` and `play()` resolved),
and only then is the previous layer removed. Removing a layer revokes its object URL,
unloads its video and detaches its element. The loop keeps one position and one failure
counter and nothing else.

- Images are held for `durationMs`.
- Videos are `muted` and `playsInline`, play once, and advance on `ended`. A watchdog of
  `durationMs × 1.25 + 5 s` skips a video that has not ended by then and reports
  `playback_error`.
- A one-item playlist repeats.
- Shuffle (v2): each round plays every item once in a new Fisher-Yates order; a new round
  never starts with the item that just ended when another item can play.
  `activeItemIndex` stays the index into `assets`.
- Fade (v2, `transition: fade`): only from one image to the next image, 500 ms
  (`FADE_MS`, matching `styles.css`), started when the new layer is revealed. The old
  layer stays in use (so its asset is not collected) until the fade ends or the next item
  starts; the player asks for garbage collection again after `FADE_MS` when the fade
  crossed into a new publication. The first item and anything with a video cut. With
  `prefers-reduced-motion: reduce` there is no animation.
- Rotation (v2): 90 and 270 swap the viewport's width and height, and the canvas is
  turned with a CSS transform (`stageTransform` from `@tinnox/domain`). The canvas keeps
  its size. Pairing and slate screens are not rotated.
- Apps (v3, since `player-web/0.3.0`): `renderApp` from `@tinnox/app-render` (the code
  the portal preview uses) draws the app into a layer marked `data-kind="app"` and
  `data-app-type`. Before mounting, the presenter lays out and shows the canvas, because
  the renderer sizes itself from its box and a hidden canvas has none; if the app then
  fails, the previous geometry is restored. The layer is revealed after the first fit,
  within 15 s, or the item fails with `playback_error` "app could not be drawn". An app is
  held for `durationMs` like an image, always cuts, and needs no download; a publication
  of apps only activates without calling `/player/media-urls`. Times use the manifest's
  `timeZone` (the device zone when the browser does not know it). With
  `prefers-reduced-motion: reduce`, read when the app is drawn, a ticker stands still. The
  renderer uses `textContent`, CSSOM and the Web Animations API only, and fetches nothing.
- An item that cannot be shown (missing from the cache, decode failure, autoplay blocked,
  media error during playback) is reported and skipped after a 500 ms pause.
- If every playable item of the publication fails in a row (items hidden by a window do
  not count), the stage is cleared, the phase
  becomes `faulted`, the heartbeat says `error` with no active item, and the loop tries
  again every 30 s. The player never reports `playing` with nothing on screen.

### Heartbeat

Sent every `nextHeartbeatInMs` from the server's last reply (15 s before the first
reply), ±10 %, and within about 2 s of a change of phase, publication on screen, staging
phase or connectivity. It carries: `seq`, the downloaded publication (the stored active
version), the publication and item index on screen, `playerState`, staging progress, the
error list (newest first, bounded by the contract), the build identifier, the
`storagePersisted` flag and `navigator.onLine`.

`seq` is `max(last stored + 1, current time in ms)`, written to IndexedDB in the same
transaction that reads it, so it increases across reloads and when the clock steps back.

Nothing is queued. While the server is unreachable, reports are not sent (backoff 5 s to
60 s, and at least a 429 `Retry-After`) and the next one that gets through describes the
state at that moment. A failed send is shown in diagnostics; it is not added to the
reported error list.

The heartbeat contract (`HeartbeatV1Schema`) is strict and has no field for the storage
estimate, so usage and quota are shown in diagnostics only.

### Revocation

Any `401` on the manifest, media-URL or heartbeat call means the server no longer
accepts the device token. A rejected media URL alone does not: the player asks for new
URLs, and that request is what answers 401 when the device is revoked.

On 401 the player:

1. stops the sync, heartbeat and playback loops and makes no further API calls;
2. clears the screen and shows "This player was unregistered" with a reset button;
3. rewrites the stored registration without the token and with `revokedAt`, and deletes
   `activeVersion`, `stagingVersion` and the pairing record, in one transaction;
4. deletes every media cache of this origin.

A reload stays on the unregistered screen. Only the reset button leaves it.

**What revocation cannot do.** The player learns of it only from a 401. A revoked player
that is offline, or whose tab is closed or suspended, keeps its cached media and token
and, if it is running, keeps playing the last complete publication. From the moment of
revocation the server gives it no manifest, no media URL and no media, and accepts no
report from it; the cleanup above happens at its first contact afterwards. Until then
anyone with access to the browser profile can read the cached files. Removing content
from a device that will not come back online needs physical access (local reset, or
clearing the site's data in the browser).

### Local reset

Available in the diagnostics panel (two clicks: arm, then confirm) and on the
unregistered screen. It:

1. stops all loops and clears the screen;
2. if registered, calls `DELETE /player/registration` once (3 s limit) so the server
   revokes the credential. If the server cannot be reached the reset continues; the
   credential then stays valid on the server until an operator revokes the player, but no
   copy of it remains in this browser;
3. deletes every `tinnox-media-*` cache, empties and then deletes the `tinnox-player`
   database (4 s limit in total);
4. reloads the page, which starts unpaired and requests a new code.

It deliberately leaves the service worker and the shell cache: they hold only the
player's own static files and keep the page loadable offline. It touches nothing else on
the origin. A tab in `standby` cannot reset; use the tab that is running the player.

Pairing again, to the same or another organisation, never reuses cached media: caches are
named by organisation and registration, all media caches are deleted before a new
registration is stored, and any that do not belong to the current registration are
deleted at every start.

### Service worker

Registered only in a production build. Hand-written, no library, no imports.

- **Precache:** the files listed by the build (`index.html`, the script, the stylesheet),
  in a cache named after a hash of their contents. Installation is atomic: if one file
  cannot be fetched, the old worker stays.
- **Navigation:** network first with a 4 s limit, then the cached `index.html`. This is
  what makes a reload work offline.
- **Shell files:** cache first.
- **Everything else:** not handled. Requests to another origin (the API, media
  downloads) are never touched, so API responses, signed URLs and the device token never
  pass through the worker or its cache. Only `GET` requests on the shell list are ever
  answered from cache.
- **Media** is not served by the worker. The page reads verified bytes from Cache Storage
  and shows them through object URLs. This keeps the worker out of the playback path, so
  a worker update or failure cannot interrupt content.
- **Updates:** a new worker calls `skipWaiting()` and `clients.claim()`. This is safe for
  a running player because the page has already loaded its single script bundle and
  requests nothing more from the shell. The old shell cache is removed on activation; the
  new files are used from the next load. Media caches are never touched by the worker.

The first visit installs the worker; offline reload works from then on (diagnostics,
"Offline shell").

### One tab at a time

The tab that holds the Web Lock `tinnox-player-leader` runs the player. Other tabs show a
notice and take over when the lock is released (tab closed, crashed or reloaded). Without
the Web Locks API a BroadcastChannel election is used; it is best-effort and has a short
window in which two tabs opened at the same instant could both start. With neither, the
tab runs unguarded. Diagnostics shows which applies.

### Content-Security-Policy

Set by a `<meta>` tag in `index.html`:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:;
media-src 'self' blob:; connect-src 'self' <API origin>; worker-src 'self';
manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
```

No inline script or style. `vite.config.ts` maps every bare `zod` import to
`src/zodJitless.ts`, as the portal does, which sets zod's `jitless` option before any
schema is built: otherwise zod probes `new Function` once (code generation for faster
parsing), and the policy, which has no `'unsafe-eval'`, reports that probe as a
violation. Parsing is the same without it.

A `<meta>` policy cannot set `frame-ancestors`; a production
host should send the policy as a response header and add `frame-ancestors 'none'`.

## What the player assumes about the API

Written against `packages/contracts` and checked by reading `apps/api/src/routes/player.ts`
on 2026-11-14.

- CORS for `/player/*` allows the player origin, the request headers `authorization`,
  `content-type`, `if-none-match` and `range`, and exposes `content-range` and
  `retry-after`. No cookies.
- `POST /player/pairing` → 200 or 201 with `PairingCreateResponse`.
- `GET /player/pairing/:id` with the polling token as bearer → 200 with
  `PairingPollResponse`; 404, 401 or 410 mean the session is gone.
- `GET /player/manifest` → 200 `{ manifest }`, 304, or 204 when nothing is published.
- `POST /player/media-urls` → 200 `MediaUrlsResponse` with absolute URLs on the API
  origin; 404 when the publication is no longer the display's current one.
- `GET /player/media/:assetId?...` is authorised by the signed URL alone (no bearer
  header is sent). 200 or 206 with the bytes; 401, 403 or 410 mean "get new URLs"; 404 is
  final for that asset.
- `POST /player/heartbeat` → 200 `HeartbeatResponse`.
- `DELETE /player/registration` → 204 or 200. Not in `ROUTES`; see the protocol document.
- 401 on any bearer-authenticated call means revoked.
- Redirects are refused on every call.
- A JSON call is abandoned 15 s after it starts if the response, including its body, has
  not finished. The loop then backs off. Shutting the loop down aborts that read as well.

## Tests

`npx vitest run --project unit apps/player-web` runs the unit tests. They use in-memory
fakes for the state store, the asset store, the API and the presenter, plus
`fake-indexeddb` for the real IndexedDB store. Covered:

- the phase table (allowed and refused transitions, heartbeat state per phase);
- backoff and jitter bounds, including waiting out `Retry-After` on 429;
- staging: success path, reuse of cached assets, URL renewal, resume, and a failure
  injected at every step (storage, quota estimate, URLs, missing asset, broken and
  truncated transfer, oversize response, digest mismatch, `QuotaExceededError`, eviction
  before verification, undecodable and unsupported media, failed activation, changed
  registration, revocation, abort), each asserting that the previous version and its
  assets are intact;
- garbage collection never removing active, staging or on-screen assets;
- manifest handling: 304, 204, repeat of the active publication, malformed, unsupported
  version, wrong display, superseded during download;
- playback order, image durations, looping, video end and watchdog, skipping failed
  items, the all-failed case, switching versions only at an item boundary; shuffle (a new
  seeded permutation per round with no repeat across the boundary, also with windows),
  window skips, nothing due (`not_now`), the manifest index under shuffle, and all-failed
  after the playable items only;
- time rules (`core/time-rules.test.ts`, fixed instants in Australia/Melbourne): a
  daylight-saving day, `24:00`, a closed day, a window edge, fail-open on a clock behind
  the publication and on an unknown zone;
- manifest v2 and v3 accepted and version 4 refused in sync; a stored v1 record loads
  from IndexedDB. Test data: `makeManifest` in `core/fakes.test-support.ts` builds v1,
  `makeManifestV2` builds v2 and `makeManifestV3` builds v3;
- apps: the hold time is `durationMs`, apps ignore windows and obey working hours, and a
  publication of apps only activates with no media request;
- heartbeat contents, sequence numbers across reloads, no queue while offline;
- the HTTP client (headers, no credential on other origins, status mapping) and the
  IndexedDB store (atomic activation, registration replacement, revocation).

**Not covered by unit tests,** because they need a real browser: `DomPresenter` (layout,
layer swap, object URL release), the decode probes, `CacheAssetStore`, the Web Locks and
BroadcastChannel guard, the service worker, and `app.ts` (wiring, reset, revocation
cleanup). These belong to the Playwright end-to-end tests in `tests/`. Stable hooks for
them: `html[data-player-phase]`, and `data-testid` values `pairing-code`,
`slate-display-name`, `slate-detail`, `canvas`, `content`, `active-layer` (with `data-kind` and, for an app, `data-app-type`),
`revoked-title`, `reset-player`, `diagnostics`, `diagnostics-reset`.

**Checked once by hand, not by a repository test** (2026-11-14, headless Google Chrome
on macOS, the production build, a throwaway mock of the player API, 1280×720 window):
pairing and reload during pairing; a second tab standing by; image, H.264 video and
image played in order with at most two layers; a corrupt download, an undecodable image,
a non-video file and a malformed manifest each rejected with the previous version still
playing; resume by `Range`; 45 s with the API down while playback continued, then one
report with a higher `seq`; an offline reload; portrait (1080×1920) and strip
(3840×480 with a content rectangle) canvases measured on screen; revocation cleanup;
both reset paths; replacement of an expired code. That run is evidence that these paths
work in one browser on one day. It was not run against the real API, and it is not
repeated by CI until the Playwright tests exist.

No long-running soak has been done. "Can run for days" is a design property (bounded
state, released resources) that has not been measured.

## Browser limits

These are properties of running in a browser. None of them is solved here.

- **Eviction.** The browser may delete IndexedDB and Cache Storage for the origin under
  storage pressure, and some browsers do so after a period without visits. Persistent
  storage is requested, but browsers may refuse, and "granted" still does not survive the
  user clearing site data. After eviction the player finds no registration and shows a
  pairing code; if only media was evicted, items fail with `storage_error`, the player
  reports it, and nothing re-downloads them until a new publication arrives.
- **Private or guest browsing.** Storage is discarded when the window closes, and may be
  unavailable. If IndexedDB cannot be opened the player says so and does not start.
- **Storage quota.** The quota is the browser's decision and varies with free disk space.
  An update that does not fit is refused and the previous version stays. A download is
  assembled in memory before it is hashed and stored (WebCrypto has no streaming
  digest), so one asset briefly needs about twice its size in RAM; the 200 MB upload
  limit can be too much for a small machine.
- **Tab suspension and background throttling.** A hidden or occluded tab has its timers
  throttled, may have video paused, and can be frozen or discarded by the browser to save
  memory. Polling, heartbeats and item timing are then late or stopped, and the portal
  shows the display as stale. The player must be the visible, foreground tab of its
  window. It does not hold a screen wake lock and does not prevent display sleep or the
  screen saver; configure the operating system for that.
- **Autoplay policy.** Videos are muted and inline, which browsers normally allow to
  start without a user gesture. If a browser blocks it anyway, the item is skipped and
  reported as `playback_error`. Audio is out of scope.
- **Full screen.** The page fills the window. Entering browser full-screen or kiosk mode
  is done by whoever sets up the machine (for example `F11`, or starting the browser
  with its kiosk option); the page cannot do it without a user gesture.
- **Codecs.** Whether an H.264 MP4 decodes, and how smoothly, depends on the browser,
  operating system and hardware. The probe checks that the file reaches `canplay`; it
  does not measure dropped frames or sustained performance.
- **Restart of the browser, the operating system or the machine.** Nothing reopens the
  player. There is no boot recovery, no watchdog outside the page and no crash restart.
  When the page is opened again it resumes from storage, including offline, if the
  browser kept the storage.
- **Updates of the browser itself** can restart it or change behaviour without notice.
- **Clock.** Pairing countdown, URL expiry margins and `sentAt` use the local clock. The
  server uses its own receive time for staleness; a wrong local clock mainly causes
  unnecessary URL renewals.
- **Credential exposure.** The device token is in IndexedDB in clear, readable by anyone
  with access to the browser profile or its developer tools.

A dedicated player (the later HDMI route in `docs/prototype-m0.md` section 8) is where
start on boot, process supervision, guaranteed storage and display power control belong.
Nothing in this app should be read as providing them.
