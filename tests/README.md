# tests

Repository-level tests of TINNOX CMS prototype M0. All of them run against real
services; nothing is mocked except where a file says so in its header.

| Directory | What | Command (from the repository root) |
|---|---|---|
| `integration/` | Integration and security-boundary tests (vitest). Real PostgreSQL as the runtime role, the real API on a real listener, the real media-worker container image. | `npm run test:integration` |
| `e2e/` | Browser end-to-end tests (Playwright, Chromium). Real Keycloak sign-in with TOTP, real API process, production builds of the portal and the player in separate browser contexts. | `npm run test:e2e` |
| `support/` | `dev-identity.ts` (generated development users, TOTP codes), `png.ts` (PNG writer and reader for synthetic images and pixel checks). | |

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
