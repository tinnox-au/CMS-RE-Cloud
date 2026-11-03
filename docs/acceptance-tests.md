# TINNOX CMS acceptance tests (first release)

Date: 2026-11-03. Status: PROPOSED. These tests define "done" for the first release described in `docs/tinnox-mvp-spec.md`. They are written against TINNOX CMS behaviour, not Yodeck's; where a Yodeck behaviour informed a test it is noted as a reference only.

## 0. Conventions

- **Validation level**: `SIM` = can pass in a desktop browser or the player simulator (Chromium on a workstation, or a container); `HW` = must pass on the real pilot hardware (player plus display or LED controller). A test marked `SIM+HW` must pass at both levels; the HW run is the gate.
- **Test fixtures**: a dedicated test customer ("TEST Customer"), two test sites in different time zones (Sydney and Perth), one portrait kiosk canvas (1080×1920), one custom LED canvas (for example 640×1344), and synthetic media only (generated colour bars, slates with embedded timestamps, a 10-second H.264 clip, a deliberately corrupt file). No customer content is used in tests.
- **State names** used in expectations come from the spec: media `uploaded → processing → ready | failed`; publication `draft → published`; per-display delivery `pending → downloading → downloaded → playing | error`.
- Each test lists: preconditions, steps, expected result, evidence to attach (screenshot, log excerpt, telemetry record).
- Timing numbers in expectations are **release targets** to be confirmed during the pilot, not measured facts.

## 1. Customer isolation and access control

| ID | Title | Level | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| ISO-01 | Cross-customer read is impossible via UI | SIM | Two customers A and B each with media, playlists, sites, displays | Sign in as A's admin; attempt to open B's resources by URL (media id, display id, site id, playlist id) | Every attempt returns "not found" (not "forbidden"); nothing about B's resource is revealed, including existence |
| ISO-02 | Cross-customer read is impossible via API | SIM | Same | Using A's API token, call list and get endpoints with B's ids and with no filter | Lists contain only A's objects; gets return 404; audit log records the attempts |
| ISO-03 | Cross-customer write is impossible | SIM | Same | Using A's token, PATCH/DELETE B's objects; attempt to assign A's playlist to B's display | All rejected with 404; B's objects unchanged (verify by B login) |
| ISO-04 | Media files are not guessable | SIM | A has uploaded media | Copy the signed media URL used by A's player; wait past its expiry; also try to alter the object key | Expired URL fails; altered key fails; a fresh signed URL requires a valid player or user credential |
| ISO-05 | Role enforcement in the customer portal | SIM | Customer roles: Owner, Editor, Viewer | As Viewer attempt upload, playlist edit, schedule change, publish, user invite; as Editor attempt user invite and billing/site changes | Viewer: all writes rejected in UI and API. Editor: content writes allowed, user/site administration rejected |
| ISO-06 | Site scoping of a customer user | SIM | Customer user restricted to Site 1 | Attempt to view or schedule Site 2 displays | Site 2 is invisible; API returns 404 for its ids |
| ISO-07 | TINNOX support access is explicit and audited | SIM | TINNOX operator with support role; customer A | Operator opens "Act as support for customer A" | Access requires a stated reason; it is time-boxed (default 4 hours); the customer's audit log shows operator identity, reason, start, end, and every write; a banner shows the operator is in support mode |
| ISO-08 | Support access cannot be silent | SIM | Same | Operator attempts to disable or bypass logging, or to read another customer while in A's session | Not possible; attempts logged |
| ISO-09 | Customer admin can review support access | SIM | After ISO-07 | Customer Owner opens Audit log filtered to "TINNOX support" | All sessions listed with reasons and actions |
| ISO-10 | Player credentials are per device | SIM+HW | Two registered players | Copy player 1's credential to player 2's storage | Player 2 is rejected (device binding mismatch); event raised in operations console |
| ISO-11 | Deleted customer data is unreachable | SIM | Customer C deleted (soft delete then purge) | Query C's ids; attempt to sign in as C's users; fetch C's old media URLs | All fail; purge job report lists removed objects |

## 2. Provisioning and registration

| ID | Title | Level | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| PRV-01 | Pairing code registration | SIM+HW | Fresh player image booted with network | Player shows a short pairing code; operator enters code in operations console, selects customer, site, canvas profile | Within 30 s the player shows "Registered to <customer> / <site>" and then the customer's default content or a branded idle screen |
| PRV-02 | Pairing code expiry and reuse | SIM | Player showing code | Wait past expiry (target 15 min); enter the expired code; let player regenerate; enter the new one | Expired code rejected with clear message; new code works; old code can never register anything |
| PRV-03 | Pre-provisioned player | SIM+HW | Operator pre-creates a display with a device claim token written to the player image at staging | Boot player at site | Registers automatically without a code; appears under the right customer and site |
| PRV-04 | Move display between sites and customers | SIM | Registered display | In operations console, move display to another site; then to another customer | Content of the previous owner is purged from the player cache (verified by cache manifest); audit entry; new owner's default content downloads |
| PRV-05 | Canvas profile applied | SIM+HW | Display with custom canvas 640×1344 | Assign profile; publish a slate showing a pixel ruler | Player renders exactly 640×1344 logical pixels; on HW the LED controller receives the configured HDMI mode and the ruler aligns at the panel edges |
| PRV-06 | Portrait orientation | SIM+HW | Portrait kiosk physically rotated | Set orientation 90° or 270° in display settings | Content is upright on the physical screen; preview in portal matches |
| PRV-07 | Duplicate registration attempt | SIM | Registered player | Re-run registration on the same device | Console offers "replace" or "cancel"; replace keeps display identity and history |

## 3. Media upload, validation and processing

| ID | Title | Level | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| MED-01 | Supported image upload | SIM | Editor signed in | Upload PNG, JPEG, and a 24-megapixel JPEG | All reach `ready`; large JPEG gets a canvas-sized rendition; thumbnails appear |
| MED-02 | Supported video upload | SIM | | Upload 1080p H.264 MP4 (10 s) | `processing` then `ready`; duration detected (10.0 s); poster frame shown; a player rendition exists at or below the canvas resolution |
| MED-03 | Unsupported media | SIM | | Upload a .docx, a .mov with ProRes, an HEVC 10-bit file, a 0-byte file, a renamed .txt as .mp4 | Each ends in `failed` with a specific reason ("container not supported", "codec not supported on target players", "file is empty", "file content does not match extension"); nothing is assigned to playlists; failed items can be deleted |
| MED-04 | Oversized upload | SIM | Limit configured (target 2 GB) | Upload a file above the limit | Rejected before transfer completes with the limit stated |
| MED-05 | Interrupted upload resumes | SIM | | Start a 500 MB upload; disconnect network at 40%; reconnect | Upload resumes from the last completed chunk; file ends `ready`; checksum matches the original |
| MED-06 | Processing failure is visible | SIM | Force the transcoder to fail (fault injection flag) | Upload a video | `failed` with "processing error, try again"; retry button re-queues; operations console shows the job error |
| MED-07 | Fit, crop and letterbox preview is accurate | SIM | Canvas 640×1344; an image 1920×1080 | Preview with each fit mode | Preview pixel geometry equals player rendering (compare screenshots at identical logical size; tolerance 1 px) |
| MED-08 | Replacing media keeps assignments | SIM | Media used in a playlist | Upload a new version | Playlist references the new version after publish; old version retained until no published version references it |
| MED-09 | Media quota | SIM | Customer quota set | Exceed quota | Upload rejected with usage shown; deleting media frees quota |

## 4. Playlists, layouts and scheduling

| ID | Title | Level | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| PL-01 | Ordering and durations | SIM+HW | Playlist with image (8 s), video (10 s), image (5 s) | Publish; observe one loop | Order and durations honoured within 250 ms per item on SIM; within 500 ms on HW |
| PL-02 | Video duration override | SIM | Video 10 s set to 4 s | Publish | Video cut at 4 s; next item starts |
| PL-03 | Empty playlist | SIM+HW | Playlist with no ready items | Publish | Player shows the customer's fallback (branded idle slate), never a blank or an error dialog |
| PL-04 | Layout with two regions | SIM+HW | Layout: main region plus a ticker region | Publish | Both regions play; ticker text wraps correctly on portrait and custom canvases |
| SCH-01 | Weekly recurrence in site time zone | SIM | Site in Australia/Sydney; schedule "Notices" weekdays 08:30 to 15:30 | Evaluate the schedule for a Tuesday in July and a Tuesday in December | Both resolve to 08:30 local; UTC instants differ by one hour; the player's evaluation matches the server's |
| SCH-02 | Daylight-saving start (October) | SIM+HW | Site in Sydney; schedule 02:00 to 03:00 daily | Set player clock to the first Sunday of October 01:59:30 local; run | At 02:00 local time jumps to 03:00; the 02:00-03:00 event does not run that day (the hour does not exist); no crash; next day runs normally; behaviour documented in UI as "skipped on this date" |
| SCH-03 | Daylight-saving end (April) | SIM+HW | Site in Sydney; schedule 02:30 to 03:30 daily | Set clock to first Sunday of April 02:29 local (first occurrence); run through the repeated hour | Event runs once (first occurrence by default), total 60 minutes, not twice; documented option to run on second occurrence |
| SCH-04 | Non-daylight-saving site unaffected | SIM | Site in Australia/Brisbane | Same dates as SCH-02 and SCH-03 | No change in local behaviour |
| SCH-05 | Lord Howe 30-minute shift | SIM | Site in Australia/Lord_Howe | Evaluate a 02:15 daily event across October and April transitions | Correct 30-minute shift applied; no skipped or doubled event except in the actual gap |
| SCH-06 | Changing a site's time zone | SIM | Site in Sydney with schedules | Change site to Australia/Perth | All schedules keep their wall-clock times in the new zone; a warning lists the affected displays; players re-evaluate after the next sync |
| SCH-07 | Priority and overlap | SIM+HW | Default playlist; a "Promotion" schedule priority 50; an "Emergency" schedule priority 90, overlapping | Publish all | During overlap the higher priority plays exclusively; when it ends the next lower active schedule resumes at its position in the loop |
| SCH-08 | Schedule preview equals player behaviour | SIM | Any schedule set | Use the portal "what plays at <date time>" preview for 10 random instants | Preview answer equals the player's log for the same instants |
| SCH-09 | Retailer multi-state campaign | SIM | Customer with sites in Sydney, Brisbane, Perth; campaign 09:00 to 17:00 local, 1 to 14 December | Publish | Each site starts at its own 09:00 local; Perth starts last in UTC; Brisbane does not shift in daylight saving |
| SCH-10 | School term schedule with exceptions | SIM | Weekly timetable plus a one-off "Pupil-free day" override | Publish | Override replaces the timetable only on that date |

## 5. Publishing and delivery states

| ID | Title | Level | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| PUB-01 | Unpublished changes are visible | SIM | Edit a playlist | Do not publish | Portal shows "unpublished changes" on the playlist and on affected displays; players unaffected |
| PUB-02 | Publish creates a version | SIM | | Publish | A publication version id is created; affected displays go to `pending`; audit entry with user and diff summary |
| PUB-03 | Download progress | SIM+HW | Publish 300 MB of new media to a display | Observe the display's delivery panel | States progress `pending → downloading (n %) → downloaded → playing`; percentage increases monotonically; a timestamp for each transition |
| PUB-04 | Playing confirmation | SIM+HW | After PUB-03 | Wait | `playing` is set only after the player reports the new version is on screen; a screenshot requested afterwards shows the new content |
| PUB-05 | Interrupted download resumes | SIM+HW | Publish 300 MB | Cut the network at roughly 50% for 2 minutes; restore | Download resumes using range requests from the last byte; total bytes transferred is less than 1.1 × file size; state never regresses to `pending` |
| PUB-06 | Corrupt download is detected | SIM | Fault-inject a byte flip in one chunk | Publish | Player's checksum check fails; chunk re-fetched; file ends verified; if repeated failures (3), state `error` with reason, old content keeps playing |
| PUB-07 | Atomic switch-over | SIM+HW | Publish a version with 5 new files | Observe during download | Old version keeps playing until all files are verified; switch happens between items, never mid-item with a blank frame |
| PUB-08 | Offline display at publish time | SIM+HW | Display powered off | Publish; power on after 30 minutes | Display shows `pending (offline since <time>)` during the outage; on reconnect downloads and reports `playing`; nothing is lost |
| PUB-09 | Rollback a publication | SIM | Two published versions | Choose "republish previous version" | Players switch back; cache already holds files so switch is immediate; audit entry |
| PUB-10 | Storage full on player | SIM+HW | Player cache near capacity | Publish more than free space | Player evicts files not referenced by the current or pending version first; if still insufficient, reports `error: storage` with required and free bytes; old content keeps playing |

## 6. Offline playback, outages, reboot recovery

| ID | Title | Level | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| OFF-01 | Internet outage during playback | SIM+HW | Display `playing` | Disconnect WAN for 24 hours (SIM: simulated clock), reconnect | Playback continues uninterrupted; schedules continue to evaluate locally including a daylight-saving transition if one occurs; on reconnect the display reports `offline since / online at`; queued telemetry (playback log, errors) uploads |
| OFF-02 | Outage spanning a scheduled change | SIM+HW | Schedule change at 12:00; outage 11:00 to 13:00 | Observe | Change happens at 12:00 from local data; nothing waits for the network |
| OFF-03 | Power loss and reboot | HW | Display `playing` | Remove power mid-video; restore | Player boots to playback without user interaction within the target (90 s on the pilot hardware); file system intact (read-only root or journaled cache); resumes correct schedule position for the current time; reports a "boot" event with reason "power loss" |
| OFF-04 | Repeated power cycling | HW | | 20 power cycles at random intervals (5 to 120 s) | No boot into recovery or maintenance mode; cache integrity check passes each time |
| OFF-05 | Boot without network | HW | Player with cached content; network cable removed | Power on | Plays cached content from the schedule for the current local time (using RTC or last-known time plus monotonic clock); shows no network error overlay to the public, only a small status indicator visible to staff; when network returns, time is corrected by NTP and the schedule re-evaluated |
| OFF-06 | Boot with wrong clock | SIM+HW | Clock set to 2001-01-01 (no RTC) | Power on without network, then with network | Before sync the player uses the last-known-good time persisted at the last shutdown rather than 2001; after NTP sync it corrects and logs the drift; schedules never evaluate against an obviously wrong clock when a better estimate exists |
| OFF-07 | Captive portal or DNS failure | SIM+HW | Network present but DNS or captive portal blocks | Observe | Display reports `online: no (reason: DNS or captive portal)` in diagnostics once reachable; playback continues |
| OFF-08 | Watchdog recovery | SIM+HW | Fault-inject a frozen renderer | | Supervisor restarts the renderer within 60 s; event logged; after 3 restarts in 10 minutes the player reboots once and raises an alert |

## 7. Software updates and rollback

| ID | Title | Level | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| UPD-01 | Staged rollout | SIM+HW | New player version in channel "pilot" | Assign one display to "pilot" | Only that display updates; others untouched; update window respected (default 02:00 to 05:00 local) |
| UPD-02 | Update does not interrupt playback | SIM+HW | | Update during the window | Download and install happen in the background; restart happens between playlist items or within the window; total black time under 30 s on HW |
| UPD-03 | Failed update rolls back | SIM+HW | Fault-inject a broken package (bad signature, truncated, crash on start) | Push update | Signature failure: rejected before install. Truncation: checksum failure, retry later. Crash on start: health check fails within 2 minutes and the previous version is restored automatically; display reports `update failed, rolled back to <version>`; alert raised |
| UPD-04 | Power loss during update | HW | | Cut power mid-install | Player boots either the old or the new version, never a half-installed one (A/B or atomic swap); state reported |
| UPD-05 | Server-side version pinning | SIM | | Pin a display to a version | Display does not move off the pinned version even when the channel advances |
| UPD-06 | Content format compatibility after update | SIM | Previously published content | Update player | All cached content still plays; no re-download required unless the manifest format changed, in which case a migration is logged |

## 8. Monitoring, diagnostics and support

| ID | Title | Level | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| MON-01 | Heartbeat and online state | SIM+HW | Registered display | Observe for 1 hour | Heartbeats at the configured interval (target 60 s); display marked offline after 3 missed heartbeats; marked online on the next heartbeat; both transitions timestamped |
| MON-02 | Screenshot on demand | SIM+HW | Display `playing` | Operator requests screenshot | PNG of the rendered canvas arrives within 15 s; stored with timestamp; respects canvas dimensions (640×1344 for the LED canvas) |
| MON-03 | Diagnostics bundle | SIM+HW | | Operator requests diagnostics | Bundle includes: player version, uptime, last boot reason, CPU and temperature (HW), free storage, cache manifest with per-file state, network details (interface, IP, gateway reachability, DNS result, CMS reachability, NTP state), last 200 log lines, current schedule evaluation and next change time |
| MON-04 | "Display stopped updating" triage path | SIM+HW | Simulate each cause: DNS failure, expired player credential, full storage, clock skew, publish never done, display assigned to wrong site | Operator follows the console's triage panel | Each cause is identified correctly from telemetry without a site visit; remedy is suggested; remote restart available for the cases it fixes |
| MON-05 | Remote restart of player app and device | SIM+HW | | Operator issues restart | Confirmation required; action audited; player restarts and reports a boot event with reason "remote restart" |
| MON-06 | Playback log (proof of play) | SIM+HW | Playlist playing | Run for 1 hour | Log records each item start with media id, version id, duration; counts match expected loop count within 1%; log uploads on reconnect after an outage |
| MON-07 | Alerts | SIM | | Display offline more than 15 minutes; update failed; storage below 10% | Customer and TINNOX receive alerts per their settings; alert resolves automatically when the condition clears |
| MON-08 | Customer sees the same truth as support | SIM | | Compare customer portal display page with operations console | Delivery state, last seen, and current content agree; operations console shows additional internal detail only |

## 9. Scenario walkthroughs (end-to-end)

| ID | Scenario | Level | Expected outcome |
|---|---|---|---|
| E2E-01 | School: office staff schedule next week's notices on the outdoor sign on a Friday, including a Monday emergency override added at 07:50 on Monday | SIM+HW | Weekly notices play from Monday 08:30; emergency override is on screen within 5 minutes of publishing; audit shows who did it |
| E2E-02 | Retailer: head office publishes a December promotion to 12 sites across three states with one site excluded | SIM | 11 sites receive it; the excluded site keeps its content; delivery dashboard shows all 11 `playing` before 09:00 local on 1 December; one site offline at publish catches up |
| E2E-03 | Council: content officer uploads a PDF converted to images for a portrait kiosk, previews fit, publishes, and later asks for proof of play for a month | SIM+HW | Preview matches the kiosk; monthly playback report exports as CSV with per-item counts |
| E2E-04 | TINNOX support: a display "stopped updating" after a site changed its router | SIM+HW | Operator sees last heartbeat, DNS failure reason, and the pending version; after the site fixes DNS, the display catches up; total support time under 15 minutes, no visit |

## 10. Non-functional checks for the first release

| ID | Check | Target |
|---|---|---|
| NF-01 | Portal pages load in under 2 s on a 10 Mbps connection (excluding media upload) | SIM |
| NF-02 | API authentication: MFA available for all users; TINNOX operators require MFA | SIM |
| NF-03 | All media and API traffic over TLS; player credentials rotated on demand | SIM+HW |
| NF-04 | Backups of the database and media manifests restorable within 4 hours (tested restore) | SIM |
| NF-05 | Data stored in Australian regions (object storage and database) | SIM |
| NF-06 | Accessibility of the portal: keyboard navigation and labels on all form controls | SIM |

## 11. Traceability to the brief

| Required coverage | Tests |
|---|---|
| Interrupted downloads | MED-05, PUB-05, PUB-06 |
| Internet outages | OFF-01, OFF-02, OFF-05, OFF-07, PUB-08 |
| Reboot recovery | OFF-03, OFF-04, OFF-06, OFF-08, UPD-04 |
| Unsupported media | MED-03, MED-04, MED-06 |
| Schedule and time-zone changes | SCH-01 to SCH-10, OFF-02 |
| Failed updates and rollback | UPD-01 to UPD-06 |
| Customer isolation | ISO-01 to ISO-11 |
