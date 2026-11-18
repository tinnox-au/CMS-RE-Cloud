# Layouts review, round 4

Date: 18 November 2026, Australia/Melbourne (UTC+11).
Status: documented review only. The reviewer worked read-only; no product code was changed, and this folder is a record of the outcome, not a patch.

| Item | Value |
|---|---|
| Repository | `tinnox-au/tinnox-cms` |
| Baseline | `40fc5f481c2af1f197ae74bb3d416ea4999c324c` (`40fc5f4`), tip of `main` |
| Change under review | Layouts (stage B, slice 4), [PR #25](https://github.com/tinnox-au/tinnox-cms/pull/25), merge `41d8ebb` (`git diff 41d8ebb^1 41d8ebb`) |
| Reviewer | Cursor cloud agent, grok-4.7, reasoning effort xhigh, 500k context ([agent](https://cursor.com/agents/bc-52c0ade1-6109-5c49-a54e-419b649328ba)) |
| Finding IDs | `LYX-01` to `LYX-05` |
| Runtime | Full local environment (Node 22, PostgreSQL 17.12, Keycloak 26.8, media worker, Playwright Chromium); see "Environment and test runs" below |

## Reviewer report

No Critical or High findings. Layouts keeps tenant isolation, same-transaction audit, and a v5 manifest that an older player refuses while keeping its last content. One Medium player handover bug and four Lows.

| ID | Severity | Area | Title | Test exists |
|---|---|---|---|---|
| LYX-01 | Medium | Player | A band still on the previous canvas is placed in the new canvas's scale | No |
| LYX-02 | Low | Player | A same-publication repair wakes only the main zone | No |
| LYX-03 | Low | Database / publish | The database accepts a layout the manifest builder then throws on | No (API schema tests exist) |
| LYX-04 | Low | Portal | The delete dialog keys blocking screens by name | No |
| LYX-05 | Low | Tests | Layouts portal e2e clicks Cancel after the push has already settled | Yes, and it failed |

## LYX-01 — A band still on the previous canvas is placed in the new canvas's scale

**Severity: Medium.**

When the main zone adopts a publication whose canvas size differs, `DomStage.#layout` sizes the canvas from that new view and multiplies every showing zone's rectangle by that scale. A band that is still inside a video keeps the previous publication's pixel rectangle until that video ends (`zones.ts` wakes the loop, and a video is not cut). Those old pixels are then drawn on the new canvas.

`apps/player-web/src/ui/stage.ts:89-111` takes the scale from `#frame` (the main zone once it has placed) and applies it to every entry in `#views`. `apps/player-web/src/ui/stage.ts:50-55` updates `#frame` from zone 0. `apps/player-web/src/core/zones.ts:65-70` leaves a kept band on its current item. The protocol at `docs/player-protocol-v1.md:269` already allows old and new geometry to share the screen for one video when both rectangles are in the same canvas. This case is the one where they are not.

**Failure.** A 1920×1080 screen is playing a layout. The band is in a video whose box is `y = 918`, `height = 162`, `width = 1920`. The operator changes the screen to 1080×1920 and pushes. When the main zone takes the new publication, the band's box is positioned with the old 1920-wide rectangle inside the new canvas until that video ends. The band is clipped and can cover the new main zone. A still or an app in the band ends on `wake()` and does not show this. `e2e/13-layouts-player.spec.ts` uses a ticker, so it passed without covering this path. Unverified pending a browser run with a video in the band. The arithmetic follows from the code.

**Fix.** If a showing zone's `view.canvas` size differs from the frame canvas, drop that zone until it adopts the new publication (or keep the previous frame until every showing zone has adopted). Add a player test: video in the band, push a different canvas size, and assert the band's box stays inside the new canvas.

## LYX-02 — A same-publication repair wakes only the main zone

**Severity: Low.**

`onActivated` calls `playback.wake()` only (`apps/player-web/src/app.ts:490-492`). `ZoneSet.adopt` returns immediately when the publication id is unchanged (`apps/player-web/src/core/zones.ts:54`), so it does not wake bands. A band whose items have all failed waits `allFailedRetryMs` (30 seconds) before it tries again (`apps/player-web/src/core/playback.ts:200` and `347-352`).

**Failure.** The browser evicts a band's media while the publication id stays the same. The band goes black and enters the 30-second retry. Sync repairs the cache and activates that same publication. The main zone is woken at once. The band stays black until its own timer fires. No test covers this.

**Fix.** On activation, wake every zone loop, including when `adopt` sees the same publication id.

## LYX-03 — The database accepts a layout the manifest builder then throws on

**Severity: Low.**

`layout_zone` checks position `0..3` and that each rectangle lies inside the 10 000 basis-point square (`db/migrations/0011_stage_b_layouts.sql:47-51`). It does not require two to four zones, position 0, or non-overlapping rectangles. `planLayoutPublication` only rejects a zone under 16 px (`packages/domain/src/layout.ts:30-41`). `buildManifest` then throws if the result is not a valid version 5 document (`packages/domain/src/manifest.ts:156-162`). An uncaught throw becomes HTTP 500 (`apps/api/src/errors.ts:179-180`).

**Runtime (rolled back).** As `tinnox_app` with `app.org_id` set, an insert of two overlapping zones succeeded, and an insert of a single zone succeeded. A script through `planLayout` then `buildManifest` threw `zones.1.rect: zones must not overlap` and `zones: Too small: expected array to have >=2 items`. The HTTP API does not create these rows: `LayoutInputSchema` requires 2–4 non-overlapping zones, and `layouts.integration.test.ts` covers that refusal. There is no test that a row planted as `tinnox_app` is answered 422.

**Fix.** Have `planLayoutPublication` return `ok: false` for a zone count outside 2–4 and for overlapping basis-point rectangles, so the push is a 422 with an audit row. A matching check in the database would stop the row existing at all.

## LYX-04 — The delete dialog keys blocking screens by name

**Severity: Low.**

`DeleteLayoutDialog.tsx:84-86` renders each blocking screen as `<li key={name}>`. `display.name` is not unique (`db/migrations/0001_schema.sql`, `display` has no name uniqueness). React collapses duplicate keys among siblings.

**Failure.** Two screens named "Lobby" both have the layout assigned. The API returns both names (up to five). The dialog shows one "Lobby". The operator clears one screen and the delete is refused again. The same pattern is in `DeleteScheduleDialog.tsx`. Unverified pending a render with two identical names. The integration test uses "Alpha screen" and "zulu screen", so it does not catch this.

**Fix.** Key the list by a stable index, and show a count when names repeat.

## LYX-05 — The layouts portal e2e clicks Cancel after the push has settled

**Severity: Low.**

After a successful push, `PushDialog` sets `done` and renders `push-done` ("Done") instead of `push-cancel` (`apps/portal/src/features/push/PushDialog.tsx:235-272`). `tests/e2e/12-layouts-portal.spec.ts:274-278` has already asserted "Up to date", then clicks `push-cancel`.

**Runtime.** That click timed out at 15 seconds. The file is `serial`, so these five tests did not run: delete refused while assigned, playlist replacing the layout, phone width, delete from the editor, and the layouts CSP check. The player spec (`13-layouts-player.spec.ts`) ran and passed, including version 5 boxes, reduced motion, a band-height change, and the return to version 1.

**Fix.** Click `push-done` after the push has been answered, and re-run the file.

## Checked and found fine

**Database.** `0011_stage_b_layouts.sql` is the only migration in the layouts merge. `0001`–`0010` are untouched, and `0011` is unchanged after the merge. `0012_pairing_upgrade_cleanup.sql` runs after it and does not alter layout tables. Both applied on PostgreSQL 17.12. `layout` and `layout_zone` have forced row-level security and `tenant_isolation` on `org_id` for both `USING` and `WITH CHECK`. Catalog: 22 `tenant_isolation` policies and 4 locked-down tables (26 forced-RLS tables excluding `schema_migrations`), which matches control-matrix B4's "22 tenant tables". Grants for `tinnox_app`: `SELECT`/`INSERT`/`DELETE` on both tables, `UPDATE` of `layout.name` and `layout.description` only, no `UPDATE` on `layout_zone`, and `UPDATE` of `display.assigned_layout_id`. Composite foreign keys tie zones to `(layout_id, org_id)` with `ON DELETE CASCADE`, and to `(playlist_id, org_id)`. Deleting an assigned layout is refused by `display_assigned_layout_fk`. Soft-delete and hard-delete of a playlist used by a zone are refused (`playlist_delete_guard`, `layout_zone_playlist_fk`). The zone trigger takes `FOR SHARE` on the playlist. `playlist_delete_guard` was replaced in place with `search_path = pg_catalog, pg_temp`. No new `sec.*` function. Every `sec` function remains security definer, owned by `tinnox_definer`, with that search path. `has_function_privilege(tinnox_app, layout_zone_playlist_guard, EXECUTE)` is false, and an insert of a zone on a deleted playlist still raised `a deleted playlist cannot be used in a layout` from that function, then rolled back. Trigger execution does not depend on that grant. The same shape is used for the schedule guard. The manifest check now allows schema versions `'1'` through `'5'` and is a superset of the previous check. It takes `ACCESS EXCLUSIVE` on `publication` until commit, which the migration comment and the slice's own as-built table already record. `STAGE_B_CONSTRAINTS.displayAssignedLayout` names `display_assigned_layout_fk`.

**API.** Organisation id comes from the session inside `withOrg`. Layout GET/PUT/DELETE of another organisation's id is 404. A playlist id from another organisation inside a layout body is 400 `validation_failed` with "The playlist was not found.", the same body as an unknown or deleted id (`cross-org.test.ts` asserts this). That does not reveal whether the other organisation has that playlist. Create, replace, and delete write `layout.create`, `layout.update`, and `layout.delete` with `auditScoped` in the same transaction. The detail is ids and counts, not names or URLs. A PUT locks the layout `FOR UPDATE` before replacing zones. A push locks it `FOR SHARE` before reading zones, so an edit is published whole. The integration test "holds the layout, so its zones cannot change between reading the row and the zones" passed. Assigning a layout takes `FOR SHARE` on it and clears a playlist or schedule. `display_one_assignment` still allows only one of the three. Publishing a playlist clears `assigned_layout_id` in the same transaction and will not replay a layout publication under that idempotency key.

**Contracts and domain.** Zone geometry is basis points, origin top-left, minimum side 1. `checkLayoutZones` rejects out-of-bounds and overlap. Touching is allowed. `zoneRect` rounds edges. A sample of 64 876 shared-edge pairs across canvas sizes from 16 to 16 384 produced no pixel overlap, no negative size, and no rectangle outside the area. A zone under 16 px blocks that screen only (`zone_too_small`). Version 5 is written only when `draft.zones` is set. Versions 1–4 stay a single full-frame run via `manifestZones`. A player that does not know version 5 gets `manifest_unsupported_version` and does not replace the active manifest (`apps/player-web/src/core/sync.ts:94-114`). The same path is tested with schema version 6. `e2e/13` returned a layout screen to a version 1 manifest and removed the band.

**Player.** Each zone is its own `PlaybackLoop` and presenter. Removing a zone aborts its signal, then `remove()` disposes layers, revokes object URLs, and calls `releaseVideo`. One zone's `item_failed` is reported and does not change the machine phase. A band whose items all fail clears only that box and retries after 30 seconds. The main zone's fault slate is specified to speak for the screen (`docs/player-protocol-v1.md:268`); `#screen` is stacked above `#stage`, so a broken main zone covers a healthy band. That matches the spec. Media for every zone is downloaded once per SHA-256 before activation. `inUse()` keeps the band's current item and the adopted views' media, so garbage collection does not drop a band's files during the handover. That fix is already in the tree from the slice's own review.

**Portal.** Create and edit use labelled fields, a fieldset per zone, keyboard submit, an error summary that focuses the first invalid control, and `useLeaveGuard` while dirty or saving. The preview uses `zoneRect`, so its pixel sizes match a push. A zone under 16 px is named in text, not by colour alone. Reduced motion disables the player fade (`styles.css`). The missing focus ring on the error summary in forced-colours mode is the same pattern as the schedule and app editors and is already recorded in `docs/portal-v2/stage-b.md` (as-built, "Recorded, not changed"). Layout names are not written into the manifest.

**Docs.** `stage-b.md` slice 4, `player-protocol-v1.md` section 5 and 9, `threat-model.md` section 13, and control-matrix B4 match the code that shipped, including the recorded residuals (main-zone heartbeat only, audit detail naming only the main playlist, locks held until commit). Storage is the local media directory plus the media-worker container. This repo has no MinIO service.

## Environment and test runs

Pinned tree: `40fc5f481c2af1f197ae74bb3d416ea4999c324c` (detached). Read-only. No commit, push, or pull request.

| Tool | Version |
|---|---|
| Node | 22.23.4 |
| npm | 10.9.9 |
| PostgreSQL | 17.12 (image `postgres:17.12-alpine3.24`) |
| Keycloak | 26.8.2 |
| Docker Engine | 29.1.3 |
| Docker Compose | 2.40.3 |
| Host ffmpeg | 6.1.1 (not used by the worker) |
| Worker ffmpeg | Alpine `ffmpeg=8.1.3-r0` inside `tinnox-cms-media-worker:m0` |
| Playwright Chromium | 159.0.8154.6 (build 1255) |

Docker was not installed. `docker.io` and `docker-compose-v2` were installed with apt. `policy-rc.d` blocked the service unit, so `dockerd` was started directly. The `ubuntu` user was added to the `docker` group. Commands that talk to the socket were run with `sg docker`.

Roles `tinnox_app`, `tinnox_migrator`, and `tinnox_definer` were created by `infra/postgres/init/01-roles.sh` on first database init. `npm run db:migrate` applied `0001` through `0012`, including `0011_stage_b_layouts.sql` and `0012_pairing_upgrade_cleanup.sql`. `npm run db:seed -- --second-org` created both organisations.

| Command | Result |
|---|---|
| `npm ci --no-audit --no-fund` | exit 0 |
| `sudo apt-get install -y docker.io docker-compose-v2` | exit 0 |
| `npm run setup -- --quiet` | exit 0 |
| `sg docker -c "npm run infra:up"` | exit 0. Postgres, Keycloak, and media-worker became healthy |
| `npm run db:migrate` | exit 0. Applied all 12 migrations |
| `npm run db:seed -- --second-org` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 134. V8 heap limit about 2 GB while the machine was busy (`FATAL ERROR: Reached heap limit`) |
| `NODE_OPTIONS=--max-old-space-size=4096 npm run lint` | exit 0 |
| `npm test` (unit) | exit 0. 81 files, 1765 tests passed |
| `npm run test:integration` | exit 1. 31 files passed. `backup-restore-check.test.ts` and `media-worker.test.ts` failed in `beforeAll`: the test process could not open the Docker socket, and fixtures had not been generated. 363 tests passed, 23 skipped inside those two files |
| `npm run fixtures` (no docker group) | exit 1. `permission denied` on the Docker socket while encoding `h264.mp4` |
| `sg docker -c "npm run fixtures"` | exit 0 |
| `sg docker -c "npm run test:integration -- tests/integration/backup-restore-check.test.ts tests/integration/media-worker.test.ts"` | exit 0. 2 files, 23 tests passed |
| `npx playwright install chromium` | exit 0 |
| `sg docker -c "npm run e2e -w @tinnox/tests -- 12-layouts-portal.spec.ts 13-layouts-player.spec.ts"` | exit 1. 12 passed, 1 failed (LYX-05), 5 did not run |

Together, the integration project is 33 files and 386 tests, all passing once Docker is reachable. That includes `packages/db` (RLS and `stage-b-layouts`), `apps/api` (layouts, push, player), and `tests/integration` (cross-org and session CSRF). The full end-to-end suite beyond specs 12 and 13 was not run. `npm run format:check` was not run.

## Next steps

1. Fix the band handover when the canvas size changes (LYX-01) and cover it with a video in the secondary zone.
2. Wake every zone loop when a publication is activated, including a repair of the same id (LYX-02).
3. Make `planLayoutPublication` reject a bad zone set with a 422 before `buildManifest` can throw (LYX-03).
4. Change the e2e close click to `push-done` and re-run `12-layouts-portal.spec.ts` so the five skipped cases actually execute (LYX-05).
