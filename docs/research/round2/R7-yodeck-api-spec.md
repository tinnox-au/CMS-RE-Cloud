# R7: Yodeck public OpenAPI spec, full extraction (2026-11-03)

Source for every row labelled VERIFIED_FULL_PAGE (spec): the Yodeck OpenAPI 3.1.0 bundle "Yodeck API - Beta", version 2.0.0, fetched today from https://app.yodeck.com/api-docs/bundle.yaml. Local copy: `(session scratchpad)/web/probe-api-docs_bundle.yaml` (676,299 bytes, 14,593 lines, sha256 `65053d2d…6e31737`). I parsed the whole file with PyYAML, resolving `$ref`s. I did not call the live API. Quoted text is from the spec unless stated otherwise. Line numbers refer to the local copy.

Yodeck is a reference only. Nothing here is code or assets to copy.

## Summary

- **Scope.** 55 paths and 110 operations across 17 tags. Base URL `https://app.yodeck.com/api/v2`. One security scheme: header `Authorization: Token <label>:<token_value>`. VERIFIED_FULL_PAGE (spec)
- **The audit says the spec "remains login-gated and unread". That is wrong.** The bundle is public and was read in full today, which settles audit contradictions C3, C5 and C6 and several UNKNOWNs. VERIFIED_FULL_PAGE (spec)
- **Rate limits.** Three levels per rolling 10 s, counted per token and per account: Low 14/42, Standard 21/63, High 33/99. A throttled request gets a 429 with no body and a `Retry-After: N` header (seconds). 106 operations are `standard`. Only the 2 emergency-alert reads are `high`. `/app-templates` and `/account/playback-reports` state no level. No operation uses `low`. VERIFIED_FULL_PAGE (spec)
- **Webhooks.** There are six topics (1 Media, 2 Playlist, 3 Layout, 4 Schedule, 5 Screen, 6 User), not "user events only" as the audit says. The flow is pending, then validate, then active. Validation sends 3 POSTs (2 with bad signatures, which must get 401, and 1 good one, which must get 2xx). Payloads are signed with HMAC-SHA256 in header `x-signage-signature`. Endpoints must be HTTPS on port 443 and answer within 5 s. Webhooks must be re-validated every 90 days. Only global admins with API tokens can manage them. **The delivery payload schema and the retry policy are not documented.** VERIFIED_FULL_PAGE (spec)
- **Screen time zone.** It is a pair of free strings, `basic.time_zone` (area, default `Etc`) and `basic.time_subzone` (city, default `UTC`), with the allowed values given as tables in the description rather than an enum. Australia has 23 subzones, including `Melbourne`, `Sydney`, `Brisbane`, `Adelaide`, `Perth`, `Darwin`, `Hobart`, `Eucla`, `Lord_Howe` and `Broken_Hill`. The UTC offsets in the labels are a fixed daylight-saving snapshot (for example Melbourne shows UTC+11), so they are wrong for half the year. VERIFIED_FULL_PAGE (spec)
- **Floating local times.** Media availability datetimes "do not include a timezone and [are] interpreted based on the screen's location", but the examples end in `Z`. Schedule event `start`/`end` examples carry no offset. Both are therefore floating local wall-clock times evaluated in the screen's zone. Daylight saving is not mentioned anywhere in the spec. VERIFIED_FULL_PAGE (spec)
- **Scheduling.** Recurrence codes `o/d/w/m/y`, plus `every`, `occurrences`, a Monday-first `days_of_week` bitmask and `on` (day of month or nth weekday). `priority` is an integer and the higher number wins. Exceptions are `skip_on` and `skip_from`, and these can delete the event entirely. VERIFIED_FULL_PAGE (spec)
- **Takeover.** Content may be `playlist`, `media` or `layout`. `duration` is in minutes, minimum 5. `null` means indefinite, and setting the takeover to `null` stops it. **Emergency alerts.** The API can only list alerts, broadcast them and cancel them; it cannot create alerts. Broadcast `duration` defaults to 7200 s. VERIFIED_FULL_PAGE (spec)
- **Push.** Push to one screen is synchronous and returns `successful` or `failed`. Bulk push is asynchronous and is polled at `/screens/push/status`. That endpoint has **no job ID**, so only one push status can be tracked per account. VERIFIED_FULL_PAGE (spec)
- **No reboot endpoint exists.** Reboot appears only as the string field `advanced.timed_events.schedule_reboot`, alongside `download_timeslots`; neither field's format is documented. Screenshot refresh exists for one screen and in bulk. Player health (`player_status`) exposes CPU temperature, RAM, storage, uptime, versions and TV status, with availability varying by player type. VERIFIED_FULL_PAGE (spec)
- **Registration code.** "Exactly 9 digits", and the first digit gives the player type: 0 Raspberry Pi, 1 Web Player, 2 BrightSign, 3 Android 7 or earlier, 4 Tizen, 5 webOS, 6 Windows, 7 FireOS, 8 Android (Play Store), 9 ChromeOS. The audit's mapping of 8 to Fire OS and its 8-digit Pi code are contradicted. VERIFIED_FULL_PAGE (spec)
- **Hosting regions.** Example pre-signed URLs place media uploads in AWS `eu-west-1` and playback-report CSVs in `us-east-1`. That is an INFERRED sign of data stored outside Australia, which is relevant to TINNOX's Q9 (AU compliance). [corrected in verification] For media this is more than an inference: Yodeck's help centre says media is "securely hosted in Amazon Web Services (AWS) data centers located in Ireland (eu-west-1 region)" (VERIFIED_FULL_PAGE, https://help.yodeck.com/en/articles/456124-do-you-have-an-on-premise-solution). The us-east-1 location of playback reports is still INFERRED from an example URL.

## Findings

### F1. Every path and method (110 operations)

All rows: VERIFIED_FULL_PAGE (spec), https://app.yodeck.com/api-docs/bundle.yaml. The "x-ratelimit" column is the operation's `x-ratelimit` extension.

| # | Method | Path | Tag | operationId | Summary | x-ratelimit | Label |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/media` | Media | getMedia | Retrieve Media List | standard | VERIFIED_FULL_PAGE (spec) |
| 2 | POST | `/media` | Media | createMedia | Create a Media Resource | standard | VERIFIED_FULL_PAGE (spec) |
| 3 | GET | `/media/{id}` | Media | getMediaByID | Retrieve Media by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 4 | PUT | `/media/{id}` | Media | updateMediaByID | Update Media by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 5 | PATCH | `/media/{id}` | Media | patchMediaByID | Patch Media by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 6 | DELETE | `/media/{id}` | Media | deleteMediaByID | Delete Media By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 7 | GET | `/media/{id}/upload` | Media | retrieveUploadParams | Retrieve upload URL for Media | standard | VERIFIED_FULL_PAGE (spec) |
| 8 | PUT | `/media/{id}/upload/complete` | Media | updateMediaContent | Complete Media upload | standard | VERIFIED_FULL_PAGE (spec) |
| 9 | GET | `/media/{id}/status` | Media | retrieveMediaStatus | Retrieve the status of the uploaded media file | standard | VERIFIED_FULL_PAGE (spec) |
| 10 | POST | `/media/bulk` | Media | createMultipleMedia | Create Multiple Media Resources | standard | VERIFIED_FULL_PAGE (spec) |
| 11 | PUT | `/media/bulk` | Media | updateMultipleMedia | Update and/or Delete Multiple Media Resources | standard | VERIFIED_FULL_PAGE (spec) |
| 12 | GET | `/media/tags` | Media Tags | getMediaTags | Get all media tags | standard | VERIFIED_FULL_PAGE (spec) |
| 13 | POST | `/media/tags` | Media Tags | createMediaTagByID | Create a new Media tag resource | standard | VERIFIED_FULL_PAGE (spec) |
| 14 | PUT | `/media/tags/{id}` | Media Tags | updateMediaTagByID | Update a Media tag resource | standard | VERIFIED_FULL_PAGE (spec) |
| 15 | DELETE | `/media/tags/{id}` | Media Tags | deleteMediaTagByID | Delete a Media tag resource | standard | VERIFIED_FULL_PAGE (spec) |
| 16 | GET | `/media/tags/{id}` | Media Tags | getMediaTag | Get Media Tag | standard | VERIFIED_FULL_PAGE (spec) |
| 17 | GET | `/apps` | Apps | getApps | Retrieve Apps List | standard | VERIFIED_FULL_PAGE (spec) |
| 18 | POST | `/apps` | Apps | createApp | Create an App Resource | standard | VERIFIED_FULL_PAGE (spec) |
| 19 | GET | `/apps/{id}` | Apps | getAppByID | Retrieve App by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 20 | PUT | `/apps/{id}` | Apps | updateAppByID | Update App by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 21 | PATCH | `/apps/{id}` | Apps | patchAppByID | Patch App by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 22 | DELETE | `/apps/{id}` | Apps | deleteAppByID | Delete App By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 23 | GET | `/apps/{id}/template` | Apps | getAppTemplate | Retrieve App Template Schema | standard | VERIFIED_FULL_PAGE (spec) |
| 24 | GET | `/app-templates` | App Templates | getAppTemplates | Get All App Templates | (none stated) | VERIFIED_FULL_PAGE (spec) |
| 25 | GET | `/folders` | Folders | getFolders | Retrieve Folder List | standard | VERIFIED_FULL_PAGE (spec) |
| 26 | GET | `/folders/{id}` | Folders | getFolderByID | Retrieve Folder by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 27 | DELETE | `/folders/{id}` | Folders | deleteFolderByID | Delete Folder By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 28 | GET | `/schedules` | Schedules | getSchedules | Retrieve Schedule List | standard | VERIFIED_FULL_PAGE (spec) |
| 29 | POST | `/schedules` | Schedules | createSchedule | Create a new Schedule | standard | VERIFIED_FULL_PAGE (spec) |
| 30 | GET | `/schedules/{id}` | Schedules | getScheduleByID | Retrieve Schedule by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 31 | PUT | `/schedules/{id}` | Schedules | updateScheduleByID | Update Schedule by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 32 | PATCH | `/schedules/{id}` | Schedules | patchScheduleByID | Patch Schedule by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 33 | DELETE | `/schedules/{id}` | Schedules | deleteScheduleByID | Delete Schedule By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 34 | PATCH | `/schedules/{id}/add-event-exception` | Schedules | addEventException | Add Event Exception | standard | VERIFIED_FULL_PAGE (spec) |
| 35 | GET | `/playlists` | Playlists | getPlaylists | Retrieve Playlist List | standard | VERIFIED_FULL_PAGE (spec) |
| 36 | POST | `/playlists` | Playlists | createPlaylist | Create a Playlist | standard | VERIFIED_FULL_PAGE (spec) |
| 37 | GET | `/playlists/{id}` | Playlists | getPlaylistbyID | Retrieve playlist by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 38 | PUT | `/playlists/{id}` | Playlists | updatePlaylistbyID | Update playlist by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 39 | PATCH | `/playlists/{id}` | Playlists | patchPlaylistbyID | Patch playlist by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 40 | DELETE | `/playlists/{id}` | Playlists | deletePlaylistByID | Delete Playlist By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 41 | GET | `/tagbased-playlists` | Tagbased Playlists | getTagbasedPlaylists | Retrieve Tagbased Playlist List | standard | VERIFIED_FULL_PAGE (spec) |
| 42 | POST | `/tagbased-playlists` | Tagbased Playlists | createTagbasedPlaylist | Create a Tagbased Playlist | standard | VERIFIED_FULL_PAGE (spec) |
| 43 | GET | `/tagbased-playlists/{id}` | Tagbased Playlists | getTagbasedPlaylistbyID | Retrieve tagbased playlist by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 44 | PUT | `/tagbased-playlists/{id}` | Tagbased Playlists | updateTagbasedPlaylistbyID | Update tagbased playlist by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 45 | PATCH | `/tagbased-playlists/{id}` | Tagbased Playlists | patchTagbasedPlaylistbyID | Patch tagbased playlist by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 46 | DELETE | `/tagbased-playlists/{id}` | Tagbased Playlists | deleteTagbasedPlaylistByID | Delete Playlist By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 47 | GET | `/workspaces` | Workspaces | getWorkspaces | Retrieve Workspace List | standard | VERIFIED_FULL_PAGE (spec) |
| 48 | POST | `/workspaces` | Workspaces | createWorkspace | Create a Workspace Resource | standard | VERIFIED_FULL_PAGE (spec) |
| 49 | GET | `/workspaces/{id}` | Workspaces | getWorkspaceByID | Retrieve Workspace by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 50 | PUT | `/workspaces/{id}` | Workspaces | updateWorkspaceByID | Update Workspace By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 51 | PATCH | `/workspaces/{id}` | Workspaces | patchWorkspaceByID | Patch Workspace By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 52 | DELETE | `/workspaces/{id}` | Workspaces | deleteWorkspaceByID | Delete Workspace By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 53 | GET | `/layouts` | Layouts | getLayouts | Retrieve Layout List | standard | VERIFIED_FULL_PAGE (spec) |
| 54 | POST | `/layouts` | Layouts | createLayout | Create Layout | standard | VERIFIED_FULL_PAGE (spec) |
| 55 | GET | `/layouts/{id}` | Layouts | getLayoutByID | Retrieve Layout by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 56 | DELETE | `/layouts/{id}` | Layouts | deleteLayoutByID | Delete Layout By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 57 | PUT | `/layouts/{id}` | Layouts | updateLayoutById | Update Layout by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 58 | PATCH | `/layouts/{id}` | Layouts | patchLayoutById | Patch layout by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 59 | GET | `/screens` | Screens | getScreen | Retrieve Screen List | standard | VERIFIED_FULL_PAGE (spec) |
| 60 | POST | `/screens` | Screens | createScreen | Create a Screen | standard | VERIFIED_FULL_PAGE (spec) |
| 61 | GET | `/screens/{id}` | Screens | getScreenByID | Retrieve Screen by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 62 | PUT | `/screens/{id}` | Screens | updateScreenByID | Update Screen by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 63 | PATCH | `/screens/{id}` | Screens | patchScreenByID | Patch Screen by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 64 | DELETE | `/screens/{id}` | Screens | deleteScreenByID | Delete Screen By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 65 | POST | `/screens/bulk` | Screens | createMultipleScreens | Create Multiple Screen Resources | standard | VERIFIED_FULL_PAGE (spec) |
| 66 | PUT | `/screens/bulk` | Screens | updateMultipleScreens | Update and/or Delete Multiple Screen Resources | standard | VERIFIED_FULL_PAGE (spec) |
| 67 | PATCH | `/screens/bulk` | Screens | patchMultipleScreens | Patch Multiple Screen Resources | standard | VERIFIED_FULL_PAGE (spec) |
| 68 | POST | `/screens/push` | Screens | pushToScreens | Push to Screens | standard | VERIFIED_FULL_PAGE (spec) |
| 69 | POST | `/screens/{id}/push` | Screens | pushToScreen | Push to Screen | standard | VERIFIED_FULL_PAGE (spec) |
| 70 | GET | `/screens/push/status` | Screens | getPustStatus | Retrieve Push Status | standard | VERIFIED_FULL_PAGE (spec) |
| 71 | POST | `/screens/refresh-screenshot` | Screens | refreshScreenshotList | Refresh Screenshot for Screens | standard | VERIFIED_FULL_PAGE (spec) |
| 72 | POST | `/screens/{id}/refresh-screenshot` | Screens | refreshScreenshotDetail | Refresh Screenshot for Screen | standard | VERIFIED_FULL_PAGE (spec) |
| 73 | PUT | `/screens/{id}/takeover` | Screens | updateScreenTakeover | Takeover screen | standard | VERIFIED_FULL_PAGE (spec) |
| 74 | PUT | `/screens/takeover` | Screens | updateScreensTakeover | Takeover screens | standard | VERIFIED_FULL_PAGE (spec) |
| 75 | GET | `/emergency-alerts` | Emergency Alerts | getEmergencyAlerts | Retrieve Emergency Alerts List | high | VERIFIED_FULL_PAGE (spec) |
| 76 | GET | `/emergency-alerts/{id}` | Emergency Alerts | getEmergencyAlertByID | Retrieve Emergency Alert by ID | high | VERIFIED_FULL_PAGE (spec) |
| 77 | GET | `/emergency-alerts/broadcast-screen-groups` | Emergency Alerts | getBroadcastGroupList | Retrieve Broadcast Group List | standard | VERIFIED_FULL_PAGE (spec) |
| 78 | GET | `/emergency-alerts/broadcast-screen-groups/{id}` | Emergency Alerts | getBroadcastScreenGroupByID | Retrieve Broadcast Screen Group by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 79 | GET | `/emergency-alerts/broadcasts` | Emergency Alerts | getActiveEmergencyAlertBroadcastList | Retrieve Active Emergency Alert Broadcast List | standard | VERIFIED_FULL_PAGE (spec) |
| 80 | DELETE | `/emergency-alerts/broadcasts` | Emergency Alerts | cancelBroadcasts | Cancel All Broadcasts | standard | VERIFIED_FULL_PAGE (spec) |
| 81 | DELETE | `/emergency-alerts/broadcasts/{broadcast_hash}` | Emergency Alerts | cancelBroadcast | Cancel Broadcast | standard | VERIFIED_FULL_PAGE (spec) |
| 82 | POST | `/emergency-alerts/{id}/broadcast` | Emergency Alerts | createBroadcastEmergencyAlert | Broadcast Emergency Alert | standard | VERIFIED_FULL_PAGE (spec) |
| 83 | GET | `/users` | Users | getUsers | Retrieve User List | standard | VERIFIED_FULL_PAGE (spec) |
| 84 | POST | `/users` | Users | createUsers | Create a User | standard | VERIFIED_FULL_PAGE (spec) |
| 85 | GET | `/users/{id}` | Users | getUserByID | Retrieve User by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 86 | PUT | `/users/{id}` | Users | updateUserByID | Update a User by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 87 | PATCH | `/users/{id}` | Users | patchUserByID | Patch a User by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 88 | DELETE | `/users/{id}` | Users | deleteUserByID | Delete User By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 89 | GET | `/roles` | Roles | getRoles | Retrieve a Roles List | standard | VERIFIED_FULL_PAGE (spec) |
| 90 | POST | `/roles` | Roles | createRole | Create a new Role. | standard | VERIFIED_FULL_PAGE (spec) |
| 91 | GET | `/roles/{id}` | Roles | getRoleByID | Retrieve a Role by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 92 | PUT | `/roles/{id}` | Roles | updateRoleByID | Update Role by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 93 | PATCH | `/roles/{id}` | Roles | patchRoleByID | Patch Role by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 94 | DELETE | `/roles/{id}` | Roles | deleteRoleByID | Delete Role By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 95 | GET | `/groups` | Groups | getGroups | Retrieve a Group List | standard | VERIFIED_FULL_PAGE (spec) |
| 96 | POST | `/groups` | Groups | createGroup | Create a new Group | standard | VERIFIED_FULL_PAGE (spec) |
| 97 | GET | `/groups/{id}` | Groups | getGroupByID | Retrieve a Group by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 98 | PUT | `/groups/{id}` | Groups | updateGroupsByID | Update a Group by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 99 | PATCH | `/groups/{id}` | Groups | patchGroupByID | Patch a Group by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 100 | DELETE | `/groups/{id}` | Groups | deleteGroupByID | Delete a Group By ID | standard | VERIFIED_FULL_PAGE (spec) |
| 101 | PATCH | `/groups/{id}/manage-members` | Groups | manageGroupMembersByID | Add or Remove Group Members. | standard | VERIFIED_FULL_PAGE (spec) |
| 102 | GET | `/account/playback-reports` | Playback Reports | getPlaybackReports | Retrieve Playback Reports List | (none stated) | VERIFIED_FULL_PAGE (spec) |
| 103 | GET | `/webhooks` | Webhooks | getWebhooks | Retrieve Webhook List | standard | VERIFIED_FULL_PAGE (spec) |
| 104 | POST | `/webhooks` | Webhooks | createWebhook | Create a Webhook | standard | VERIFIED_FULL_PAGE (spec) |
| 105 | GET | `/webhooks/{id}` | Webhooks | getWebhookByID | Retrieve Webhook by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 106 | PATCH | `/webhooks/{id}` | Webhooks | patchWebhookByID | Update Webhook by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 107 | DELETE | `/webhooks/{id}` | Webhooks | deleteWebhookByID | Delete Webhook by ID | standard | VERIFIED_FULL_PAGE (spec) |
| 108 | POST | `/webhooks/{id}/validate` | Webhooks | validateWebhook | Validate Webhook | standard | VERIFIED_FULL_PAGE (spec) |
| 109 | POST | `/webhooks/{id}/deactivate` | Webhooks | deactivateWebhook | Deactivate Webhook | standard | VERIFIED_FULL_PAGE (spec) |
| 110 | POST | `/webhooks/bulk-deactivate` | Webhooks | bulkDeactivateWebhooks | Bulk Deactivate Webhooks | standard | VERIFIED_FULL_PAGE (spec) |

Notes on coverage (VERIFIED_FULL_PAGE (spec)):
- Folders: only GET and DELETE; there is no create or update.
- Emergency Alerts: no create, update or delete of alert definitions.
- Screens: no reboot, shutdown, CEC power, log or "send command" endpoint.
- Playback Reports: list only, with no generate or configure endpoint.
- The Webhooks bulk-deactivate description links to "Bulk Validate Webhooks" (`bulkValidateWebhooks`), which is not in the spec.
- The operationId `getPustStatus` is a typo in the spec.

### F2. Rate-limit text (verbatim, spec `info.description`, lines 125 to 151)

| Item | Spec text / value | Label |
|---|---|---|
| Mechanism | "allows a certain amount of requests to be made in a rolling window of time. Too many requests inside that time frame will trigger this mechanism which will result in all consecutive requests to fail with a `429 Error Response` for a short period of time." | VERIFIED_FULL_PAGE (spec) |
| Scope | "The limitation is applied to each `Token` individually, but it accumulates across the `Account` which has its own limit." When the account limit is hit, "failing all incoming requests from any Token, even if the Token itself has not exceeded its own limitations." | VERIFIED_FULL_PAGE (spec) |
| Levels | `Low` 14 per 10s (token) / 42 per 10s (account); `Standard` 21 / 63; `High` 33 / 99. The table header says "Requests per Second", but the values are per 10 s. | VERIFIED_FULL_PAGE (spec) |
| Worked example | Standard: Token A 22 requests, throttled after 21; Token B 22, throttled after 21; Token C 20, throttled when the account reaches 63. | VERIFIED_FULL_PAGE (spec) |
| 429 response | "it will receive a 429 with no content. The response contains a `Retry-After: N` header, where N is the interval in seconds after which a retry will likely succeed." The `TooManyRequests` component has no body schema. | VERIFIED_FULL_PAGE (spec) |
| Level per endpoint | 106 `standard`; 2 `high` (GET `/emergency-alerts`, GET `/emergency-alerts/{id}`); 2 with no level (GET `/app-templates`, GET `/account/playback-reports`); 0 `low`. | VERIFIED_FULL_PAGE (spec) |
| Plan dependence | None stated. The spec does not tie limits to plan tiers. | VERIFIED_FULL_PAGE (spec) |

### F3. Authentication, token format, paging, errors

| Topic | Spec content | Label |
|---|---|---|
| Scheme | `APIKeyAuthentication`: apiKey in header `Authorization`, value `Token <label>:<token_value>`, example `Token mylabel:XXXXXXXXXXX`. The label is any string the caller chooses. | VERIFIED_FULL_PAGE (spec) |
| Token issuance | Account, Account Settings, Advanced Settings, API Tokens, Generate Token, enter a name, choose a role ("The API token acts as a user, so it obtains a user role"). On Enterprise, one role per workspace, and custom roles can be assigned. The token is shown once ("you won't be able to see it again"). The token list shows name, last accessed date, creator, role and last modified date. Deletion is irreversible and immediate. | VERIFIED_FULL_PAGE (spec) |
| Plan gating of API | The spec itself states none. The audit's "Premium and Enterprise" comes from help pages. | VERIFIED_FULL_PAGE (spec) |
| Webhook auth limit | Webhook endpoints accept only global-admin API tokens: "Browser session authentication is not supported". | VERIFIED_FULL_PAGE (spec) |
| Paging params | `limit` (min 1, default 100; GET `/screens` overrides the default to 10) and `offset` (min 0). | VERIFIED_FULL_PAGE (spec) |
| Paging envelope | `Pagination`: `count` (int64), `next`, `previous` (URL or null). Lists add `results`. The `next` example is `https://app.yodeck.com/<resource>/?page=2`, a page-number URL that does not match the limit/offset parameters. | VERIFIED_FULL_PAGE (spec) |
| Common filters | `q` (partial match on name), `workspace` (ID), `parent_folder` (ID), `ids` (comma-separated, not repeated), `ordering` (array; a `-` prefix sorts descending), `tags` and `exclude_tags` (match ANY), and `date` with `__gte`/`__lte` suffixes in ISO 8601 without an offset (example `2025-06-13T21:00:00`). | VERIFIED_FULL_PAGE (spec) |
| Screen list filters | `subset` (offline_notifications, player_status, media_filtering, basic, sound_and_display, working_hours_config, emergency_alerts, network, advanced), `q`, `online` and `registered` (`true` or `false` strings), `ids`, `workspace`, `tags`, `exclude_tags`, `ordering` (last_modified, name, last_pushed). | VERIFIED_FULL_PAGE (spec) |
| Playlist list | `q`, `limit`, `offset`, `ids`, `ordering`. **No `workspace` filter**, unlike schedules and layouts. | VERIFIED_FULL_PAGE (spec) |
| Error schema | `{"error": {code, message, details (object), timestamp}}`. Examples: 400 `err_1001` "Invalid request input"; 401 `auth_1001` "No permission" with details `{action, resource}`; 404 `err_1004` "Resource is not found"; 500 `err_1000`. 429 has no body. | VERIFIED_FULL_PAGE (spec) |
| Bulk semantics | PUT `/screens/bulk` (and the media bulk endpoints): "If any object fails during update or delete, the entire operation is rolled back". | VERIFIED_FULL_PAGE (spec) |
| Datetime style | Mostly ISO 8601 with `Z` (`YYYY-MM-DDTHH:mm:ssZ`). Schedule and layout timestamps have microseconds and no offset (`2024-05-28T09:32:12.539456`). `player_status.status_last_updated` has a `+03:00` offset. Takeover examples end in a Greek capital Zeta (U+0396) instead of `Z` (4 occurrences). | VERIFIED_FULL_PAGE (spec) |

### F4. Webhooks

| Topic | Spec content | Label |
|---|---|---|
| Registration | POST `/webhooks` with `url` (required, https, port 443, **immutable after creation**), `topics` (required, integer IDs, min 1) and `workspaces` (optional; empty means all workspaces). Returns 201 `WebhookCreateDetail` with state `pending` and `hmac_key`, which is returned **only once**. | VERIFIED_FULL_PAGE (spec) |
| Topics (complete list) | `1` Media, `2` Playlist, `3` Layout, `4` Schedule, `5` Screen ("screen/device resources"), `6` User. The tag text says each covers "create/update/delete events". There are **no topics for push completed, screen online/offline, media finished, or playback**. | VERIFIED_FULL_PAGE (spec) |
| Validation handshake | POST `/webhooks/{id}/validate` sends "3 POST requests … in random order: 2 requests with invalid signatures – the endpoint must return `401`. 1 request with a valid signature – the endpoint must return `2xx`." Body: `events: []`, `lastEventSequence: 0`, `firstEventSequence: 0`, random `entropy`. If all 3 pass the state becomes `active`; otherwise `inactive` with `last_failure_reason`. Response: `{success, state (active or inactive), message, last_failure_reason}`. | VERIFIED_FULL_PAGE (spec) |
| Signing | "Every webhook delivery includes an `x-signage-signature` header containing an HMAC-SHA256 signature of the payload body, signed with your `hmac_key`." The example key is 64 hex characters. **The encoding (hex or base64), any timestamp in the signature, and replay protection are not stated.** | VERIFIED_FULL_PAGE (spec) |
| Endpoint rules | HTTPS on 443; respond within 5 s; 2xx when valid, 401 when the signature is invalid; **"Not include cookies in response headers."** | VERIFIED_FULL_PAGE (spec) |
| States | `pending`, `active`, `inactive`. Deactivate works only from `active` (otherwise 400). Re-activation is by validating again. Bulk deactivate works on the given `ids`, or on **all active webhooks** when no ids are given. | VERIFIED_FULL_PAGE (spec) |
| Retries and health | The only fields are `retry_count` ("consecutive delivery retries since the last successful delivery"), `last_delivery_attempt`, `last_failure_reason` and `disabled_at`. `last_successful_validation` is "Used to trigger periodic re-authentication (every 90 days)". **Retry schedule, backoff, maximum attempts and auto-disable threshold are not documented.** | VERIFIED_FULL_PAGE (spec) |
| Payload fields | Only the validation envelope is documented: `events` (array), `firstEventSequence`, `lastEventSequence`, `entropy`. INFERRED: deliveries are batched with sequence numbers, so receivers can detect gaps. **The shape of each element in `events[]` (resource ID, action, timestamp, workspace) is not in the spec.** | VERIFIED_FULL_PAGE (spec); batching INFERRED |
| Filtering | `GET /webhooks?state=&topics=1,2&workspaces=all,1,3`. Here `all` means webhooks with no workspace restriction. | VERIFIED_FULL_PAGE (spec) |
| Audit fields | `created_by_token` (token ID), `created_at`, `updated_at`. | VERIFIED_FULL_PAGE (spec) |

### F5. Screen schema (ScreenFullDetail: base fields plus subsets)

| Field / group | Type and semantics | Label |
|---|---|---|
| Base | `id`, `uuid`, `name`, `description`, `player_type` (free string, e.g. "Web Player", "Raspberry"), `workspace{id,name}`, `created_at`, `last_modified`, `last_ip_address`, `last_pushed`, `reg_code`, `takeover_content` (null when no takeover), `screenshot_url` (e.g. `https://app.yodeck.com/screenshots/<hash>.png`), `state`, `configuration` (example `{"player":{"tv_power_status":true}}`), `gpio_enable` (Raspberry Pi). | VERIFIED_FULL_PAGE (spec) |
| `state` | An untyped object. Example: `{"online": true, "last_seen": "2024-05-10T11:21:21Z", "updating": false, "registered": true}`. There is no enum. The offline threshold and heartbeat interval are not stated. | VERIFIED_FULL_PAGE (spec) |
| `screen_content` | `source_type` is one of `playlist`, `media`, `layout`, `schedule`, `turned_off` (with `turned_off` the `source_id` is ignored). This single slot holds either the default content or a schedule. A schedule's own `filler_content` serves as the default when no event is active. | VERIFIED_FULL_PAGE (spec) |
| Time zone | `basic.time_zone` (string, default `Etc`): one of Africa, America, Antarctica, Arctic, Asia, Atlantic, Australia, Brazil, Canada, Chile, Etc, Europe, Indian, Mexico, Pacific, US. `basic.time_subzone` (string, default `UTC`): "always restricted to the Time Zone's available Subzones". **These are free strings with tabled values, not an OpenAPI `enum`.** The pair corresponds to tzdb names such as `Australia/Melbourne` (INFERRED from the naming). | VERIFIED_FULL_PAGE (spec) |
| Australian values (area `Australia`, 23) | `Adelaide` (label UTC+10:30), `Brisbane` (+10), `Broken_Hill` (+10:30), `ACT` (+11), `Canberra` (+11), `Currie` (+11), `Darwin` (+9:30), `Eucla` (+8:45), `Hobart` (+11), `Lindeman` (+10), `LHI` (+11), `Lord_Howe` (+11), `Melbourne` (+11), `North` (+9:30), `Perth` (+8), `Queensland` (+10), `South` (+10:30), `NSW` (+11), `Sydney` (+11), `Tasmania` (+11), `Victoria` (+11), `West` (+8), `Yancowinna` (+10:30). Lines 11052 to 11079. | VERIFIED_FULL_PAGE (spec) |
| Other AU-relevant values | `Antarctica/Macquarie` ("Macquarie, Australia (UTC+11)"), `Antarctica/Casey` (+8), `Antarctica/Davis` (+7), `Antarctica/Mawson` (+5), `Indian/Christmas` (+7), `Indian/Cocos` (+6:30), `Pacific/Norfolk` (+12). | VERIFIED_FULL_PAGE (spec) |
| Offset labels | The labels are the summer (DST) offsets. Melbourne, Sydney, Canberra and Hobart show +11 and Adelaide and Broken Hill show +10:30, which are correct only from October to April. Lord Howe shows +11 (its DST offset; standard time is +10:30). INFERRED: the labels were generated once during southern summer and are not evaluated per date. There is no DST text anywhere in the spec. | Labels VERIFIED_FULL_PAGE (spec); interpretation INFERRED |
| Deprecated aliases | `ACT`, `NSW`, `North`, `South`, `West`, `Queensland`, `Victoria`, `Tasmania`, `LHI`, `Canberra`, `Yancowinna` and `Currie` are tzdb backward-compatibility links. The picker lists them next to the canonical zones (INFERRED, from tzdb knowledge). | INFERRED |
| Orientation | `basic.monitor_rotation` is a free string: "Rotation applied to the monitor (e.g. CW, CCW, etc). Empty string when default." No enum and no 180-degree value is documented. | VERIFIED_FULL_PAGE (spec) |
| Resolution | `sound_and_display.resolution` is a free string holding an X11 modeline (example `Modeline "720x480i"x60.0 13.51 720 739 801 858 480 488 494 525 interlace -hsync -vsync`). `sound_and_display.overscan` is a string (example `4,3,5,1`). There are also `sound_output` and `volume_schedule`. The detected size is in `player_status.screen_resolution` `[w,h]` and `player_window_size`. | VERIFIED_FULL_PAGE (spec) |
| `player_status` | `screen_ID`, `status_last_updated`, `software_version`, `screen_resolution`, `storage` (text, e.g. "24.08 GB free of 25.93 GB"), `uptime` (s), `ram{total_ram, availabe [sic], used}`, `hardware_version`, `tv_status` (bool or null), `player_window_size`. Raspberry Pi only: `hostname`, `browser_session_data_size`, `wifi_status`, `hdmi_connected`, `power_supply`, `color_depth`, `cpu_temperature` (°C), `cpu_load{1,5,15 min}`, `swaps`, `public_ip{eth0,wlan0}`, `lockdown`, `encrypted`. Web Player: `browser_version`, `player_installed_as_pwa_app`. BrightSign, Tizen, webOS and Windows: `firmware_version`. "Available fields vary based on player type." | VERIFIED_FULL_PAGE (spec) |
| `offline_notifications` | `notify_after` (minutes, example 360), `notify_during_scheduled_turnoff`, `notify_when_back_online`, **`recipients` (array of e-mail addresses, example includes external domains)**, `recipients_all`, `last_modified`. | VERIFIED_FULL_PAGE (spec) |
| `working_hours_config` | `apply_working_hours` is `custom`, `parent` or `none`. `working_hours.{Mo..Su}{enable, ranges[{start,end HH:MM:SS}]}`, `exceptions[{date, turned_off, ranges}]`, `hash`. The workspace variant says 1 or 2 ranges per exception. | VERIFIED_FULL_PAGE (spec) |
| `network` | Wi-Fi (primary and secondary, EAP username and password, static IP, DNS; secrets masked as `••••••••`), `modem` (PIN, APN), `proxy` (host, port, user, password, exceptions as JSON), `lan`, `network_ntp_servers`. | VERIFIED_FULL_PAGE (spec) |
| `advanced` | `device_manager_vendor`; `on_screen_messages` (disable diagnostics, screen-off and background messages); `security` (firewall policy, `network_disable_remote_support`, `allow_ssh_lan`, `custom_certificates`, `lockdown`, `encrypt_media_storage`, `store_encryption_key_in_player`, `whitelisted_ips`, `enable_remote_debug`); `customization` (`allow_raspberry_config_overwrite`, `raspberry_config_content`, `player_directives`); **`timed_events.download_timeslots` and `timed_events.schedule_reboot` (string or null, format undocumented)**; `interactive_features` (touchscreen, virtual keyboard); `location` (latitude and longitude as strings, detected values, `auto_detect_latlon`). | VERIFIED_FULL_PAGE (spec) |
| `media_filtering` | `media_tags[]`, `media_tag_filtering_enabled`, `media_tag_filtering_rule` 1 = all, 2 = any, 3 = all and no extra, 4 = any and no extra. "Available only on premium and enterprise plans." | VERIFIED_FULL_PAGE (spec) |
| `emergency_alerts` | Per screen, a list of `{alert{id,name,category,icon,headline,description,instruction,is_default}, show{source_type,source_id,fit}}`, which is the content shown during the alert. | VERIFIED_FULL_PAGE (spec) |
| Create (`ScreenPost`) | Required: `name`, `player_type`, `workspace{id,name}`, `reg_code` ("exactly 9 digits"; first digit: 0 Raspberry Pi, 1 Web Player, 2 BrightSign, 3 Android (7 or earlier), 4 Tizen, 5 WebOS, 6 Windows, 7 FireOS, 8 Android (Play Store), 9 ChromeOS). Optional: `working_hours_config`. | VERIFIED_FULL_PAGE (spec) |

### F6. Media schema

| Topic | Spec content | Label |
|---|---|---|
| Types | `media_origin.type`: image, video, audio, webpage, document; `app` is read-only ("Cannot create or update media of `app` type"). The type cannot change after creation. | VERIFIED_FULL_PAGE (spec) |
| Sources | `local` (upload), `url` (import), `stream` (YouTube, Vimeo, RTP, HLS), `usb_stream` (HDMI capture card; example value `usb/stream`), `null` (apps). | VERIFIED_FULL_PAGE (spec) |
| Accepted local formats | Image: jpeg, jpg, png, bmp, svg, jfif. Video: mpeg, flv, mov, avi, swf, mp4, mkv, x-matroska, x-x-msvideo, webm, wmv, 3gp, 3gpp, quicktime, ts, x-m4v, m4v, ppt. Audio: x-m4a, m4a, mp3, ogg, wav, x-wav, mpeg3, x-mpeg-3. Document: ppt, pptx, doc, docx, xls, xlsx, pdf, x-pdf. | VERIFIED_FULL_PAGE (spec) |
| PowerPoint | `media_origin.format` is `pdf` (the default, also used when null or invalid) or `video`. | VERIFIED_FULL_PAGE (spec) |
| Status enum | `initialized` ("created but not yet uploaded"), `uploading`, `encoding` ("processed and transcoded"), `finished` (ready), `failed` (terminal). Defined as `oneOf` titles, not an `enum`. The `uploading` example is wrongly `encoding`. Polled at GET `/media/{id}/status`. | VERIFIED_FULL_PAGE (spec) |
| Upload flow | 1. POST `/media` with `source: local`. 2. GET `/media/{id}/upload` returns `upload_url` (a pre-signed S3 PUT; example `dsbackend.s3.amazonaws.com`, `eu-west-1`, `X-Amz-Expires=600`). 3. PUT the bytes with `Content-Type`. 4. PUT `/media/{id}/upload/complete` with the `upload_url`. With `source: url`, set `arguments.download_from_url` and no completion call is needed. | VERIFIED_FULL_PAGE (spec); the 600 s expiry is from the example only |
| Common fields | `name`, `description`, `default_duration` (s, default 5), `tags[]`, `file_extension`, `created_at`, `last_modified`, `last_uploaded`, `thumbnail_url`, `workspace`, `parent_folder`. | VERIFIED_FULL_PAGE (spec) |
| Video arguments | `duration` (read-only, natural length), `download_from_url`, `play_from_url` (YouTube or Vimeo), `resolution` (default `highest`), `resolution_width` and `resolution_height` (read-only), `fps` (default `auto`), `buffering`, `rotate` enum 0, 90, 180, 270, `crop_settings{top,bottom,left,right}` 0 to 99.99 %, `show_subtitles`. | VERIFIED_FULL_PAGE (spec) |
| Document arguments | `page_settings.default_page_duration` (default 10 s); `specific_page_duration[{page_number,duration}]`. | VERIFIED_FULL_PAGE (spec) |
| Webpage arguments | `play_from_url`, `refresh_rate` (s), `zoom_factor` (1 to 999 %), `auto_zoom_enable`, `disable_private_browsing`, `chromium_settings{enable_chromium, keep_session_data, enable_flash_player}`, `user_agent`, `disable_cert_checks`, `run_script`, `script_code`, `media_fallback` (media ID). | VERIFIED_FULL_PAGE (spec) |
| Availability | `availability_schedule{enable (default false), available_after, available_before (date-time or null), availability_slots[{start, end HH:mm:ss, days_of_week}]}`. The `days_of_week` bitmask is Monday first: "`0101011` means … Tuesday, Thursday, Saturday, and Sunday". | VERIFIED_FULL_PAGE (spec) |
| Availability time-zone semantics | "This timestamp does not include a timezone and is interpreted based on the screen's location." The examples nevertheless are `2024-05-20T12:38:00Z` and `2024-06-21T12:38:00Z`. INFERRED: the `Z` is ignored and the value is read as wall-clock time in the screen's zone. Only a live test could confirm this, and a live test is out of scope. The spec does not cover DST gaps or overlaps. | Text VERIFIED_FULL_PAGE (spec); reading INFERRED |
| Media tags | `/media/tags` CRUD (standard). | VERIFIED_FULL_PAGE (spec) |
| Apps | 22 supported templates (ticker, Custom RSS, QR Code, Date & Time, Analog Clock, three weather apps, 13 news feeds and Google Alerts). Clock apps take an IANA `timezone` (e.g. `Europe/London`) or fall back to "the Player's location". Colours are RRGGBBAA hex. | VERIFIED_FULL_PAGE (spec) |

### F7. Playlists, layouts, schedules, takeover, emergency alerts, push

| Object | Spec content | Label |
|---|---|---|
| Playlist | `items[]` is a `oneOf` of: `media` {id, priority (order), duration s, name, type}; `layout` {id, priority, duration} (example type `subplaylist`, a spec typo); `subplaylist` {id, priority, `max_time`, `max_items`}; `hide_playlist` {priority, duration}. `transition_options{add_image_transition, image_transition_name (24 values: fade, burn, fadegrayscale, colorphase, colourdistance, morph, dreamy, directionalwipe, directionalwrap, crosswrap, ripple, corcleopen, radial, wind, windowslice, crosshatch, randomsquares, pixelize, polkadotscurtain, squareswire, flyeye, squeeze, waterdrop, random), image_transition_speed slow 3 s, medium 2 s, fast 1 s or custom, image_transition_duration, add_gaps}`. `playback_options{synced_playback, random_playback}`. `thumbnail_url`. | VERIFIED_FULL_PAGE (spec) |
| Tag-based playlist | `tagbased{tags (read-only), workspaces[], includes[], excludes[], content_to_filter: only_media or media_apps}`, `add_gaps` (default true), `shuffle_content` (false means **alphabetical** order). | VERIFIED_FULL_PAGE (spec) |
| Layout | `resolution_width` and `resolution_height` (integer px, example 1920x1080; no maximum stated). `parent_folder` (object or ID). `background_audio{id, item{type: video, audio, playlist, widget or integration, id}}`. **No background-colour field.** | VERIFIED_FULL_PAGE (spec) |
| Layout region | Required: `width`, `height`, `top`, `left`, `zindex`, `duration`, `res_width`, `res_height`, `order`. Also `fit` (**free string**: "e.g. crop, contain, etc."), `enable_transparency`, `is_muted`, `hidden`, `rotation` (degrees), `flip` (string), `content_width/height/top/left`, `maintain_aspect_ratio` (1, 0 or null), `lock`, `content_data` (for clipart and text), `item{type: image, video, audio, playlist, widget, integration, pdf or url; id}`. `duration: -2` "typically indicates infinite". | VERIFIED_FULL_PAGE (spec) |
| Schedule | `events[]`, `filler_content{source_id, source_name, source_type: turned_off, media, playlist or layout}`, `workspace`. | VERIFIED_FULL_PAGE (spec) |
| Event | `start` and `end` (date-time; examples `2024-01-01T00:00:00` and `2050-01-01T00:00:00` with no offset). `duration` (minutes). `priority` (integer; "In case of overlapping events the one with higher number priority will play"; no range given). `recurrence` (`o` once, ignores other fields; `d` daily, converted to `w` if `days_of_week` is set; `w` weekly; `m` monthly; `y` yearly). `days_of_week` (default `0000000`, Monday first). `every` (default 1). `occurrences` (integer or null). `on` (monthly only: `[25]` is the 25th of the month when `days_of_week=0000000`; `[2]` with `1000000` is the 2nd Monday). `source{source_id, source_name, source_type: turned_off, media, playlist or layout}`. The schema has no `until` field: `end` serves as the series end. The description refers to a `parent` field for time-shifted occurrences, but that field is not in the schema. | VERIFIED_FULL_PAGE (spec) |
| Event exceptions | PATCH `/schedules/{id}/add-event-exception` with `{event_id, exceptions[{skip_on: date} or {skip_from: date}]}`, returning 202. A `skip_from` on or before the event start, or a `skip_on` on a one-off event, **deletes the event**. "Time shifting exceptions may only be applied via the Portal's UI". | VERIFIED_FULL_PAGE (spec) |
| Takeover | PUT `/screens/{id}/takeover` `{takeover_content{source_id, source_type: media, layout or playlist, duration in minutes, min 5, null for indefinite} or null to stop, use_download_timeslots}` returns `{status: success or fail, errors}`. PUT `/screens/takeover` takes `screens[{id, takeover_content}]` and returns a per-screen status. On a screen read, `takeover_content` includes `start` and `end`. | VERIFIED_FULL_PAGE (spec) |
| Emergency alert | Read-only definitions: `id`, `category` (e.g. geo, met, fire), `name`, `icon`, `headline`, `description`, `instruction`, `screen_assigned_count`. Broadcast: POST `/emergency-alerts/{id}/broadcast` with `{headline, description, instruction (override), duration s default 7200, workspace, broadcast_screen_group}` returns 201 `{start_time, end_time, broadcast_hash, workspace, broadcast_screen_group, broadcast_screens, emergency_data}`. Broadcast screen groups are `{id, name, screen_tags[]}`, so they are tag-based. Cancel one by `broadcast_hash`, or cancel all. **No CAP field appears in the spec.** | VERIFIED_FULL_PAGE (spec) |
| Push one | POST `/screens/{id}/push` `{use_download_timeslots}`. Described as "synchronously … you don't have to utilize your polling mechanism". Returns 200 with `oneOf` `{status:"successful", screens{id,name}}` or `{status:"failed", errors{}}`. | VERIFIED_FULL_PAGE (spec) |
| Push many | POST `/screens/push` `{use_download_timeslots, filter_workspaces[] or filter_devices[]}` (mutually exclusive; empty `filter_devices` is a 400; screens without `apply_changes` permission are excluded; no filter means all screens). Asynchronous; returns `push_status_url`. | VERIFIED_FULL_PAGE (spec) |
| Push status | GET `/screens/push/status` (no parameters) returns `oneOf` `initialized`; `in_progress` with `progress{index, of, percent}`; `completed` with `screens[{id,name}]`; `failed` with `errors{}`. INFERRED: only the latest bulk push per account (or per token) can be read. | VERIFIED_FULL_PAGE (spec); per-account scope INFERRED |

### F8. Users, roles, groups, workspaces, folders

| Object | Spec content | Label |
|---|---|---|
| User create | Two account modes. "Invitation Only" (default) requires `email`, `workspace*`, `groups*`, `roles*`. "Manual Password" requires `first_name`, `last_name`, `email`, `password` (must contain upper, lower, numeric and special characters), `groups*`, `roles*`. Accounts with both modes add `send_invite`. | VERIFIED_FULL_PAGE (spec) |
| User fields | `workspace` (primary), `groups[]`, `roles[{role, workspace}]` (sending an empty list on update removes them), `localization.language`, `datetime_format{date_format, time_format, first_week_day}`, `notifications{emails, personal_emails, new_login, screen_online_notifications}`, `legal{accepted_terms, email_verified, newsletter_consent…}`, `security{restricted_networks (CIDR list; requires the Restricted Networks feature), is_invited, accepted_invite_at, use_otp, scim_user, phone_number, last_login, last_ip_address, last_password_change}`. Users also carry `time_zone` and `time_subzone` (same tables as screens). User filters: `has_role`, `has_role_by_id`, `is_admin`, `workspace`, `subset`. | VERIFIED_FULL_PAGE (spec) |
| Roles | "Requires Feature: Workspaces". "Premium Accounts do not have access to this resource", though Premium can still assign 1 predefined role. Predefined roles cannot be edited or deleted. Permissions: `media`, `apps`, `playlists`, `layouts`, `schedules` {view, edit, delete}; `screens` {create, delete, view, edit}; `screen_content` {view, edit} (**no delete**); `push_to_screens`, `manage_users` ("not applicable to Custom Roles"), `emergency_broadcast`. Chained rule: change or delete requires view, and view of a composite requires view of every resource it uses. | VERIFIED_FULL_PAGE (spec) |
| Groups | Enterprise. System-managed groups, editable by PATCH only: All Users, Global Admins, Billing Access, Template Managers. Default groups: Workspace Admins, Content Viewers, Content Managers, Content & Device Managers, Restricted Content Managers ("cannot publish content"). Each group has `primary_workspace_role{role_id, sub_role_id}` and `other_workspaces_roles[{workspace_id, role_id, sub_role_id}]`, `members[]` and `assigned_by`. Members are managed through PATCH `/groups/{id}/manage-members`. | VERIFIED_FULL_PAGE (spec) |
| Workspaces | `id`, `name`, `description`, `last_applied`, `enable_working_hours`, `working_hours`, `parent_workspace`, `screen_quota` (-1 means unlimited). Full CRUD. | VERIFIED_FULL_PAGE (spec) |
| Folders | `id`, `name`, `parent_folder` (null means root), `workspace`. GET and DELETE only. | VERIFIED_FULL_PAGE (spec) |
| Staff or partner access | **Not in the spec.** There is no partner, support-login, impersonation or audit-log endpoint. | VERIFIED_FULL_PAGE (spec) (absence) |

### F9. Playback reports, screenshots, reboot, download timeslots

| Topic | Spec content | Label |
|---|---|---|
| Playback reports | GET `/account/playback-reports` (`date__gte`/`__lte`, `ids`) returns `{id, account_uuid, created_at, from_date, to_date, file_url (file name), download_url}`. The `download_url` is a pre-signed S3 URL (`signage-playback-reports.s3.amazonaws.com`, region `us-east-1` in the example) that "expires in 2 hours". The tag says playback reports are "available on the 'Pro' or 'Enterprise' plans". [corrected in verification] "Pro" is a stale plan name. The help centre says "Premium or Enterprise" (VERIFIED_FULL_PAGE, https://help.yodeck.com/en/articles/455928-playback-reports), which matches the spec's own media-filtering text. **The CSV columns are not documented.** The tag text skips from step 1 to step 4. | VERIFIED_FULL_PAGE (spec) |
| Screenshots | `screenshot_url` on each screen. POST `/screens/{id}/refresh-screenshot` returns `{status: success, message, screen{id,name,uuid}}` ("triggers an asynchronous action"). POST `/screens/refresh-screenshot` `{screen_ids[]}` returns `{status: completed, successful_screens[], failed_screens[{error}], summary{total_requested, successful_count, failed_count}}`. Capture cadence, resolution and retention are not stated. | VERIFIED_FULL_PAGE (spec) |
| Reboot | **No endpoint.** The only reboot item is `advanced.timed_events.schedule_reboot` (string or null, example null, format undocumented), set through PUT or PATCH on the screen. | VERIFIED_FULL_PAGE (spec) |
| Download timeslots | Per screen, `advanced.timed_events.download_timeslots` (string or null, format undocumented). Push and takeover requests carry `use_download_timeslots` ("download … at predetermined times"). | VERIFIED_FULL_PAGE (spec) |

### F10. Contradictions between the spec and `docs/yodeck-workflow-audit.md` (sections 3.x and 5)

| # | Audit location and claim | Spec excerpt | Verdict | Label |
|---|---|---|---|---|
| X1 | 3.11: "the specification itself remains login-gated and unread"; content was "relayed by a third party" | The bundle is served publicly at https://app.yodeck.com/api-docs/bundle.yaml (read in full today). | Contradicted. Re-label the relayed facts as spec-verified. | VERIFIED_FULL_PAGE (spec) |
| X2 | 5 C3: rate limits "Open … numbers are one dataset's reading of the login-gated bundle"; 3.11 "official numeric rate-limit tiers and their mapping to endpoints … unknown" | "`Low` 14 per 10s / 42 per 10s; `Standard` 21 per 10s / 63 per 10s; `High` 33 per 10s / 99 per 10s" and `x-ratelimit: standard` on each operation | Resolved. The numbers are official. Mapping: 106 standard, 2 high, 2 unstated. No plan dependence is stated. | VERIFIED_FULL_PAGE (spec) |
| X3 | 3.11 "Still unknown: any webhook beyond user events"; 4.4 "Webhooks beyond user events" listed as missing; 3.8 "logs and webhooks are gaps" | "`1` — Media … `2` — Playlist … `3` — Layout … `4` — Schedule … `5` — Screen … `6` — User" | Contradicted. There are six resource topics. Still missing: device events such as online/offline, push done and media finished. | VERIFIED_FULL_PAGE (spec) |
| X4 | 3.11: bundle relayed as "user create, update and delete webhooks restricted to global admins" | "Topics represent event types … Media, Playlist, Layout, Schedule, Screen, User" and "restricted to global admins using API tokens only" | Contradicted. The relay misread the scope: the admin restriction is real, but webhooks cover six resource types, not only users. | VERIFIED_FULL_PAGE (spec) |
| X5 | 5 C2 and 3.8: an API reboot endpoint exists (path THIRD PARTY); "API: reboot and push endpoints" | No reboot path among the 110 operations; only `timed_events.schedule_reboot: ['string','null']` | Contradicted for the public v2 spec. The third-party path is undocumented (perhaps internal or legacy, INFERRED). | VERIFIED_FULL_PAGE (spec) |
| X6 | 5 C6 and 3.6: screen time-zone API format "area plus sub-zone pair versus a full string … UNVERIFIED"; "No Australian zone value was observed anywhere"; 4.1 "how the API serialises the zone … UNKNOWN" | `time_zone` "Continent (or Country)" default `Etc`, `time_subzone` "City (or Zone)" default `UTC`, with an Australia table of 23 values | Resolved: it is an area plus sub-zone pair. Australian values are present, so the audit's "none observed" is now wrong. DST is still undocumented. | VERIFIED_FULL_PAGE (spec) |
| X7 | 5 C5 and 3.3: availability datetime "API serialisation (offset required or ignored) still UNVERIFIED" | "This timestamp does not include a timezone and is interpreted based on the screen's location", but the example is `'2024-05-20T12:38:00Z'` | Narrowed. The spec says floating local time, but its own example contradicts this. The behaviour on the wire is still unproven. | VERIFIED_FULL_PAGE (spec) |
| X8 | 3.2: code "8 digits for the Raspberry Pi player and 9 digits for …"; prefix "8 Fire OS, 3 Android, 6 legacy Windows, W new Windows; the full per-type table was not retrieved" | "The code must be exactly 9 digits long … 0: Raspberry Pi, 1: Web Player, 2: BrightSign, 3: Android Player (Android 7 or earlier), 4: Tizen, 5: WebOS, 6: Windows, 7: FireOS, 8: Android (Play Store), 9: ChromeOS" | Contradicted. Fire OS is 7 and 8 is Android (Play Store). The API wants 9 digits for the Pi. INFERRED: the Pi's on-screen 8-digit code gets a leading 0, or the help page is stale. The spec also has no "W" prefix and includes ChromeOS, which the audit does not mention. | VERIFIED_FULL_PAGE (spec) |
| X9 | 3.8: offline e-mail "Recipients are account users; a per-screen recipient is an open feedback request" | `offline_notifications.recipients` example `['mail123@app.yodeck.com','mail345@example.net','mail789@example.net']`, plus `recipients_all` | Contradicted for the API. Per-screen recipient lists exist, and the example includes external addresses. | VERIFIED_FULL_PAGE (spec) |
| X10 | 3.8: "Full field list, CPU temperature, RAM, uptime and storage exposure in the API: UNKNOWN" | `player_status` lists `cpu_temperature`, `ram`, `uptime`, `storage`, `software_version`, `hardware_version`, `tv_status` and more, by player type | Resolved. | VERIFIED_FULL_PAGE (spec) |
| X11 | 3.11 "exact paths for users, roles, groups and workspaces" and "whether the Playback Reports API shipped" are unknown; 3.8 "A Playback Reports API was announced … shipping unconfirmed" | `/users`, `/roles`, `/groups`, `/groups/{id}/manage-members`, `/workspaces`, `/account/playback-reports` | Resolved. These exist in the public spec. That they work live is not tested. | VERIFIED_FULL_PAGE (spec) |
| X12 | 3.1: "Whether Screen Content has a Delete permission: UNKNOWN" | "`Screen Content` *No delete*"; `screen_content{view, edit}` | Resolved: there is no delete permission. | VERIFIED_FULL_PAGE (spec) |
| X13 | 3.6: "'After N occurrences' and a 'Turned Off' entry are evidenced only by third parties" | `occurrences` "after how many occurrences the Event ends"; `source_type` enum includes `turned_off` | Upgraded from THIRD PARTY to spec-verified. | VERIFIED_FULL_PAGE (spec) |
| X14 | 3.6 precedence: "The event placed higher in the Events List plays; priority is changed by dragging" | "`priority` … In case of overlapping events the one with higher number priority will play." | Not a contradiction but a refinement: the API exposes an integer and the higher number wins. How UI list order maps to that integer is INFERRED. | VERIFIED_FULL_PAGE (spec) |
| X15 | 3.6 Repeat options "none, daily …, work days, weekly, monthly, annual or custom" | `recurrence` codes are only `o`, `d`, `w`, `m`, `y` | Partial. "Work days" and "custom" must be encoded as `w` plus `days_of_week`, `every` and `on` (INFERRED). | VERIFIED_FULL_PAGE (spec) |
| X16 | 3.5: "API `fit: contain` corresponds to Fit" | Region `fit`: free string, "(e.g. crop, contain, etc.)", example `crop`; the emergency `show.fit` example is `fit` | Weakened. Fit is not an enum and the spec gives no mapping. | VERIFIED_FULL_PAGE (spec) |
| X17 | 3.5 and 3.2: rotation is Normal, CW or CCW; 180 only third-party | `monitor_rotation` "(e.g. CW, CCW, etc). Empty string when default." Video `rotate` enum 0, 90, 180, 270 | Consistent for screens: no 180 is documented. Media-level 180 rotation exists for video. | VERIFIED_FULL_PAGE (spec) |
| X18 | 3.3 image formats include gif and webp; audio includes aac | Local image list: "jpeg, jpg, png, bmp, svg, jfif"; audio: "x-m4a, m4a, mp3, ogg, wav, x-wav, mpeg3, x-mpeg-3" | Contradicted for the API. gif, webp and aac are not listed. INFERRED: the spec list is stale or the help page is broader. | VERIFIED_FULL_PAGE (spec) |
| X19 | 3.3 and 3.11: media status lifecycle and the upload flow are "THIRD PARTY" | Status `oneOf`: initialized, uploading, encoding, finished, failed; four-step upload flow in the Media tag | Upgraded to spec-verified. Note that the TINNOX row in 3.3 says "four-state model" while there are five states. | VERIFIED_FULL_PAGE (spec) |
| X20 | 3.6: "Download hours … Scope …, format, default … UNKNOWN" | Per screen `advanced.timed_events.download_timeslots` (string or null); `use_download_timeslots` on push and takeover | Narrowed: the setting is per screen. The format and default are still undocumented. | VERIFIED_FULL_PAGE (spec) |
| X21 | 3.6 emergency alerts: "CAP (Common Alerting Protocol) support" | No CAP field or endpoint; alert definitions are read-only | Not covered by the API. CAP, if it exists, is UI or help-only. | VERIFIED_FULL_PAGE (spec) (absence) |
| X22 | 3.7: single push "success body status is `completed`, while the public OpenAPI document says `successful`" | `status` example `successful` (single); `completed` appears only in the bulk status schema | The audit quotes the spec correctly. The live-behaviour difference remains THIRD PARTY. | VERIFIED_FULL_PAGE (spec) |
| X23 | 3.7: "only the account's most recent bulk push is tracked, with no job identifier" | GET `/screens/push/status` takes no parameters | Consistent. The spec gives no job ID. | VERIFIED_FULL_PAGE (spec) |
| X24 | 3.4: "the API playlists list has no workspace filter (THIRD PARTY)" | GET `/playlists` params: q, limit, offset, ids, ordering | Consistent, now spec-verified. | VERIFIED_FULL_PAGE (spec) |
| X25 | 3.10: "The CMS is hosted on AWS in Ireland (eu-west-1)" | Upload example `…/eu-west-1/s3/aws4_request`; playback-report example `…/us-east-1/s3/aws4_request` | Partly contradicted. Playback-report CSVs appear to sit in us-east-1, from the example credential scope (INFERRED). Media in eu-west-1 is confirmed by help article 456124 [corrected in verification]. This matters for Australian data-residency comparisons. | Excerpts VERIFIED_FULL_PAGE (spec); reading INFERRED |
| X26 | 3.11: "paging envelope with count, next, previous and results and limit and offset parameters" (third party) | `limit` default 100 (screens 10) and `offset`; but `next` example `…/?page=2` | Consistent on the parameters. The spec's own `next` example is internally inconsistent. | VERIFIED_FULL_PAGE (spec) |

## Analysis

1. **The spec beats the relays.** About a dozen audit UNKNOWN or THIRD PARTY items are now first-hand: rate limits, webhooks, time-zone format, player health, role permissions, registration prefixes, occurrences and turned-off entries, and the media lifecycle. Five audit claims are wrong as written: the spec was not unread, webhooks are not user-only, the public spec has no reboot endpoint, the registration prefixes differ, and per-screen recipients do exist. Section 5 of the audit and rows 3.2, 3.6, 3.8 and 3.11 need correcting. That is a repository edit and outside this task's remit (PROPOSED, for the doc owner).
2. **Australian time handling is weak in Yodeck, which gives TINNOX an opening.** The zone is stored as a tzdb-like pair, which is good. But the picker mixes canonical zones with deprecated aliases (`ACT`, `NSW`, `Victoria`, `LHI`, `Yancowinna`), and the labels show summer offsets all year. Floating local datetimes come with `Z`-suffixed examples, and DST is never mentioned. An operator choosing "Melbourne (UTC+11)" in July sees the wrong offset. (INFERRED from VERIFIED_FULL_PAGE (spec) text.)
3. **Monitoring and integration are thinner than the UI suggests.** There are no reboot or power endpoints. The `state` object has no enum and no threshold. Webhooks report resource changes, not device health. Bulk push status has no job ID. Playback CSV columns are undocumented. These are the areas an integrator, including TINNOX's own operations console, would need most.
4. **The LED-relevant model is pixel-based but loose.** Layouts carry free integer resolutions and absolute regions. Screen output is an X11 modeline plus an overscan string, and rotation is a free string. That matches the audit's LED workflow (force a mode, then disable the unused area), but the API validates none of it. (VERIFIED_FULL_PAGE (spec) fields; the assessment is INFERRED.)
5. **Data residency.** The examples show EU (media) and US (playback reports) S3 regions and no Australian region. Under TINNOX's Q9 position ("strictly follows AU compliance"), this supports hosting in Australia as a differentiator. The regions are INFERRED from example URLs, which may be illustrative. [corrected in verification] Media hosting in AWS Ireland is officially documented (help article 456124), and no Australian region was found in the help corpus or in a web search.

## Recommendation (PROPOSED)

| # | Proposal for TINNOX CMS | Why (spec evidence) |
|---|---|---|
| P1 | Store each display's zone as one canonical IANA ID (e.g. `Australia/Melbourne`). The picker should show canonical AU zones only (Perth, Eucla, Darwin, Brisbane, Lindeman, Adelaide, Broken_Hill, Melbourne, Sydney, Hobart, Lord_Howe, plus the external territories). Compute offset labels per date and accept aliases on input only. | Yodeck mixes aliases into the list and shows fixed summer offsets (F5) |
| P2 | Schedules and availability: store wall-clock local time with no offset plus the display's zone. Reject or normalise a trailing `Z` explicitly. Document DST gap and overlap rules. Expose RFC 5545 RRULE; Yodeck's `o/d/w/m/y` with `every`, `occurrences`, `on` and the Monday-first bitmask is a good minimum mapping. | F6 and F7 floating times; the spec is silent on DST |
| P3 | Use explicit integer event priority (higher wins, as Yodeck does) with a published precedence order, and an exception model that never silently deletes an event. | F7: the exception-deletes-event warning |
| P4 | Publish numeric rate limits per token and per tenant, with `Retry-After`. Use a JSON error body on 429 too, and a paging envelope with a consistent `next` (cursor or offset, not page). | F2 and F3, including the `?page=2` inconsistency |
| P5 | Webhooks: copy the strong parts (HMAC-SHA256, a shown-once secret, validation handshake with negative tests, sequence numbers, re-validation). Add a documented event schema, retry and backoff policy, a timestamped signature against replay, and device topics: online/offline, push completed, media ready, playback batch, alert broadcast. | F4 gaps |
| P6 | First-class device commands with job IDs: reboot, display power, screenshot now, re-push and a per-device result. Push status should be per job, never per account. | F7 and F9: no reboot, account-wide push status |
| P7 | Typed health telemetry with an enum `state` (online, offline, updating, unregistered), a published heartbeat interval and offline threshold, and numeric storage, RAM and temperature fields (not text). | F5: `state` untyped; storage is a text string |
| P8 | Output and rotation as validated enums and integers: rotation 0, 90, 180 or 270; output mode width, height and refresh; active area x, y, w, h. No free modeline strings. | F5: `monitor_rotation` and `resolution` are free strings |
| P9 | Region `fit` as an enum (contain, cover, stretch, none) and a layout background colour field. | F7: `fit` is a free string; no background field |
| P10 | Per-display offline alert recipients, including external e-mail addresses, as Yodeck's API already allows. | F5, X9 |
| P11 | Keep originals, media, logs and proof-of-play CSVs in an Australian region, and state this in the DPA. | F9 and X25 regions |

## Open items

- The shape of a webhook delivery (`events[]` element), the signature encoding, and the retry and auto-disable policy: UNKNOWN (the spec is silent).
- The format of `download_timeslots` and `schedule_reboot`: UNKNOWN.
- Whether the API ignores or honours the trailing `Z` on availability datetimes: UNKNOWN, and resolving it needs a live call, which is not allowed here.
- Allowed values for `monitor_rotation` and region `fit`: UNKNOWN beyond the examples.
- Playback-report CSV columns and granularity: UNKNOWN.
- Whether the Pi's on-screen code is 8 digits with an implied leading 0 (X8): UNKNOWN.
- Whether the S3 regions in the examples reflect production storage (X25): media is in eu-west-1, which is official (help 456124) [corrected in verification]; the us-east-1 location of playback reports is still UNKNOWN.
- Where the third-party reboot path the audit cites comes from: [corrected in verification] it is very probably the API Evangelist "modeled" OpenAPI file, which lists POST `/monitors/{id}/reboot/` (THIRD_PARTY, https://raw.githubusercontent.com/api-evangelist/yodeck-signage/refs/heads/main/openapi/yodeck-signage-screens-api-openapi.yml). That file is self-described as modelled, not official, and the path is still absent from the public v2 spec.
- Updating `docs/yodeck-workflow-audit.md` for X1 to X25: PROPOSED for the doc owner. Not done here, per the instruction not to edit repository files.

## Sources and search log

| Source | Use | Label |
|---|---|---|
| https://app.yodeck.com/api-docs/bundle.yaml (local copy `(session scratchpad)/web/probe-api-docs_bundle.yaml`, fetched 2026-11-03 by an earlier step) | All F1 to F9 facts; parsed in full with PyYAML | VERIFIED_FULL_PAGE (spec) |
| `/home/user/CMS-RE-Cloud/docs/yodeck-workflow-audit.md` sections 3.1 to 3.11, 4 and 5 (read in full) | F10 comparison | Repository document |
| IANA tz database (general knowledge: backward-compatibility links such as `Australia/ACT`, `Australia/NSW` and `Australia/Victoria`) | Alias interpretation in F5 | INFERRED |

Search log: 0 WebSearch calls and 0 WebFetch calls; no live API calls. Local parsing scripts are in `(session scratchpad)/r7scripts/`.

## Verification (adversarial pass)

Method (2026-11-03): I re-parsed the local bundle with PyYAML and grepped it by line number (scripts in `(session scratchpad)/r7verify/`). I re-fetched https://app.yodeck.com/api-docs/bundle.yaml with no credentials and got HTTP 200, 676,299 bytes, `text/yaml`. The sha256 is `65053d2d…6e31737`, which matches. I checked Australian zones against the system tzdb (`/usr/share/zoneinfo/tzdata.zi`) and Python `zoneinfo`, and searched the local help corpus. 4 WebSearch calls. There are no prices or cost tables in R7, so there was no arithmetic to check.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | The spec is public, not login-gated (X1) | confirmed | An unauthenticated GET returns 200 and a byte-identical 676,299-byte file |
| 2 | 55 paths, 110 operations, 17 tags; base `https://app.yodeck.com/api/v2`; OpenAPI 3.1.0, "Yodeck API - Beta" v2.0.0 | confirmed | The parser counts 55/110/17; `servers` and `info` match |
| 3 | Auth header `Token <label>:<value>`, one scheme | confirmed | `components.securitySchemes.APIKeyAuthentication` |
| 4 | Rate limits are Low 14/42, Standard 21/63, High 33/99 per 10 s, and the header wrongly says "per Second" | confirmed | Spec lines 128–151 |
| 5 | Level mapping is 106 standard, 2 high (emergency-alert GETs), 2 unstated, 0 low | confirmed | `x-ratelimit` Counter: standard 106, high 2, None 2 |
| 6 | 429 has no body plus `Retry-After: N` (s) | confirmed | Lines 150–151 |
| 7 | Six webhook topics (1 Media … 6 User) | confirmed | Lines 5541–5546 |
| 8 | Validation sends 3 POSTs (2 invalid → 401); HTTPS 443; respond within 5 s; HMAC-SHA256 in `x-signage-signature`; re-validate every 90 days; global-admin tokens only | confirmed | Lines 1223, 1240, 1248, 5695–5704, 14289, 14336 |
| 9 | Registration code is exactly 9 digits; prefixes 0 Pi … 7 FireOS, 8 Android (Play Store), 9 ChromeOS (X8) | confirmed | Lines 10577–10588 and 11816–11827 |
| 10 | 23 Australian subzones with summer-offset labels (Melbourne +11) | confirmed | Lines 11052–11079. tzdb gives Melbourne UTC+10 on 1 Jul 2026 and +11 on 15 Jan 2026, so the label is wrong from April to October |
| 11 | Lord Howe label +11 is its DST offset; standard is +10:30 | confirmed | `zoneinfo`: Jul +10:30, Jan +11:00 |
| 12 | `ACT`, `NSW`, `North`, `South`, `West`, `Queensland`, `Victoria`, `Tasmania`, `LHI`, `Canberra`, `Yancowinna` and `Currie` are tzdb links; `Lindeman`, `Eucla` and `Broken_Hill` are canonical (P1 list) | confirmed | `tzdata.zi` `L` lines, e.g. `L Australia/Hobart Australia/Currie` and `L Australia/Broken_Hill Australia/Yancowinna`; Lindeman has no link line |
| 13 | DST is not mentioned anywhere in the spec | confirmed | grep for daylight/DST: 0 hits |
| 14 | Takeover `duration` is in minutes with a minimum of 5, and null means indefinite; emergency broadcast `duration` defaults to 7200 s | confirmed | Lines 12100–12110 and 12405–12413 |
| 15 | Higher priority number wins; `days_of_week` is Monday first (`0101011`) | confirmed | Lines 7368 and 5986–5988 |
| 16 | No reboot endpoint; only `advanced.timed_events.schedule_reboot` | confirmed | No path matches reboot or command; the string appears only at lines 10391 and 11700 |
| 17 | Paging `limit` defaults to 100, or 10 on GET `/screens`; `/playlists` has no workspace filter | confirmed | Resolved parameter defaults per path |
| 18 | Bulk push status takes no job ID; operationId typo `getPustStatus`; `?page=2` `next` example; `bulkValidateWebhooks` reference not in spec | confirmed | Lines 4186, 5794 and 5953; the path takes no parameters |
| 19 | Takeover examples use Greek Zeta (U+0396) instead of `Z`, 4 occurrences | confirmed | grep count 4 (lines 8795–8868) |
| 20 | Media upload URL example uses `eu-west-1` with `X-Amz-Expires=600` | confirmed | 3× `X-Amz-Expires=600`; credential scope `…/eu-west-1/s3` |
| 21 | Playback-report CSV example is in `us-east-1` and "expires in 2 hours" | confirmed (example only) | Line 14177 credential `…/20251008/us-east-1/s3`, `X-Amz-Expires=7200`; line 1201 |
| 22 | Media hosting outside AU is only INFERRED from examples (Summary, X25, Analysis 5) | corrected | Officially documented: "hosted in Amazon Web Services (AWS) data centers located in Ireland (eu-west-1 region)", https://help.yodeck.com/en/articles/456124-do-you-have-an-on-premise-solution. A web search found no Yodeck AU region (search results did not mention Yodeck at all; UNKNOWN beyond that) |
| 23 | Playback reports are on "Pro" or "Enterprise" plans (F9) | corrected | That is the spec's wording, quoted accurately, but the plan name is stale. The help centre says "Premium or Enterprise", https://help.yodeck.com/en/articles/455928-playback-reports. Third parties (Capterra, FitGap) also list Premium/Enterprise and do not agree on prices, which are not used here |
| 24 | Roles: "Premium Accounts do not have access to this resource"; "Requires Feature: Workspaces" | confirmed | Lines 1102 and 1110 |
| 25 | The origin of the third-party reboot path is UNKNOWN (open item) | corrected | Very probably the API Evangelist "modeled" spec, POST `/monitors/{id}/reboot/` (THIRD_PARTY, https://raw.githubusercontent.com/api-evangelist/yodeck-signage/refs/heads/main/openapi/yodeck-signage-screens-api-openapi.yml). It is self-described as modelled, so this supports R7's "not in the public v2 spec" |

Totals: 25 checked, 22 confirmed, 3 corrected, 0 refuted, 0 unverifiable. No numeric value in R7 was wrong. The corrections are about labels and provenance, and they are marked inline "[corrected in verification]".

**Does the recommendation still hold? Yes.** P1–P11 rest on spec facts that all survived re-checking: fixed summer-offset labels and alias zones (P1), floating times with no DST text (P2), integer priority and exceptions that delete events (P3), the rate-limit, 429 and paging details (P4), the webhook strengths and gaps (P5), no reboot endpoint and an account-wide push status (P6), the untyped `state` and text `storage` (P7), and free-string rotation, modeline and `fit` (P8, P9). The corrections strengthen P11 (Australian hosting as a differentiator under TINNOX's Q9). Yodeck's media hosting in AWS Ireland is now an official statement rather than an inference from an example URL. One caveat remains: the API was not called live, so wire behaviour (the trailing `Z`, the real push status scope) is still UNKNOWN.

Searches used: 4 (Yodeck hosting region; Yodeck plans and playback reports; Yodeck Australia residency; Yodeck reboot endpoint). Sources: https://capterra.com/p/228571/Yodeck/pricing/, https://us.fitgap.com/products/001707/yodeck, https://www.yodeck.com/changelog/instagram-inspiration-playback-reports/, https://apis.io/apis/yodeck-signage/yodeck-signage-screens-api/ (all THIRD_PARTY except the Yodeck changelog, which is OFFICIALLY_DOCUMENTED by search summary only).
