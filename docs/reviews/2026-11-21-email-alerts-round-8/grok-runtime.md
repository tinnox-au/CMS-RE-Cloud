The branch head is `622958a`. Alert delivery, roles, and the 0013 to 0014 upgrade behave as DEC-37 describes. Two documented timing limits are real and have no test that locks them, and one end-to-end failure is a text-layout check this change does not touch.

## Findings

| ID | Severity | Area | Title | File:line | Reproduced | Test exists |
|---|---|---|---|---|---|---|
| EAU-01 | info | alerts [ponytail] | A delay can come due a few minutes after closing, while the screen is outside working hours | `packages/domain/src/delivery-state.ts:153` | yes | no |
| EAU-02 | info | alerts [ponytail] | A 48-hour delay on a one-hour day never fires, and widening the 14-day scan does not fail the suite | `packages/domain/src/delivery-state.ts:142` | yes | no |
| EAU-03 | info | e2e | Text-app overflow failure on this host; the alert change does not touch that renderer | `tests/e2e/07-apps-player.spec.ts:379` | yes | yes (the test itself fails) |

### EAU-01

`offlineDue` samples the wall clock once per UTC 5-minute step. Hours that do not end on a 5-minute mark can count closed time as open.

Reproduction, calling the shipped function:

- Zone `Australia/Melbourne`, every day `08:00`–`18:02`, delay 30 minutes.
- Last report `2026-11-17T06:34:00Z` (17:34 local), now `2026-11-17T07:04:00Z` (18:04 local).
- Time actually inside hours is 28 minutes, until 18:02. The function returns `true`.

The shortcut comment on line 153 already states the 5-minute band. The unit cases use hours that start and end on the hour, so they stay green if this band changes. Suggested fix: one unit case with a close at `18:02`, and per-minute sampling if a customer needs the close to be exact.

### EAU-02

The scan stops at 14 days (`SCAN_MS`). A 48-hour delay that needs more than 14 days of working hours never fires, including a screen open one hour a day. The Alerts tab offers 48 hours, and working hours can be one hour.

Reproduction:

- Every day `12:00`–`13:00`, delay 2880 minutes, last report 60 days before `2026-11-17T01:30:00Z`.
- `offlineDue` returns `false`. Sixty one-hour days is more than 48 hours of working time.

Replacing `14` with `60` in `SCAN_MS` and running `packages/domain/src/delivery-state.test.ts` still passed 29 of 29. The ceiling is the documented shortcut on line 154, and nothing locks it. Suggested fix: a unit case that expects `false` for that 60-day span, and either raise the scan or say on the Alerts tab when the chosen delay cannot be reached inside 14 days.

### EAU-03

Full end-to-end: 147 passed, 1 failed, 2 did not run (17.0 minutes). The failure is `on a 1376x774 canvas the Text app fits without overflow`. A line is reported clipped (`left: 29, top: 33.39, right: 1251, bottom: 315.52`). A solo retry failed with the same rectangle. The file is serial, so the ticker-rotation and CSP tests after it did not run.

The diff does not change `packages/app-render` or this spec. The player edit moves `localWallClock` into contracts. The text app still uses `system-ui` at `packages/app-render/src/render.ts:33`. This is a host font-metric failure, not an alert regression. Could not determine whether it fails on the macOS or CI font set. Suggested fix: none in this pull request.

## Suite results

| Suite | Result | Caused by this PR |
|---|---|---|
| `npm run typecheck` | pass | — |
| `npm run lint` | pass, 0 warnings | — |
| `npm run format:check` | pass | — |
| `npm test` (unit) | 92 files, 1957 passed | — |
| `npm run test:component` | 18 files, 79 passed | — |
| `npm run test:integration`, before fixtures | 40 files passed, 506 tests passed, 17 skipped; `backup-restore-check.test.ts` threw because sample media were missing | no. That file is unchanged. The README runs `npm run fixtures` first |
| `npm run test:integration`, after `npm run fixtures` | 41 files, 523 passed | — |
| `npm run test:e2e` | 147 passed, 1 failed, 2 did not run | the failure is EAU-03. `e2e/15-alerts.spec.ts` passed 3 of 3. Accessibility, including alert addresses, the add dialog, and the confirm page, passed |

Mutation, then restored so the tree matches `622958a`:

- `offlineDue` forced to `return false`: 8 failed, 21 passed in `delivery-state.test.ts`. The failures are the cases that expect an alert. Two `offlineDue` cases only expect `false`, so they stayed green.
- `SCAN_MS` widened from 14 days to 60: 29 passed. That is EAU-02.
- Offline subject changed to `BROKEN …`: `alerts.test.ts` 1 failed, 4 passed. The subject assertion failed. The test that only forbids the words “online” and “offline” stayed green.

## Environment

- Node v22.23.4, npm 10.9.9 (`npm ci` from the lockfile; the `packageManager` field says npm 11.21.2).
- Docker 29.1.3, Compose 2.40.3. Docker was not installed in this environment; it was installed so `npm run infra:up` could run.
- PostgreSQL 17.12, Keycloak 26.8.2, Mailpit v1.33.0.
- Setup was `npm ci`, `npm run setup`, `npm run infra:up`, `npm run db:migrate`, `npm run db:seed -- --second-org`.

## Verified

**Upgrade.** On a database migrated only through 0013, with two organisations, memberships, displays, player registrations, heartbeats, and audit rows, `0014_display_alerts.sql` applied once in about 40 ms. All six displays became 30 minutes and back-online on. A name containing `<img …>` and a name containing a carriage return and line feed were still stored. Audit and membership counts were unchanged. A second `runMigrations` applied nothing. Running the SQL file again failed with `column "alert_offline_minutes" already exists` inside a transaction that was rolled back. `display_alert` and `alert_recipient` have forced row-level security. Both new `sec` functions are security definer, owned by `tinnox_definer`, with `search_path` pinned. As `tinnox_app` with no organisation set, those tables and `display` returned no rows; inside one organisation, the other organisation’s displays were not visible. Could not determine how long the `ACCESS EXCLUSIVE` lock lasts on a large `display` table.

**Threshold and delivery.** Four players were paired and reached idle, then stopped. With working hours unset, a report 29 minutes old produced no mail (`offline: 0`). At 31 minutes, one mail went to each of the two confirmed addresses and to nobody else (`offline: 1`, `failed: 0`). A second `alerts:once` sent nothing. Holding `pg_advisory_lock` made the next run `skipped: true`. Two concurrent `alerts:once` processes produced one send and one skip. Restarting the API left the count unchanged. Two API processes, ports 4000 and 4001, produced one offline mail per confirmed address. A newer stored report then produced one “Screen reporting again” mail, and the next tick produced none. The media worker does not send these alerts. Could not determine behaviour behind a transaction-mode pooler, or the warning that is logged on every fifth skip in a row.

**Working hours.** A screen limited to a day three days away, silent for 120 minutes, did not alert. Clearing `working_hours` made that same silence alert once.

**Recipients and roles.** Confirmed addresses `confirmed-5x2qp7@example.com` and `admin-added-5x2qp7@example.com` received the mail. A waiting address, an expired address, a removed address, and the other organisation’s confirmed address received no “Screen …” mail. Expired and unknown well-formed tokens both got 404. A reused link showed “This link is not valid any more”, and the fragment was cleared. A fragment of `<img …>` did not create an image. The confirm route returns 204.

API, same organisation versus another organisation’s display and an unknown id:

- Viewer: address list and screen-alert patches are 403 for every id.
- Editor: address list 403; own screen 200; unknown and other-organisation displays 404.
- Admin: list 200 and a real add 201; own screen 200; unknown and other-organisation displays 404.
- Owner: an unknown display and the other organisation’s display are 404.

In the portal, Owner and Admin get Settings → Alerts and an editable Alerts tab. Editor can change the delay and sees “An Admin or Owner chooses who receives them”, with no address link; Settings → Alerts is the forbidden page. Viewer sees the same forbidden page, the delay control is disabled, and there is no Save button. The add-address field is `type="email"`, `spellcheck="false"`, `autocomplete="off"`. New screens are 30 minutes, back-online on, working hours unset. Could not determine the unsaved-changes dialog: the probe stopped on two links named “Screens” before the click. The screen page does include the alerts draft in its leave guard.

There is no separate deactivate action. Removing the Viewer and the Admin returned 200 and ended one session each. The Viewer then got “This sign-in account has no access to TINNOX CMS.” The alert rows were unchanged, including the address the Admin had added. A later recovery send completed with `failed: 0`, so that address still received mail. Membership does not grant or revoke these mails. Removing the address is the opt-out, and that removed address got nothing.

**Content.** The offline message is `text/plain; charset=utf-8` with no HTML part. The screen name `Wall <b>one</b> & "quoted"` is literal in the body and RFC 2047 encoded in the subject. The body names the screen, Melbourne Workshop, TINNOX Internal, “30 minutes”, the screen link, and the “ask an Admin” footer, and does not use “online” or “offline”. The portal heading shows that name as text. The API rejects a display name or an address containing CR/LF, and rejects `Ann <name@example.com>`, all 400. A name written straight into the database as `Foyer` plus CR/LF plus `Bcc: injected-…` did not add a `Bcc` header. The subject became one line with a space, and the body showed the name across two lines as text.

**SMTP down.** With Mailpit stopped, the API loop claimed the episode, logged `display alert e-mail was not sent` with `errorCode: ESOCKET` and the display id, and no address, then `offline: 1`, `failed: 2`. The process stayed up and `/readyz` returned 200. The audit row is `display.offline_alert`, actor `system`, result `success`, detail `{"recipients": 2}`. After Mailpit was started again, the next run was `offline: 0`, `failed: 0`, and Mailpit had no new message. A failed send is not retried. That matches the shortcut in `apps/api/src/alerts.ts`. Could not determine STARTTLS against a real provider such as SES.

**Scope.** What shipped is the DEC-37 list: one list per organisation, confirm-before-send, Editor and up for the screen delay, Admin and up for addresses, 30 minutes and back-online on, and working hours. Per-screen recipients, SMS, HTML mail, and an unsubscribe link were not added. `nodemailer` 10.3.1 is a real SMTP client, not a dependency added for a few lines.
