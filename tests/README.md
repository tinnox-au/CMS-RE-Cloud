# tests

Repository-level tests of TINNOX CMS prototype M0. All of them run against real
services; nothing is mocked except where a file says so in its header.

| Directory | What | Command (from the repository root) |
|---|---|---|
| `integration/` | Integration and security-boundary tests (vitest). Real PostgreSQL as the runtime role, the real API on a real listener, the real media-worker container image. | `npm run test:integration` |
| `e2e/` | Browser end-to-end tests (Playwright, Chromium). Real Keycloak sign-in with TOTP, real API process, production builds of the portal and the player in separate browser contexts. | `npm run test:e2e` |
| `support/` | `dev-identity.ts` (generated development users, TOTP codes), `png.ts` (PNG writer and reader for synthetic images and pixel checks). | |

Stage B slice 2 (built-in apps) added `e2e/07-apps-player.spec.ts` (apps drawn by a
paired player: the site's time zone, item order and index, a finished countdown, a QR
code, a ticker on a strip canvas and on a screen rotated 90°, reduced motion, text fit,
no CSP violation) and `e2e/08-apps-portal.spec.ts` (creating and editing an app through
the portal by keyboard, the contrast warning, adding an app to a playlist and pushing,
deleting an app in use, the still ticker preview, no CSP violation and no web storage).

Stage B slice 4 (layouts) added `e2e/12-layouts-portal.spec.ts` (creating a layout through the
dialog by keyboard; a band with no playlist refused, with the error summary leading to its
field; the band height stepped with the keyboard and the preview's pixel sizes on landscape,
portrait and a small LED shape; assigning the layout on a screen's page and pushing it; the
refusals to delete a layout a screen has and a playlist a layout uses; a playlist replacing the
layout; phone width; no CSP violation and no web storage) and `e2e/13-layouts-player.spec.ts`
(a main zone and a Ticker band on four canvases, rotation and a content rectangle included:
version 5, the zone boxes within 1 px, the ticker size, the reduced-motion wrap, a band-height
change, and back to version 1). `support/operator.ts` gains `bandLayout`, `createLayout`,
`replaceLayout` and `assignLayout`; `support/portal.ts` gains `createLayoutInPortal`,
`saveLayout` and `assignLayoutOnScreenPage`; `support/player.ts` gains `zoneBox`.

Stage B slice 3 (schedules) added `e2e/09-schedules-portal.spec.ts` (creating a schedule
through the dialog by keyboard; an event with no playlist refused, with the error summary
leading to its field; events filled in, reordered and removed with focus kept in the
list; assigning the schedule on a screen's page and pushing it; the refusals to delete a
schedule a screen has and a playlist a schedule uses; a playlist replacing the schedule
on a screen, with the dialog saying so; phone width without sideways scrolling; no CSP
violation and no web storage) and `e2e/10-schedules-player.spec.ts` (a paired player in
Australia/Melbourne: an event that covers every moment plays its playlist from a
version 4 manifest; an event on another weekday leaves the default playlist on screen; a
schedule without events is pushed below version 4; the "Schedule picks" and "Build" rows
of the diagnostics panel; no CSP violation). The crossing of an event edge is unit-tested
only (`apps/player-web/src/core/playback.test.ts`): the player corrects its clock from
the server, so a faked browser clock would not move it. Both files pass in the full suite.

`e2e/11-accessibility.spec.ts` runs axe (`@axe-core/playwright`, WCAG 2.2 A and AA) on
every main portal page and on the schedule editor with errors, the create-schedule and
push dialogs, the screen page's tabs and its Change menu, in light and in dark. It fails
on serious and critical findings only (`e2e/support/a11y.ts`, which first waits for short
entrance animations so a dialog is not measured while it fades in). An automated check
finds a share of what a screen-reader user meets; a listening pass with a real screen
reader is still a manual step.

`integration/` gained the schedule routes in `session-csrf.test.ts` and the schedule
probes in `cross-org.test.ts`; the API's own schedule tests are
`apps/api/test/schedules.integration.test.ts`, and the database's are
`packages/db/test/stage-b-schedules.integration.test.ts`.

`npm run test:integration` also runs `packages/*/test/*.integration.test.ts` and
`apps/api/test/*.integration.test.ts`. It rebuilds the database `tinnox_test` first.

Before either suite: `npm run setup`, `npm run infra:up`, and for E2E also
`npm run db:migrate` and `npm run db:seed -- --second-org`. For E2E the API (4000), the
portal (5173) and the player (5174) must **not** be running: Playwright starts them.

## What is substituted, and where

- `integration/`: operator sessions are created through the same `sec.session_create`
  function the sign-in callback uses, instead of driving Keycloak (the E2E suite does the
  real sign-in). Every file except `media-worker.test.ts` writes worker verdicts into the
  outbox itself; `media-worker.test.ts` runs the real worker container.
- `e2e/`: nothing. Faults are injected with Playwright request interception on the
  player's media downloads (corrupt bytes, a transfer cut after half the file) and with
  the browser context's offline switch.

## E2E run state

`tests/.run/` (gitignored, owner-only) holds the API pid and log, the JSON result file,
the E2E API's media directory (`media/`), the last TOTP time step used and, during a run,
the saved browser state of each test user. Global teardown signs those sessions out (API
and Keycloak) and deletes the state files. Screenshots of key states and
`e2e-measurements.json` (measured outage length and recovery times) go to
`tests/.run/evidence/`, or to the directory named by `E2E_EVIDENCE_DIR` (the validation
record's evidence was produced with `E2E_EVIDENCE_DIR=docs/evidence`). Traces and videos
are off because they would record the sign-in form.

The run uses its own database, `tinnox_e2e_test`, rebuilt from the migrations and the seed
at the start (created once as the PostgreSQL superuser), so the development database gets
no test rows. It still restarts the shared PostgreSQL container once (E2E 13).

Keycloak accepts each one-time code once, so a run that starts within the same 30 seconds
as the previous sign-in of that user waits for the next code.
