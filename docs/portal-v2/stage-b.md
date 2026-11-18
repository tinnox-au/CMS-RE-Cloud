# Portal v2, stage B: build spec

Date: 2026-11-16 (slice 3 added 2026-11-17, slice 4 on 2026-11-18). Stage B is built in slices. Slice 1 (playback options, time rules, rotation, image thumbnails), slice 2 (built-in apps), slice 3 (schedules) and slice 4 (layouts) are specified below, each with its as-built table. Read `README.md` in this folder first. The build follows the "ponytail" rule: the least new code that fully solves the task; every known limit is marked in code with a `shortcut:` comment.

## Stage B, slice 1: playback options, time rules, rotation, image thumbnails

Manifest v2 and player v2 carry: playlist transition and shuffle; availability windows on media; working hours per screen; rotation per screen. Separately, the media worker makes thumbnails for **images** (video posters are deferred), and thumbnails never enter the manifest. Follow the ponytail rules: reuse before adding, and mark every known limit with a `// shortcut: <limit>, <when to upgrade>` comment.

### 1. Version rule (no negotiation)
- `buildManifest` writes **v1** unless the draft needs v2. `needsV2(draft)` is true when any of these holds: `transition !== 'cut'`; `shuffle`; `rotation !== 0`; `workingHours !== null`; any item has `availableFrom` or `availableUntil` set.
- With v1 whenever possible, every unchanged screen keeps getting the same kind of document.
- A v1 player that receives v2 reports `manifest_unsupported_version` and keeps playing its last content (sync.ts:73-87). Nothing reloads a running player; it moves to v2 only when its page is reloaded by hand (release note: "reload screens after upgrading the player"). The portal says so (section 8, Overview tab).
- No request header, no Vary, no down-conversion, no capability bump. The ETag stays the publicationId.
- Comment above the choice: `// shortcut: no per-player version negotiation; a v1 player keeps old content when v2 is needed. Add a schemaVersion signal on GET /player/manifest when a non-browser route ships.`
- v2 stays open (fields may be added) until stage B closes. Record this in protocol §9.
- v2 keeps a flat top-level `assets[]` with `assetId`, so the 0004 guard, `publication_asset`, media-url authorisation and `activeItemIndex` stay valid.
- Rolling the player back below 0.2.0 after a v2 publication was activated is unsupported (the old player drops the stored v2 record and its GC empties the cache). Recovery is a server-side revert of the v2 settings and a re-push, which produces v1. Record in stage-b.md.

### 2. Migration `db/migrations/0006_stage_b_slice1.sql`
Use the 0005 header lock note. No new table, policy, trigger or FORCE change, so RLS lists, TENANT_TABLES and the 0005 guard DO blocks are not copied.
```sql
ALTER TABLE public.playlist
  ADD COLUMN transition text NOT NULL DEFAULT 'cut',
  ADD COLUMN shuffle boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT playlist_transition_known CHECK (transition IN ('cut','fade'));
ALTER TABLE public.media
  ADD COLUMN available_from timestamp(0),   -- wall clock, evaluated in each screen's site zone
  ADD COLUMN available_until timestamp(0),
  ADD COLUMN thumb_storage_key text UNIQUE,
  ADD CONSTRAINT media_availability_order CHECK (available_from IS NULL OR available_until IS NULL OR available_from < available_until),
  ADD CONSTRAINT media_thumb_storage_key_in_own_org CHECK (thumb_storage_key IS NULL OR thumb_storage_key ~ ('^' || org_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
ALTER TABLE public.display
  ADD COLUMN rotation smallint NOT NULL DEFAULT 0,
  ADD COLUMN working_hours jsonb,           -- NULL = always on
  ADD CONSTRAINT display_rotation_known CHECK (rotation IN (0,90,180,270)),
  ADD CONSTRAINT display_working_hours_shape CHECK (working_hours IS NULL OR (jsonb_typeof(working_hours)='array' AND jsonb_array_length(working_hours)=7 AND pg_column_size(working_hours) <= 1024));
GRANT UPDATE (rotation, working_hours) ON public.display TO tinnox_app;
ALTER TABLE public.publication DROP CONSTRAINT publication_manifest_shape,
  ADD CONSTRAINT publication_manifest_shape CHECK (
    jsonb_typeof(manifest) = 'object'
    AND manifest ->> 'schemaVersion' IN ('1','2')
    AND manifest ->> 'publicationId' = id::text
    AND manifest ->> 'displayId' = display_id::text
    AND jsonb_typeof(manifest -> 'assets') = 'array'
    AND jsonb_array_length(manifest -> 'assets') BETWEEN 1 AND 500
    AND pg_column_size(manifest) <= 1048576);
```
Media, playlist and playlist_item already have table-wide grants.

### 3. Contracts (packages/contracts, all `.strict()`)
**ids.ts**
- `LocalDateTimeSchema`: regex `^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}$` (year 1000+; PostgreSQL has no year 0, which would otherwise be a 500), refined so that `new Date(v+':00Z').toISOString().slice(0,16) === v`.
- `LocalTimeSchema`: `^(([01]\d|2[0-3]):[0-5]\d|24:00)$`.
- `TimeZoneSchema`: `z.string().min(1).max(64)` only. No Intl refine in the shared contract: an older player ICU must not reject a whole manifest over a zone name. The server checks the zone in buildManifest (section 4); the player fails open (section 7).

**canvas.ts**: `ROTATIONS = [0,90,180,270] as const`, `RotationSchema` (`z.union` of literals), `type Rotation`.

**display.ts**
- `DayHoursSchema = {start: LocalTimeSchema, end: LocalTimeSchema}`, refined `start < end` (string compare). '24:00' is the only way to say midnight at the end of a day.
- `WorkingHoursSchema = z.array(DayHoursSchema.nullable()).length(7)`, refined to need at least one non-null day. Index 0 is Monday; null means closed all day.
- `DisplayDtoSchema += rotation: RotationSchema, workingHours: WorkingHoursSchema.nullable()`.
- `DisplayPatchSchema += rotation: RotationSchema.optional(), workingHours: WorkingHoursSchema.nullable().optional()`.
- `DisplayCreateSchema` does not change; DB defaults apply.

**manifest.ts**
- Keep `MANIFEST_SCHEMA_VERSION = 1`; add `MANIFEST_SCHEMA_VERSION_V2 = 2`.
- Extract the current object as `manifestV1Object` and the superRefine body as `checkManifestBody(m, ctx)` (zod 4 refuses `.extend()` on a refined object). `ManifestV1Schema = manifestV1Object.superRefine(checkManifestBody)`; v1 wire format unchanged.
- `TRANSITIONS = ['cut','fade'] as const`, `TransitionSchema`.
- `ManifestAssetV2Schema = ManifestAssetV1Schema.extend({availableFrom: LocalDateTimeSchema.nullable(), availableUntil: LocalDateTimeSchema.nullable()}).strict()`.
- `ManifestV2Schema = manifestV1Object.extend({schemaVersion: z.literal(2), timeZone: TimeZoneSchema, transition: TransitionSchema, shuffle: z.boolean(), rotation: RotationSchema, workingHours: WorkingHoursSchema.nullable(), assets: z.array(ManifestAssetV2Schema).min(1).max(ABSOLUTE.maxPlaylistItems)}).strict().superRefine(...)`: checkManifestBody plus `availableFrom < availableUntil` when both set. Every field required, no defaults.
- `ManifestSchema = z.discriminatedUnion('schemaVersion', [V1, V2])` (`z.union` if zod refuses). Export `type Manifest`.
- `manifestV2Facts(m: Manifest)` returns `{transition, shuffle, rotation, workingHours, timeZone}`; for v1 `{'cut', false, 0, null, null}`.
- `parseManifest`: same version-first switch plus a branch for 2; returns `Manifest`; other versions give `unsupported_version`, message "expected 1 or 2".

**player.ts**: `ManifestResponseSchema.manifest = ManifestSchema`. Heartbeat unchanged. `activeItemIndex` stays the index into `assets`, including under shuffle.

**playlist.ts**
- `PlaylistDtoSchema += transition: TransitionSchema, shuffle: z.boolean()`.
- `PlaylistReplaceSchema += transition: TransitionSchema.optional(), shuffle: z.boolean().optional()`. Left out keeps the stored value (like `description`), so `appendToPlaylistBody`, `playlistWithMediaAppended` and e2e `savePlaylist` stay unchanged.
- `PublishResponseSchema.manifest = ManifestSchema`.

**media.ts**
- `MediaDtoSchema += availableFrom: LocalDateTimeSchema.nullable(), availableUntil: LocalDateTimeSchema.nullable()`.
- `MediaPatchSchema += both, .nullable().optional()`, refined: both keys present or both absent ("send availableFrom and availableUntil together"); from < until when both set.
- MediaJob schemas do NOT change.

**status.ts / overview.ts**: `DELIVERY_SUMMARIES += 'standing_by'` (doc: "the player holds the desired publication and reports nothing is due to show now"); `bySummaryShape += standing_by`.

**routes.ts**: `mediaThumbnailPattern: '/api/media/:id/thumbnail'` and `mediaThumbnail(id)`, beside mediaPreview.

### 4. Domain (packages/domain)
**types.ts**: `DisplayTarget += rotation, workingHours, timeZone` (from the site); `MediaRecord += availableFrom, availableUntil` (string | null); `ResolvedItem += availableFrom, availableUntil`; `PublicationDraft += transition, shuffle, rotation, workingHours, timeZone`; `PlanPublicationInput += playback: {transition, shuffle}` (required).

**playlist.ts** `buildPublicationDraft(display, items, mediaById, limits, playback)` copies the facts through, as it carries `fit`. No new refusal.

**manifest.ts**
- `needsV2(draft)` (exported; push.ts uses it).
- `buildManifest` emits v1 (exactly today's object) or v2 and self-checks against the matching schema with the existing throw. For v2 it also runs `new Intl.DateTimeFormat('en', {timeZone})`, which throws RangeError on an unknown zone, with: `// shortcut: site.timezone is seed-only and length-checked; an invalid zone throws here. Validate at site write when sites become editable.`
- `manifestAssetIds` and `manifestStorageBytes` take `Manifest`.

**push.ts**
- Inputs become `Manifest`.
- First check: `manifest.schemaVersion !== (needsV2(draft) ? 2 : 1)` gives `{kind:'playback', field:'schemaVersion'}`, so turning every v2 feature off offers a push back to v1.
- `ComparedItemField += 'availableFrom' | 'availableUntil'`, compared as `item.x !== (asset.x ?? null)` after COMPARED_ITEM_FACTS.
- Difference kind `{kind:'playback'; field:'schemaVersion'|'transition'|'shuffle'|'rotation'|'workingHours'|'timeZone'}`, checked after content_rect against `manifestV2Facts(manifest)`:
  - workingHours with a `sameHours(a, b)` helper next to `sameRect`: both null, or 7 days where each pair is both null or has equal `start` and `end`. Never `JSON.stringify` (jsonb returns keys as `{end,start}`, zod as `{start,end}`, so a stringify compare would show "changes" forever).
  - timeZone compared only when the manifest is v2.
- A stored v1 manifest compared with an all-defaults draft matches.
- Update the "Compared" doc comment.

**delivery-state.ts**: before `updating`, give `standing_by` when: not stale; `desired !== null`; `playerState === 'idle'`; `activePublicationId === null`; `downloadedPublicationId === desired.publicationId`. Comment: `// shortcut: also true for a moment between activation and the first item; a heartbeat v2 state would make it exact.`

**geometry.ts**: `stageTransform(rotation, stage: Size): {viewport: Size; prefix: string}`. For 90/270 the viewport swaps width and height. Prefix: 0 `''`; 90 `translate(${W}px,0) rotate(90deg)`; 180 `translate(${W}px,${H}px) rotate(180deg)`; 270 `translate(0,${H}px) rotate(270deg)` (W, H = stage).

### 5. API (apps/api)
**publishing.ts**
- `DISPLAY_PLAN_COLUMNS += d.rotation, d.working_hours, (SELECT s.timezone FROM site s WHERE s.id = d.site_id AND s.org_id = d.org_id) AS site_timezone`. Scalar subquery: no JOIN, FOR NO KEY UPDATE still locks only `d`. `DisplayPlanRow` follows.
- `loadPlaylistDrafts` selects `p.transition, p.shuffle`.
- `loadMediaRecords` uses `FROM media m` and the shared `MEDIA_WINDOW_COLUMNS` (below) instead of its own formatting.
- `planDraft` passes everything through.
- `loadCurrentPublications` uses `ManifestSchema.safeParse`; `LoadedPublication.manifest: Manifest`.

**routes/media.ts**
- `export const MEDIA_WINDOW_COLUMNS = \`to_char(m.available_from,'YYYY-MM-DD"T"HH24:MI') AS available_from, to_char(m.available_until,'YYYY-MM-DD"T"HH24:MI') AS available_until\``, included in `MEDIA_COLUMNS` (so playlists.ts gets it too) and imported by publishing.ts (it already imports from routes/displays.ts). Never read the raw `timestamp` (node-postgres would make a Date in the process zone).
- `toMediaDto` maps the window. PATCH writes both columns (`$n::timestamp`) when present.
- `GET mediaThumbnailPattern`: the preview handler body with `thumb_storage_key` selected. With a thumbnail, `serveObject` sends it as `image/jpeg`; otherwise the original, as /preview. Same 404 and 409 `media_not_ready`, `private, max-age=300`. Comments: `// shortcut: ETag reuses media sha256 (thumbnail is write-once); store a thumb sha if thumbnails are regenerated.` and `// shortcut: no backfill, no video posters; such media serves the original here.`
- Hard delete also deletes `thumb_storage_key`. `// shortcut: quota ignores thumbnail bytes (<=512 KiB each).`

**media/pipeline.ts**
- `#readResult` returns the verdict file's `uid` in the ok `ResultRead`.
- `#ingest`, for kind image only, after the bytes check: open `outbox/<id>.thumb.jpg` as `#readResult` does (O_NOFOLLOW, regular file), accept only when `stat.uid === verdict uid`, 1..524288 bytes, and `sniffMediaType(head) === 'image/jpeg'`. Store with `storage.put(newObjectKey(orgId), buf, {maxBytes: 524288})`. Write `thumb_storage_key` in the same ready UPDATE; the existing `finally` deletes both keys when the update did not happen.
- Any thumbnail problem: warn log and NULL. The media never fails for it; the API never decodes it (D11).
- Comment: `// shortcut: thumbnail content is worker-trusted and not tied to the source bytes; a compromised worker can inject or copy up to 512 KiB of image bytes between organisations. Upgrade by running a per-job worker that sees only one job's files.`
- `#cleanup += <id>.thumb.jpg, <id>.thumb.tmp`.

**routes/playlists.ts**: `loadPlaylistDto` maps the two columns; PUT UPDATE adds `transition = COALESCE($n::text, transition), shuffle = COALESCE($m::boolean, shuffle)`; duplicate copies both; `toPublishResponse` uses `ManifestSchema`; options in the `playlist.update` audit detail.

**routes/displays.ts**: `DisplayRow`, `DISPLAY_SELECT`, `toDisplayDto` add `rotation` and `workingHours`. PATCH keeps current values when a field is absent; `workingHours: null` clears. The audit `fields` list carries the new keys like the existing ones.

**routes/player.ts**: the manifest route parses with `ManifestSchema`. No CORS or heartbeat change.

**routes/overview.ts**: no change (it already loops over DELIVERY_SUMMARIES).

**packages/delivery**: `port.ts`, `browser-route.ts`, `test/fake-route.ts` change to `prepare(manifest: Manifest)`.

### 6. Media worker (images only)
- **inspect.ts**: accepted `Inspection += thumbnail: Buffer | null` (null for video). Image: line 100's throw-away decode becomes `.rotate().resize({width:480,height:480,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).jpeg({quality:75}).toBuffer()`; same single decode, still proves integrity, failure stays `corrupt`. No ffmpeg change.
- **main.ts**: when a thumbnail exists, write `<id>.thumb.tmp`, rename to `<id>.thumb.jpg` (mode 0644), BEFORE `writeResult`. Log `thumbBytes`. Update header lines 7-11.
- **Dockerfile**: no change. `// shortcut: no video poster frames; add an ffmpeg one-frame decode when video tiles need a still.` goes in inspect.ts.

### 7. Player v2 (apps/player-web)
**Types**: `ActiveVersionSchema` and `StagingRecordSchema` embed `ManifestSchema` (a stored v1 record survives the upgrade). Every `ManifestV1` type becomes `Manifest` (sync, staging, download, platform/media, idb-store, presenter). `PLAYER_VERSION = 'player-web/0.2.0'`.

**Clock (app.ts)**: `clockOffsetMs = Date.parse(response.serverTime) - Date.now()` on each heartbeat response, starting at 0. The playback loop gets `clock: { now: () => Date.now() + clockOffsetMs }` through the existing `PlaybackDeps.clock` (no new `now` dep). `// shortcut: offset ignores round-trip time; halve RTT if minute edges must be exact.`

**core/time-rules.ts** (new, pure)
- `localWallClock(epochMs, timeZone)` returns `{stamp:'YYYY-MM-DDTHH:mm', day:0..6 (Mon=0), time:'HH:mm'}` or `null` when Intl refuses the zone. Uses `Intl.DateTimeFormat('en-US',{timeZone, hourCycle:'h23', weekday:'short', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}).formatToParts`, one formatter cached per zone.
- `playableIndexes(manifest, epochMs)`:
  - v1: every index.
  - `epochMs < Date.parse(createdAt) - 300_000`: every index (`// fail open: clock behind the publication is untrustworthy; never blank on a dead RTC`).
  - `localWallClock` null (zone unknown to this browser's ICU): every index (same fail-open rule).
  - Outside working hours (`hours[day] === null`, or not `start <= time < end`): `[]`.
  - Otherwise indexes where `(from ?? '') <= stamp && (until === null || stamp < until)`.
- `// shortcut: an edge inside the repeated DST fall-back hour is ambiguous; upgrade if reported.`

**core/playback.ts**
- `PlaybackPosition {manifest, index, order: readonly number[], cursor}`, `index = order[cursor]` always the manifest index.
- `nextStep(current, active, {now, random})` returns `PlaybackStep | 'not_now' | null`; `PlaybackStep += playable: number` (count of playable indexes in this pass).
  - New publication: fresh order (identity, or Fisher-Yates when shuffling).
  - Walk forward skipping indexes not in `playableIndexes`.
  - End of round, shuffled: new permutation; if the first *playable* slot holds the item just shown and another playable slot exists, swap those two slots.
  - A full pass with nothing playable: `'not_now'`.
- `PlaybackDeps += random` only; `now` is `deps.clock.now`. app.ts passes `Math.random`.
- Render loop: all-failed fires when `consecutiveFailures >= step.playable` (not `assets.length`), so windows cannot hide a broken publication behind "Standing by".
- On `'not_now'`: `presenter.clear()`; emit `{type:'no_content', reason:'not_now'}`; keep `current` so coming back is not a "switch"; recheck after `idleRecheckMs`.
- `// shortcut: rules are checked at item boundaries; an item may overrun an edge by its own length. Wake the image hold at the next edge if long images are used with hours.`

**app.ts**: `no_content` reason `not_now` hides every slate (black stage, never "Waiting for content") and reports `idle` with active null. Diagnostics rows: "Time zone", "Local time there", "Clock offset", "Rotation".

**ui/presenter.ts**
- Geometry gains `rotation` (`manifestV2Facts(m).rotation`).
- `#layout`: rotation 0 keeps today's code; otherwise `stageTransform`, `canvasToViewport` with its viewport, left/top 0, `transform = prefix + ' translate(ox,oy)'` via CSSOM, `transform-origin: 0 0` in CSS.
- Fade when the manifest is v2, `transition === 'fade'`, the incoming asset is an image and the current layer is an image. In `reveal()` (not `#mount`, which is hidden until decode): add `fade-in` to the new layer and `fade-out` to the previous one, keep the previous in `#leaving` (its sha stays in `inUse()`), dispose it after 500 ms or at the next `show()`/`clear()`. First item and anything with video cut.

**styles.css**: `.layer.fade-in{animation:tx-fade-in 500ms ease-out both}` (opacity 0→1), `.layer.fade-out{animation:tx-fade-out 500ms ease-out both}` (1→0); `@media (prefers-reduced-motion: reduce){.layer.fade-in,.layer.fade-out{animation:none}}`.

**ui/screens.ts**: `// shortcut: pairing and slate screens are not rotated (rotation arrives with a publication).`

### 8. Portal (UI kit only; operators read "screen")
**Playlist editor DetailsCard**: `FormSection` "Playback": `Segmented` "Transition" (Cut | Fade), hint "Fade blends one image into the next. Videos always cut."; `Switch` "Shuffle", hint "Plays every item once per round, in a new order each round."

**Playlist editor model**: `EditorDraft += transition, shuffle` through `editorDraftFromPlaylist`, `editorIsDirty`, `validateEditorDraft`. Replace every `{...x, description: draft.description}` with `{...draft, ...x}` (playlistEditor.ts:302,324; PlaylistEditor.tsx:125,142,150). Discard dialog: "The name, description, playback settings and sequence go back…"

**Media detail** (MediaDetailForm.tsx renders, MediaEditor.tsx saves): in the existing "Playback" section, two `Field` + `TextInput type="datetime-local"` "Available from" / "Available until"; hint "Leave empty for no limit. Times are local to each screen's site."; error "Must be after Available from." Validation in `mediaDetailDraft.ts`. MediaEditor's save sends both fields together, then `push.refresh()`.

**Screen page, Working hours tab** (features/displays/detail/)
- Open the planned tab: `plannedStage: null`, add to `SCREEN_DETAIL_OPEN_TABS`, `case` in ScreenTabs.
- New `WorkingHoursTab.tsx` modelled on TagsTab: `Switch` "Always on"; when off, `FieldGroup` legend "Hours" with seven rows, each a `Checkbox` with the day name ("Monday"…"Sunday") and two `TextInput type="time"` with aria-labels "Monday start" / "Monday end". Default Mon–Fri 09:00–17:00. An end of 00:00 is saved as '24:00'. Errors "End must be after start." and "Choose at least one day, or turn on Always on." Hint "Times are in {site.timezone}. Outside these hours the screen shows black." Toast "Working hours saved", then `push.refresh()`. Draft-to-patch and validation as pure functions in `lib/screenDetail.ts`. `workingHoursDraft` joins the ScreenDetail `dirty` check.

**Canvas tab rotation** (kept out of displayForm, which the wizard shares)
- CanvasTab holds `rotation` state from `display.rotation`; `Select` "Rotation": "None", "90° clockwise", "Upside down (180°)", "90° counter-clockwise". Hint "For a screen mounted on its side or upside down. The canvas keeps its size; the player turns the picture."
- `toCanvasPatch(value, rotation)` adds `rotation`; `canvasFormDirty` also compares rotation with `display.rotation`. displayForm, `SHAPE_FIELDS`, `CANVAS_FIELD_LABELS` and the wizard do not change.

**Overview tab**: under a reported error with code `manifest_unsupported_version`, add "This player is older than these settings. Reload the player page on the screen to update it."

**Status**: `standing_by` shows as "Standing by", neutral tone, group in_sync, description "Has the latest push; nothing in it is due to show right now." screensList in_sync hint becomes "The player recently reported that it plays what was pushed, or is standing by."

**Thumbnails**: `PreviewThumb` (MediaThumb.tsx) uses `ROUTES.mediaThumbnail` for kind `image` only; video and unknown stay on `ROUTES.mediaPreview` (the kit Thumb tries video first). MediaPreview stays on /preview.

**Settings**: the planned 'working-hours' hint becomes "Default hours for new screens. Set hours per screen on its Working hours tab."

### 9. Tests (one small test per new logic)
- **contracts**: unsupported case uses version 3; 'manifest v2' describe: valid v2 accepted; rejects extra field, rotation 45, unknown transition, from >= until, a v1 document carrying a v2 field; LocalDateTime (incl. year 0000 refused, 2026-02-30 refused), WorkingHours, MediaPatch pairing; portal-v2 fixtures.
- **domain**: push.test one case per playback field, per window field, schemaVersion mismatch (v2 stored, default draft), working hours equal with jsonb key order `{end,start}` match, v1 vs default draft matches; playlist.test v1/v2 choice and v2 parses, unknown zone throws; delivery-state standing_by; geometry four rotations.
- **player**: time-rules.test (Australia/Melbourne fixed instants: DST day, '24:00', closed day, window edge, fail-open on clock, fail-open on unknown zone); playback.test (shuffle permutation per round with no boundary repeat, seeded; shuffle plus windows no repeat; window skip; 'not_now'; manifest index; windows hide some items and the rest fail gives all_failed after `playable` failures); sync.test (v2 ok, 3 unsupported); idb-store (stored v1 record loads); `makeManifest` builds v2.
- **db**: new `stage-b.integration.test.ts`: CHECK bounds; grant (exactly rotation and working_hours added; update the "nothing more" test); thumb key own-org; manifest CHECK accepts 1 and 2, refuses 3. rls.integration:777 uses 3.
- **api**:
  - publish: v1 at defaults, v2 with fade, served by /player/manifest.
  - push: rotation, hours, transition and a media window each give `changes`; set hours, push, then `up_to_date`; v1 publication matches defaults.
  - push.integration also: display PATCH round-trips rotation and workingHours; `null` clears.
  - playlists: omitted options kept; duplicate copies them.
  - library: PATCH window pairing and order errors; GET returns the stored wall-clock string unchanged.
  - upload: image thumbnail served as image/jpeg; non-JPEG, oversized or symlinked thumbnail ignored, media ready, /thumbnail falls back; video has no thumbnail; delete removes both keys. (Other-uid check: no test; cannot chown without root.)
  - cross-org and session-csrf include /thumbnail; media-worker integration: JPEG with long side <=480 for an image, none for video.
- **portal unit**: fixtures; editor dirty on options, options survive move and remove; working-hours validation (end after start, at least one day, 00:00 → 24:00); media detail window validation; `toCanvasPatch` with rotation and canvasFormDirty on rotation; screenDetail planned labels ['Alerts','Advanced']; settingsView; screenStatus standing_by.
- **e2e**: 02-canvases one 1080×1920 canvas with rotation 90 on a landscape viewport, active-layer box fills the viewport height; 03 and 04 /thumbnail 404 checks; 01-journey in_sync counter adds `by['standing_by']`.

### 10. Docs
- docs/player-protocol-v1.md: §5 manifest v2 fields and time rules; §9 version rule, "v2 open during stage B".
- New docs/portal-v2/stage-b.md: these decisions, the reload release note, the rollback rule.
- docs/portal-v2/README.md: P2-04 word list gains "Standing by"; stage table notes slice 1.
- "Standing by" also in apps/portal/README.md (word list), apps/portal/src/features/shared/README.md (word list and summary table), docs/portal-v2/design-system.md (word list).
- docs/prototype-m0.md: D11 and deviations rows (the worker writes a JPEG thumbnail for images).
- docs/security/threat-model.md T1 and docs/security/control-matrix.md B8: thumbnails are worker-trusted bytes; uid check blocks other local processes; residual: a compromised worker can inject or copy up to 512 KiB of image bytes between organisations.
- apps/player-web/README.md: Clock, Renderer, Tests.
- apps/portal/src/features/shared/README.md and apps/portal/src/ui/README.md: the thumbnail address.

### Release note and rollback (slice 1)
- Release note: **reload screens after upgrading the player.** A running player is never reloaded by the server. Until its page is reloaded, a player older than `player-web/0.2.0` that is sent a v2 manifest reports `manifest_unsupported_version` and keeps playing its last content; the screen's Overview tab tells the operator to reload the player page.
- Operations: the media worker image must be rebuilt (`npm run infra:up`) and migration 0006 applied (`npm run db:migrate`) before the API of this slice starts.
- Rollback: rolling the player back below 0.2.0 after a v2 publication was activated is unsupported. The old player drops the stored v2 record and its garbage collection empties the cache. Recover on the server: turn the v2 settings of that screen back off (transition Cut, shuffle off, rotation None, Always on, no availability windows on its media) and push again; the push then builds v1.

### As built (slice 1, 2026-11-16)
Built as specified above, except:

| Topic | Spec | As built, and why |
|---|---|---|
| Player test data (section 9) | "`makeManifest` builds v2" | `makeManifest` in `apps/player-web/src/core/fakes.test-support.ts` still builds v1, and a new `makeManifestV2` builds v2. Most player tests are about v1 behaviour, which must not change. |
| Delivery status test | not listed in any work package | `tests/integration/pairing-and-credentials.test.ts` expected `updating` for a player that had downloaded the desired publication while idle; under the `standing_by` rule that is now `standing_by`. The test now covers `updating` (nothing downloaded), then `standing_by`, then `in_sync`. No assertion was weakened. |
| Style guide | not covered | `features/styleguide/FormSections.tsx` still shows a disabled "Working hours" tab "Planned for stage B" as sample content for the disabled-tab state. |
| Media window, half-typed date (section 8) | `datetime-local` fields | A partly filled `datetime-local` reports `''`, which would have been saved as "no limit". The form stores the marker `INCOMPLETE_DATE_TIME` when the field reports `badInput`, on change and on blur, and the form refuses it with "Enter a full date and time, year 1000 or later." Changing Available from also clears the order message on Available until. |
| Working hours form error (section 8) | `FieldGroup` error | "Choose at least one day, or turn on Always on." is rendered at the end of the Hours group and is the description of the Monday checkbox, which Save focuses, so a screen reader reads it. |
| Thumbnail and verdict open (section 5) | `O_NOFOLLOW`, regular file | Also `O_NONBLOCK`, so a FIFO planted in the outbox opens at once and is refused as not a regular file instead of blocking the media loop for every organisation. Tested with a FIFO thumbnail. |
| Fade across publications (section 7) | leaving layer stays in `inUse()` | Kept; in addition `app.ts` asks for garbage collection again `FADE_MS` after the first item of a new publication, so the previous publication's last image does not stay cached until the next update. |

Open client questions (the build uses the default shown; each is a one-line change):

| Question | Default used |
|---|---|
| Hours a new screen starts with, and the account-wide default (Settings row "Working hours" stays planned) | Always on. When the operator turns Always on off, the tab proposes Monday to Friday, 09:00 to 17:00. |
| What a screen shows outside its hours | Black stage, no slate; the portal says "Standing by". No screen power control. |
| Fade length and scope | 500 ms, image to image only; video always cuts; none with reduced motion. |
| Thumbnails for media uploaded before this slice, and for video | None: no backfill, no video poster; the original is served at `/thumbnail` for them. |
| Thumbnail size and quota | Long side at most 480 px, JPEG quality 75, transparency on white; not counted against the storage quota (at most 512 KiB each). |
| Player clock trust | Fail open when the corrected clock is more than 5 minutes before the publication, or the zone is unknown: every item plays. |
| Moving players to 0.2.0 | Manual page reload per screen; no automatic reload. |

### Work packages
- **Wave 1 / WP1 Contracts, domain, delivery types.** Sections 3 and 4. Owns packages/contracts/src/{ids,canvas,display,manifest,player,playlist,media,status,overview,routes,index}.ts, contracts.test.ts, portal-v2.test.ts; packages/domain/src/{types,playlist,manifest,push,delivery-state,geometry}.ts and tests, fixtures.test-support.ts; packages/delivery/src/port.ts, src/browser/browser-route.ts, test/{fake-route,delivery.test}.ts.
- **Wave 1 / WP2 Migration 0006 and DB tests.** Section 2. Owns db/migrations/0006_stage_b_slice1.sql; packages/db/test/stage-b.integration.test.ts (new), rls.integration.test.ts (:777), portal-v2.integration.test.ts (exact-grant test).
- **Wave 1 / WP3 Media worker image thumbnails.** Section 6. Owns apps/media-worker/src/{inspect,main}.ts and unit tests, apps/media-worker/scripts/direct-check.mjs.
- **Wave 2 / WP4 API publishing, playlists, displays, player.** Section 5 except media. Owns apps/api/src/publishing.ts, routes/{playlists,displays,player,push}.ts; apps/api/test/{publish,push,playlists,player,dashboard,audit-trail}.integration.test.ts; tests/integration/migration-backfill.test.ts. Imports `MEDIA_WINDOW_COLUMNS` from routes/media.ts (WP5 adds it first thing; agree the exact name).
- **Wave 2 / WP5 API media.** Section 5 media parts. Owns apps/api/src/media/pipeline.ts, routes/media.ts; apps/api/test/support.ts, {upload,library}.integration.test.ts; tests/integration/{media-worker,cross-org,session-csrf}.test.ts.
- **Wave 2 / WP6 Player v2.** Section 7. Owns apps/player-web/src/core/{types,playback,sync,staging,download,heartbeat,time-rules}.ts and tests, core/fakes.test-support.ts, platform/{idb-store,media}.ts and idb-store.test.ts, ui/{presenter,screens,diagnostics}.ts, {app,config}.ts, styles.css; tests/e2e/02-canvases.spec.ts, tests/e2e/support/player.ts.
- **Wave 2 / WP7 Portal.** Section 8. Owns apps/portal/src/lib/{playlistEditor,screenDetail,screenDetailCanvas,screenStatus,screensList,status,settingsView,mediaDetailDraft,dashboard}.ts and tests, api/endpoints.test.ts, lib/mediaLibrary.test-support.ts and other strict DTO fixtures; features/playlists/editor/{DetailsCard,PlaylistEditor}.tsx; features/displays/detail/{WorkingHoursTab (new),ScreenTabs,ScreenDetail,CanvasTab,OverviewTab}.tsx; features/media/detail/{MediaDetailForm,MediaEditor}.tsx; features/shared/MediaThumb.tsx; features/settings/SettingsPage.tsx; tests/e2e/{01-journey,03-isolation,04-portal-details}.spec.ts.
- **Wave 3 / WP8 Docs.** Section 10. Owns every doc listed there.


---

## Stage B, slice 2: built-in apps (build spec)

Date: 2026-11-16. Read `README.md` and slice 1 of `stage-b.md` first. Ponytail rule as in slice 1: every known limit gets `// shortcut: <limit>, <when to upgrade>`.

Apps in this slice: **Clock, Date, Countdown, Ticker, QR code, Text**. They are self-contained. Nothing is fetched. Each one renders from the publication, the player's server-corrected clock and the site's time zone. An app is a row. A playlist item is media or an app. A screen still has exactly one playlist.

### 1. Version rule

- `manifestVersionFor(draft): 1 | 2 | 3` in domain manifest.ts:
  - `3` when any item has `kind === 'app'`;
  - else `2` when `needsV2(draft)`;
  - else `1`.
  - `needsV2` keeps its rule but reads windows from media items only (`item.kind !== 'app' && (item.availableFrom !== null || …)`): `ResolvedAppItem` has no window, so today's body neither type-checks nor gives the right answer (`undefined !== null`).
- **v3 = v2 plus app items.** It carries every v2 field: timeZone, transition, shuffle, rotation, workingHours, and the windows on media assets.
- **Why not "v2 stays open":** player 0.2.0 parses v2 with `.strict()` objects (contracts manifest.ts). Any new key or item shape fails as `manifest_malformed`. That error looks like a server fault, has no portal hint, and goes against protocol section 5 ("reject a schemaVersion it does not know").
  - Record in protocol section 9 (it says today that v2 "stays open while stage B is built"; that is replaced): **a new schema version is cut whenever a released player would reject the document; v2 is frozen; v3 is frozen the moment player 0.3.0 is released (its parser is `.strict()` too), so the next addition is v4.**
- **What a 0.2.0 player (or v1) does with a v3 manifest:**
  - `parseManifest` gives `unsupported_version`; sync.ts reports `manifest_unsupported_version` and keeps playing its active version.
  - With no active version it keeps its waiting slate.
  - Never a blank screen, never a partial version.
  - The portal's existing Overview hint applies unchanged: "This player is older than these settings. Reload the player page on the screen to update it."
- Removing every app from the playlist makes the draft v2 or v1 again. The push check (section 4) then reports `schemaVersion` and offers a push back.
- No header, no Vary, no negotiation. The ETag stays the publicationId. Keep the slice 1 shortcut comment.
- **Rollback:** taking a player below 0.3.0 after a v3 publication was activated is unsupported (as in slice 1). Recovery: remove the apps from the playlist and push again.

### 2. Migration `db/migrations/0007_stage_b_apps.sql`

Header in the 0006 style:

```
-- 0007: portal v2, stage B slice 2: built-in apps (docs/portal-v2/stage-b.md, slice 2). 0001 to 0006 are unchanged.
--   1. app: one row per built-in app (type fixed for life, settings checked by packages/contracts).
--   2. playlist_item: an item is a media item or an app.
--   3. publication: the manifest may be schema version 1, 2 or 3.
--   4. Row-level security and runtime grants for app.
-- Every bound has its twin in packages/contracts (APP_TYPES, APP_TEXT_LIMITS, ABSOLUTE).
-- Takes ACCESS EXCLUSIVE locks on playlist_item and publication until commit and re-reads every
-- publication row to validate the new CHECK; run it while the API is stopped or idle.
```

```sql
-- 1. app
CREATE TABLE public.app (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organization (id),
  -- Fixed for life: the runtime role has no UPDATE grant on it.
  type        text NOT NULL,
  name        text NOT NULL,
  description text,
  -- Validated by AppContentSchema in packages/contracts before every write.
  settings    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  CONSTRAINT app_type_known CHECK (type IN ('clock','date','countdown','ticker','qr','text')),
  CONSTRAINT app_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT app_name_trimmed CHECK (name = btrim(name)),
  CONSTRAINT app_description_length CHECK (char_length(description) BETWEEN 1 AND 500),
  CONSTRAINT app_settings_shape CHECK (jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 4096)
);
CREATE INDEX app_org_idx ON public.app (org_id, created_at);
CREATE TRIGGER app_set_updated_at BEFORE UPDATE ON public.app
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. playlist_item: exactly one of media_id and app_id. An app item has a duration and no fit.
ALTER TABLE public.playlist_item
  ALTER COLUMN media_id DROP NOT NULL,
  ADD COLUMN app_id uuid,
  ADD CONSTRAINT playlist_item_app_fk FOREIGN KEY (app_id, org_id) REFERENCES public.app (id, org_id),
  ADD CONSTRAINT playlist_item_one_source CHECK (num_nonnulls(media_id, app_id) = 1),
  ADD CONSTRAINT playlist_item_app_shape CHECK (app_id IS NULL OR (duration_ms IS NOT NULL AND fit IS NULL));
CREATE INDEX playlist_item_app_idx ON public.playlist_item (app_id) WHERE app_id IS NOT NULL;

-- 3. publication
ALTER TABLE public.publication DROP CONSTRAINT publication_manifest_shape,
  ADD CONSTRAINT publication_manifest_shape CHECK (
    jsonb_typeof(manifest) = 'object'
    AND manifest ->> 'schemaVersion' IN ('1','2','3')
    AND manifest ->> 'publicationId' = id::text
    AND manifest ->> 'displayId' = display_id::text
    AND jsonb_typeof(manifest -> 'assets') = 'array'
    AND jsonb_array_length(manifest -> 'assets') BETWEEN 1 AND 500
    AND pg_column_size(manifest) <= 1048576);

-- 4. RLS and grants
ALTER TABLE public.app ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.app
  USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id());
GRANT SELECT, INSERT, DELETE ON public.app TO tinnox_app;
GRANT UPDATE (name, description, settings) ON public.app TO tinnox_app;
-- playlist_item already has table-wide grants (covers app_id).
```

End the file with the two 0005 final-check DO blocks, unchanged except `ARRAY['app']` in the tenant-policy check: forced RLS on every public table, tenant policy present, no disabled trigger.

Deleting an app that a playlist uses fails on `playlist_item_app_fk` (23503). Publications hold a copy of the settings, not a reference, so deleting an app never touches a publication.

### 3. Contracts (packages/contracts, all objects `.strict()`)

**ids.ts:** `AppIdSchema = UuidSchema`, `type AppId`.

**text.ts:** `appTextSchema(max, what, { required = false, multiLine = false })`:
- `z.string().trim()`;
- `.min(1, \`${what} is required\`)` when required;
- `.max(max)`;
- `.regex(multiLine ? MULTI_LINE : SINGLE_LINE, \`${what} must not contain control characters\`)`;
- `.regex(NO_DIRECTION_CONTROLS, \`${what} must not contain text-direction characters\`)`.
- No null transform: empty optional text is stored as `''`.

**app.ts (new; export from index.ts):**
- `APP_TYPES = ['clock','date','countdown','ticker','qr','text'] as const`, `AppTypeSchema`, `type AppType`.
- `APP_TEXT_LIMITS = { countdownLabel: 60, finishedText: 60, tickerText: 300, qrContent: 300, qrCaption: 80, heading: 60, body: 280 } as const`.
- `ColourSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'expected a colour like #ffffff')`. Lower case only: `<input type="color">` always gives lower case.
- `const style = { textColour: ColourSchema, backgroundColour: ColourSchema }`.
- `ClockSettingsSchema = z.object({ hourCycle: z.enum(['12','24']), showSeconds: z.boolean(), ...style })`.
- `DATE_FORMATS = ['long','short','numeric'] as const`; `DateSettingsSchema = z.object({ format: z.enum(DATE_FORMATS), ...style })`.
- `CountdownSettingsSchema`:
  - `target: LocalDateTimeSchema`;
  - `label: appTextSchema(60,'label')`;
  - `finishedText: appTextSchema(60,'finished text',{required:true})`;
  - `showSeconds: z.boolean()`;
  - `...style`.
- `TICKER_SPEEDS = ['slow','medium','fast'] as const`; `TickerSettingsSchema = { text: appTextSchema(300,'text',{required:true}), speed: z.enum(TICKER_SPEEDS), ...style }`.
- `QrSettingsSchema = { content: appTextSchema(300,'content',{required:true}), caption: appTextSchema(80,'caption'), ...style }`.
- `TextSettingsSchema = { heading: appTextSchema(60,'heading'), body: appTextSchema(280,'message',{multiLine:true}), ...style }`:
  - refined: heading or body is non-empty;
  - issue path `['heading']`, message `'enter a heading or a message'`.
- Invariant (doc comment): **settings objects are flat (string and boolean values only).** The push comparison relies on it.
- `AppContentSchema = z.discriminatedUnion('type', [ {type: z.literal('clock'), settings: ClockSettingsSchema}, … ])`: six strict members. `type AppContent`. Every field is required; there are no defaults.
- `AppDtoSchema = { id: AppIdSchema, name: z.string(), description: DescriptionSchema.nullable(), content: AppContentSchema, usageCount: int nonneg (live playlists containing it), createdAt, updatedAt }`.
- `AppListResponseSchema = { items: z.array(AppDtoSchema).max(ABSOLUTE.maxListItems) }`.
- `AppCreateSchema = { name: NameSchema, description: DescriptionInputSchema.optional(), content: AppContentSchema }`.
- `AppPatchSchema = { name: NameSchema.optional(), description: DescriptionInputSchema.optional(), content: AppContentSchema.optional() }`, refined so at least one key is present ("send at least one field").

**manifest.ts**
- Add `MANIFEST_SCHEMA_VERSION_V3 = 3`.
- Extract the unrefined v2 object as `manifestV2Object`, as slice 1 did for v1. `ManifestV2Schema` stays byte-for-byte the same on the wire.
- `ManifestAppItemSchema = z.object({ kind: z.literal('app'), appId: AppIdSchema, durationMs: z.number().int().positive().max(ABSOLUTE.maxItemDurationMs), content: AppContentSchema }).strict()`. There is no `assetId` on purpose.
- `ManifestItemV3Schema = z.union([ManifestAssetV2Schema, ManifestAppItemSchema])`.
- `ManifestV3Schema = manifestV2Object.extend({ schemaVersion: z.literal(3), assets: z.array(ManifestItemV3Schema).min(1).max(ABSOLUTE.maxPlaylistItems) }).strict().superRefine(...)`:
  - the repeated-assetId and window-order checks run over media items only;
  - change `checkManifestBody` to skip `kind === 'app'`.
- `type ManifestItem = ManifestAssetV1 | ManifestAssetV2 | ManifestAppItem`.
- `isMediaItem(item): item is ManifestAssetV1 | ManifestAssetV2` (`item.kind !== 'app'`).
- `ManifestSchema` gains V3. `manifestV2Facts` handles v3 like v2 (its body already tests `=== 1`).
- `parseManifest`: case 3; the message becomes "expected 1, 2 or 3".

**playlist.ts**
- `PlaylistMediaItemInputSchema`: today's `{mediaId, durationMs, fit}`, unchanged.
- `PlaylistAppItemInputSchema = { appId: AppIdSchema, durationMs: positive int max ABSOLUTE.maxItemDurationMs }`.
- `PlaylistItemInputSchema = z.union([media, app])`. Clients that only send media items (e2e `savePlaylist`) keep working. The two portal read-modify-write clients do NOT: `appendToPlaylistBody` (lib/mediaDetailDraft.ts:397) and `playlistWithMediaAppended` (lib/mediaLibraryActions.ts:45) rebuild every existing item as `{mediaId, …}` from the DTO (the first reads `item.media.kind`), so "Add to playlist" would throw or send an invalid body for any playlist holding an app. Both must carry app items as `{appId, durationMs}` (WP6).
- `PlaylistItemDtoSchema = z.union([PlaylistMediaItemDtoSchema (today's shape), PlaylistAppItemDtoSchema {id, position, appId, durationMs: positive int, app: AppDtoSchema}])`.
- `PLAYLIST_ITEM_KINDS = ['image','video','app'] as const`; `PlaylistSummaryDto.kinds = z.array(z.enum(PLAYLIST_ITEM_KINDS)).max(3)`. `previewMediaIds` stays media only.
- `PUBLISH_REJECTION_CODES += 'app_missing'`.

**audit.ts:** `AUDIT_ACTIONS += 'app.create','app.update','app.delete'`; `AUDIT_CATEGORIES += 'app'`.

**errors.ts:** `API_ERROR_CODES += 'app_in_use'`.

**routes.ts:** `apps: '/api/apps'` (GET, POST); `appPattern: '/api/apps/:id'` (GET, PATCH, DELETE); `app(id)`.

### 4. Domain (packages/domain)

**types.ts**
- `AppRecord { id; content: AppContent }`.
- `DraftItem = DraftMediaItem (today's {mediaId,durationMs,fit}) | DraftAppItem {appId; durationMs: number}`, plus `isAppDraftItem(i)` (`'appId' in i`).
- `ResolvedItem = ResolvedMediaItem (today's interface, renamed) | ResolvedAppItem { kind: 'app'; appId; durationMs; content }`.

**playlist.ts**
- `validatePlaylist(items, mediaById, appsById, limits, options)`. For app items:
  - missing app: `app_missing`, "Item n refers to an app that does not exist or was deleted.";
  - duration outside `minImageItemDurationMs..maxImageItemDurationMs`: `duration_out_of_range`, "Item n has a duration of X s; apps must be shown for 1 s to 3600 s." (reuse `seconds()`);
  - the media rules are unchanged.
- `buildPublicationDraft(display, items, mediaById, appsById, limits, playback)` resolves an app item to `{kind:'app', appId: app.id, durationMs, content: app.content}`.
- `PlanPublicationInput += appsById`.

**capability.ts:** at the top of the item loop, `if (item.kind === 'app') return;` with `// shortcut: every route is the browser route, which draws apps; add apps to CapabilityProfile when a route that cannot draw them ships.`

**manifest.ts**
- `buildManifest`:
  - v1 and v2 as today, built from media items;
  - for v3: the v2 object with `schemaVersion: 3`, media items as v2 assets (with windows), app items as `{kind:'app', appId, durationMs, content}`;
  - the Intl zone check runs for v2 and v3;
  - self-check through `ManifestSchema`.
- `manifestAssetIds` and `manifestStorageBytes` filter with `isMediaItem`.

**push.ts**
- First check: `manifest.schemaVersion !== manifestVersionFor(draft)`.
- `ComparedItemField += 'appId' | 'content'`; `COMPARED_ITEM_FACTS` is typed against `ResolvedMediaItem`.
- Per index:
  - if either side is an app and the kinds differ, `{kind:'item', field:'kind'}`;
  - both apps: compare `appId` (case-insensitive), then `durationMs`, then `sameContent(a, b)`;
  - `sameContent` is true when the types are equal and both settings objects have the same key set with `===` values, next to `sameHours`;
  - never `JSON.stringify`: jsonb reorders keys.
- Update the "Compared" doc comment.

### 5. Shared renderer `packages/app-render` (new workspace package `@tinnox/app-render`)

- `package.json`:
  - `exports: {".": "./src/index.ts"}`;
  - dependencies: `@tinnox/contracts`, `uqr` `"0.1.3"` (exact; checked with `npm view` on 2026-11-16: MIT, no dependencies, ESM `dist/index.mjs` with `index.d.mts` types; `encode(text, {ecc, border})` returns `{version, size, data: boolean[][]}`, `border` defaults to 1, so `border: 0` is required for `size` to be the module count);
  - script `typecheck`.
- `tsconfig.json`: `{"extends":"../../tsconfig.web.json","compilerOptions":{"types":[]},"include":["src"]}`.
- Unit tests run in node, so pure modules are kept apart from DOM modules.
- Header comment: "Draws built-in apps for the player and the portal preview. No network, no innerHTML, no style attribute: text via textContent, styles via `style.setProperty`, motion via the Web Animations API."

| File | Contents |
|---|---|
| `src/index.ts` | exports `renderApp`, `AppEnv`, `AppView`, `wallToEpoch`, `countdownText` |
| `src/text.ts` (pure) | `formatter(timeZone: string \| null, options): Intl.DateTimeFormat`. Locale `en-AU`, cached per zone and options. On `RangeError` it falls back to no `timeZone` (the device zone): `// fail open: an old ICU must not blank an app`. `clockText(epochMs, zone, {hourCycle, showSeconds})` uses `hour:'numeric', minute:'2-digit', second?:'2-digit', hourCycle:'h12'\|'h23'`. `dateText(epochMs, zone, format)`: long `{weekday:'long',day:'numeric',month:'long',year:'numeric'}`, short `{weekday:'short',day:'numeric',month:'short'}`, numeric `{day:'2-digit',month:'2-digit',year:'numeric'}`. `countdownText(remainingMs, showSeconds): string \| null` (null when `remainingMs <= 0`): unit 1 s or 1 min; `total = ceil(remainingMs/unit)`; `d` days, then `HH:MM[:SS]`, two digits each; prefix `"1 day "` or `"N days "` when d ≥ 1. |
| `src/zone.ts` (pure) | `wallToEpoch(stamp, timeZone \| null): number`. Two passes: `g = Date.parse(stamp+':00Z')`; `o1 = offset(g)`; `t = g - o1`; `o2 = offset(t)`; `return o2 === o1 ? t : g - o2`. `offset(e)` is the wall clock of `e` read as UTC minus `e` (read with `formatToParts` and `hourCycle: 'h23'`, as player core/time-rules.ts does; `hour12: false` can give "24"). With a null or unknown zone: `new Date(stamp).getTime()` (device zone). `// shortcut: a target inside the skipped DST hour moves by an hour, and one inside the repeated hour is ambiguous; upgrade if reported.` |
| `src/fit.ts` | pure `searchFontSize(fits: (px:number)=>boolean, min:number, max:number): number`: 10-step binary search, returns the largest fitting size, or `min`. DOM `fitText(el, box, {max, min}) : boolean` (true = overflowing at `min`): sets `font-size`, checks `el.scrollWidth <= box.clientWidth && el.scrollHeight <= box.clientHeight`. |
| `src/qr.ts` (pure) | `qrPath(content): {size: number; d: string}` uses `uqr` `encode(content, {ecc:'M', border: 0})`. `d` is one `M x y h1v1h-1z` per dark module. |
| `src/render.ts` (DOM) | `renderApp` and the six builders |

```ts
export interface AppEnv {
  now(): number;                 // player: corrected clock; portal: Date.now
  timeZone: string | null;       // manifest timeZone; portal: null (this computer's zone)
  reducedMotion: boolean;
  onOverflow?(overflowing: boolean): void; // portal preview warning
}
export interface AppView {
  readonly element: HTMLElement; // fills its container (position:absolute; inset:0)
  readonly ready: Promise<void>; // resolves after the first fit (first ResizeObserver callback)
  dispose(): void;               // clears timers, cancels animations, disconnects observers
}
export function renderApp(content: AppContent, env: AppEnv): AppView;
```

Behaviour common to all six:
- The root is a `div` with `position:absolute; inset:0; overflow:hidden; display:flex; align-items:center; justify-content:center; text-align:center; box-sizing:border-box; padding: 4% (of the short side, in px)`, the background colour, the text colour, `font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`, `font-weight: 700`, `line-height: 1.15`, `font-variant-numeric: tabular-nums`.
- All sizes come from the root's own box, so the result is the same at preview scale and on the screen.
- A `ResizeObserver` on the root re-fits.
- Clock, Date and Countdown use one self-correcting timer to the next whole second of `env.now()`. Text is rewritten only when it changes, and re-fitted only when its length changes.
- Minimum font size is `shortSide/12`. Text that does not fit at that size first has its over-long words broken anywhere (a URL, a run of letters), then shrinks to at most half that size, so it is shown whole rather than clipped; `onOverflow(true)` is called whenever it went below `shortSide/12`. Only text that does not fit even at `shortSide/24` is clipped. `// shortcut: the readability floor is 1/12 of the short side; tune per pixel pitch if reported.` (Changed after frontend review round 2, FCU-02.)

Per type:
- **Clock:** one line, `white-space:nowrap`, fitted with max = 0.8 × box height.
- **Date:** as Clock, with `dateText`.
- **Countdown:**
  - optional label line (fitted, max 0.25 × height) above a value line (fitted, max 0.6 × height);
  - target epoch = `wallToEpoch(target, env.timeZone)`, computed once;
  - once `remaining <= 0` it shows `finishedText` permanently (no count-up) and stops the timer.
  - DST is handled because remaining time is the difference of two instants.
- **Ticker:**
  - font size 0.6 × box height, capped at 0.25 × box width; the line is centred vertically;
  - a track holds enough copies of `text` plus a 2 em gap to cover box width plus one copy;
  - `track.animate([{transform:'translateX(0)'},{transform:\`translateX(-${copyWidth}px)\`}], {duration: copyWidth / (factor × fontPx) × 1000, iterations: Infinity, easing: 'linear'})`, with factor slow 2, medium 3, fast 4.5;
  - restarted on resize;
  - with `reducedMotion`: no animation; the text is shown still and fitted like a Text body (wrapping allowed).
- **QR code:**
  - SVG built with `createElementNS`: `viewBox="-4 -4 size+8 size+8"`, `shape-rendering="crispEdges"`, a white `rect` covering the quiet zone, one black `path`;
  - modules are always black on white whatever the colours (inverted codes do not scan);
  - `aria-hidden="true"` on the SVG;
  - layout: box aspect ≥ 1.6 puts the code on the left (square side = 0.9 × height) and the caption on the right; otherwise the code is on top (at most 80% of height when there is a caption) and the caption below; with no caption the code is centred;
  - `// shortcut: no warning when a module is under 2 canvas pixels; add one if codes fail to scan.`
- **Text:** heading line (nowrap, larger) over the body (wraps, `white-space: pre-line`), both fitted, with the heading max at 1.6 × body size. Empty parts are left out.

Build check `src/build-checks.test.ts` reads every `src/*.ts` and fails on `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setAttribute('style'`, `cssText`, `fetch(`, `XMLHttpRequest`, `import(`.

WP3 adds `"@tinnox/app-render": "*"` to `apps/player-web/package.json` and `apps/portal/package.json` and runs `npm install` once. It owns `package-lock.json`.

### 6. API (apps/api; every route inside the operator scope, so session, CSRF and exact Origin apply; org only from `session.orgId` and `app_org_id()`; the global 600/min rate limit, like tags and folders)

**routes/apps.ts (new), `registerAppRoutes`, registered after media in app.ts.**
- `export const APP_COLUMNS`: `a.id, a.type, a.name, a.description, a.settings, a.created_at, a.updated_at, (SELECT count(DISTINCT i.playlist_id) FROM playlist_item i JOIN playlist p ON p.id=i.playlist_id AND p.org_id=i.org_id WHERE i.app_id=a.id AND i.org_id=a.org_id AND p.deleted_at IS NULL) AS usage_count`.
- `toAppDto(row)` parses `{type, settings}` with `AppContentSchema`. A failure throws (stored data is always validated).
- **GET /api/apps** gives `{items}` ordered by `lower(name), id`.
- **POST /api/apps** takes `AppCreateSchema` and answers 201 with an AppDto. Audit `app.create`, detail `{type}`.
- **GET /api/apps/:id** gives an AppDto, or 404 "The app was not found." (existing `notFound('The app')`).
- **PATCH /api/apps/:id** takes `AppPatchSchema`:
  - `SELECT … FOR UPDATE`;
  - if `content.type !== row.type`: 400 `validation_failed` "An app's type cannot be changed." (path `content.type`);
  - updates only the fields sent;
  - audit `app.update`, detail `{fields: [...]}`; never settings text.
- **DELETE /api/apps/:id**:
  - lock the row;
  - live playlists using it (names, limit 5): 409 `app_in_use` "This app is used in a playlist. Remove it from the playlist first.", with details `{path:'playlist', message: name}`;
  - otherwise `DELETE`, then audit `app.delete`, detail `{type}`, then 204;
  - 23503 (race): 409 `app_in_use` "This app has just been added to a playlist. Try again."

**publishing.ts**
- `loadPlaylistDrafts` selects `app_id` and builds `DraftAppItem` when `app_id` is not null.
- New `loadAppRecords(tx, ids, lock)`: `SELECT id, type, settings FROM app WHERE org_id = app_org_id() AND id = ANY($1::uuid[]) ${lock ? 'FOR KEY SHARE' : ''}`. A row that fails `AppContentSchema` is left out, so it surfaces as `app_missing` and never as a 500 for the whole push plan.
- `planDraft` passes `appsById`; `assessDisplays` loads the apps of all drafts in one query.
- `createPublication`: `publication_asset` rows for media positions only:
  `INSERT … SELECT $1, t.position, app_org_id(), t.media_id FROM unnest($2::int[], $3::uuid[]) AS t(position, media_id)`, using `manifest.assets.flatMap((a, i) => isMediaItem(a) ? [[i, a.assetId]] : [])`.
  The 0004 guard still checks `assets -> position ->> 'assetId'`.

**routes/playlists.ts**
- `loadPlaylistDto`: `LEFT JOIN media m …` and `LEFT JOIN app a …`; map to the union DTO.
- List: the LATERAL uses `LEFT JOIN media`, sums `CASE WHEN i.app_id IS NOT NULL THEN i.duration_ms WHEN m.kind='image' THEN COALESCE(i.duration_ms,0) ELSE COALESCE(m.duration_ms,0) END`, and adds `bool_or(i.app_id IS NOT NULL) AS has_app`. Preview ids use `WHERE i.media_id IS NOT NULL`.
- PUT: `loadAppRecords(…, true)`, then `validatePlaylist(…, appsById, …)`. Insert `media_id` and `app_id` from parallel arrays (`unnest($2::uuid[], $3::uuid[], $4::int[], $5::text[])`). The 23503 message becomes "A file or app in this playlist was deleted meanwhile. Reload and try again."
- Duplicate copies `app_id`. Publish passes `appsById`.

**Worst case:** 500 tickers of 300 three-byte characters are about 550 KB of JSON, under the 1 MiB CHECK. Tested (section 9); there is no runtime check.

### 7. Player 0.3.0 (apps/player-web)

- `PLAYER_VERSION = 'player-web/0.3.0'` (config.ts).
- `core/types.ts`:
  - `uniqueAssets` and `manifestHashes` filter with `isMediaItem`;
  - a publication with only apps stages with zero downloads and activates without calling `/player/media-urls`.
- `core/time-rules.ts`:
  - `if (manifest.schemaVersion === 1) return all;` (was `!== 2`);
  - window filter: `asset.kind === 'app' || (window check)`;
  - working hours apply to apps.
- `core/playback.ts`:
  - `Presenter.show(item: ManifestItem, …)`;
  - `holdTimeMs`: app gives `durationMs`;
  - error assetId is `isMediaItem(item) ? item.assetId : null`;
  - an app hold is like an image hold (`finished: null`, can be woken).
- `ui/presenter.ts`:
  - constructor gains `now: () => number` (app.ts passes the corrected clock);
  - `Layer.sha256: string | null`, and `inUse()` skips null;
  - for an app item: `renderApp(item.content, { now, timeZone: manifest.schemaVersion === 1 ? null : manifest.timeZone, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches })`;
  - the view's element goes in a `layer pending` holder with `data-kind="app"` and `data-app-type`;
  - before mounting an app, apply the geometry, `#layout()` and unhide the canvas (today that happens only after `ready`). The canvas is `hidden` (display:none) before the first item and after `clear()`, and a ResizeObserver never reports a 0×0 box, so `view.ready` would never resolve and the first app after boot or after working hours would always time out;
  - wait for `view.ready` under `READY_TIMEOUT_MS`;
  - dispose calls `view.dispose()`;
  - a failure becomes `PlayerFault('playback_error', 'app could not be drawn')`, counted like any item failure (all apps failing gives `all_failed`, as in v1);
  - apps always cut; fade stays image to image.
- **Time:**
  - Clock, Date and Countdown use the corrected clock in the manifest zone;
  - an unknown zone falls back to the device zone;
  - offline, the last offset is kept while the page runs; after a reload offline the device clock is used: `// shortcut: clock offset is not persisted; store it in idb if screens reboot offline with bad clocks.`
- **Reduced motion:** honoured (ticker still). Kiosk browsers normally do not set it, so tickers scroll.
- No styles.css change: the renderer styles itself.
- Diagnostics: no new row.

### 8. Portal

- **nav.ts:** the Apps entry loses `planned`. Remove `apps` from `PlannedSection` and `PLANNED` (both in features/planned/PlannedPage.tsx). App.tsx: `page('apps', appsPage, …)` and `page('apps/:id', appEditor, …)` with `PerObject`.
- **endpoints.ts:** `listApps`, `getApp`, `createApp(input)`, `patchApp(id, patch)`, `deleteApp(id)`.
- **lib/apps.ts (pure, tested):**
  - `APP_TYPE_LABELS` (Clock, Date, Countdown, Ticker, QR code, Text);
  - `APP_TYPE_DESCRIPTIONS`:
    - Clock: "The current time at the screen's site."
    - Date: "Today's date at the screen's site."
    - Countdown: "Time left until a date and time you choose."
    - Ticker: "A line of text that scrolls across the screen."
    - QR code: "A code people scan with a phone camera."
    - Text: "A heading and a short message."
  - `defaultContent(type, nowMs)`:
    - colours `#ffffff` on `#000000`;
    - clock `{hourCycle:'12', showSeconds:false}`;
    - date `long`;
    - countdown target 7 days ahead at 09:00 (browser local), label "Opening in", finished text "Now open", seconds on;
    - ticker "Welcome to TINNOX", medium;
    - QR `https://tinnox.com.au`, caption "Scan me";
    - text heading "Welcome", body "".
  - `AppDraft`, `appDraftFromDto`, `appIsDirty`, `validateAppDraft(draft): {ok, value: AppPatch} | {ok:false, errors}`;
  - `contrastWarning(text, bg): string | null`, using `parseColour` and `contrastRatio` from lib/contrast.ts, threshold 4.5;
  - `previewShapes(displays)`.
- **Apps list (`features/apps/AppsPage.tsx`, list pattern):**
  - `SearchField` "Search apps", a `Select` "Type" (All types and the six), the count "N apps", a refresh icon button, and the primary "Create app" at the right of the filter row;
  - table columns: type icon plus the name as a link, Type, "Used in" ("2 playlists" or "Not used"), Updated, and a row menu (Edit, Delete);
  - empty state: "No apps yet" / "Apps show a clock, the date, a countdown, scrolling text, a QR code or a message, drawn by the screen itself." / "Create app";
  - no-results state with "Clear filters";
  - `// shortcut: no grid, bulk selection or pagination; add when an organisation has over 100 apps.`
- **Create dialog (`CreateAppDialog.tsx`, Dialog 640):**
  - radio-card group labelled "Type" (arrow keys move, Space or Enter selects), each card with its icon, label and description;
  - `Field` "Name", prefilled with the type label until edited;
  - buttons Cancel and "Create app";
  - POST with `defaultContent`, then navigate to `/apps/:id`, toast "App created".
- **Editor (`AppEditor.tsx` in `EditorPage`; back "Apps"; Cancel and Save; "Unsaved changes"; `useLeaveGuard`; delete in the header menu):**
  - **Details card:**
    - `CanvasFrame` (new size `xl`, 360 px, one CSS rule) with the child `AppPreview`. AppPreview mounts `renderApp` into a ref in `useEffect`, disposes on every change, and passes `reducedMotion` from `useMediaQuery('(prefers-reduced-motion: reduce)')` and `timeZone: null`.
    - The frame's label: "Preview of this app on a W × H canvas."
    - `Select` "Preview on": "Landscape 1920 × 1080" (default), "Portrait 1080 × 1920", then each screen "{name} · W × H" with its content rectangle.
    - For time-based types: "Times in this preview use this computer's time zone ({zone}). Each screen uses its site's time zone."
    - On overflow: `Banner` warn "The text does not fit this screen shape at a readable size, so it is shown smaller. Shorten the text or preview another shape."
    - Facts: Type, Used in, Created, Updated.
  - **Settings card:**
    - section "Details": Name, Description;
    - type section:
      - Clock: `Segmented` "Time format" (12-hour | 24-hour), `Switch` "Show seconds";
      - Date: `Segmented` "Format", options labelled with today's date in each format;
      - Countdown: "Counts down to" (`datetime-local`, hint "Local time at each screen's site.", the `INCOMPLETE_DATE_TIME` handling from mediaDetailDraft), "Label" (hint "Shown above the time, for example "Sale ends in"."), "When it ends, show", `Switch` "Show seconds", and a past-target info Banner "This moment has passed; screens show the finished text.";
      - Ticker: "Text" (hint "Scrolls from right to left. Give the playlist item a duration long enough for the text to pass once."), `Segmented` "Speed" (Slow | Medium | Fast);
      - QR code: "Content" (hint "A web address or any short text. Short content makes a code that is easier to scan from a distance."), "Caption (optional)";
      - Text: "Heading", "Message" (Textarea);
    - section "Style": `TextInput type="color"` "Text colour" and "Background colour", with the contrast warning Banner (warning only): "The text and background colours are hard to tell apart ({r}:1). Choose colours with more contrast; 4.5:1 or more reads well from a distance."
  - **Messages:**
    - "Enter a name."
    - "Enter the text to scroll."
    - "Enter what the code should hold, such as a web address."
    - "Enter a heading or a message."
    - "Enter what to show when the countdown ends."
    - "Use at most N characters."
    - "Enter a full date and time, year 1000 or later."
    - Server field errors map by path.
  - Save: toast "App saved", then `push.refresh()`. The Banner summary links to the fields.
  - Delete: ConfirmDialog "Delete {name}?" / "The app is removed for good. Screens that already show it keep it until their next push." / "Delete app". `app_in_use` shows the error and the playlist names.
- **Playlist editor:**
  - `DraftItem` becomes a union on `source: 'media' | 'app'`, with helpers `itemRefId` and `itemName`;
  - `draftSignature`, `carryItemKeys` and `validateDraft` handle apps (duration parsed with the image rule; default `DEFAULT_IMAGE_SECONDS` '10');
  - LibraryCard: title "Add media or apps"; chips All | Images | Videos | Apps; All lists apps after media only when no folder or tag filter is set; with Apps chosen the folder and tag controls are disabled; search matches the app name; app tiles are a button with a type icon tile (no thumbnail), the name and the type label;
  - SequenceTile for an app: icon, name, type, duration stepper, no fit menu;
  - discard dialog wording unchanged;
  - `PlaylistMosaic` takes `kinds: readonly PlaylistItemKind[]` and ignores `app` (no list labels kinds as text today; an app-only playlist shows the placeholder tile).
- **Other places that assume every item is media:**
  - lib/screenDetail.ts `assignedContent` reads `item.media` for every item: loop length adds an app's `durationMs`; preview ids and kind map skip apps; `kinds` becomes `PlaylistItemKind[]`; `first` gains an app variant `{app: AppDto, name}` with state `ready`;
  - features/displays/detail/AssignedPreview.tsx draws an app `first` with `AppPreview` (`timeZone: null`) instead of `MediaThumb`;
  - lib/mediaDetailDraft.ts `appendToPlaylistBody` and lib/mediaLibraryActions.ts `playlistWithMediaAppended` keep app items as `{appId, durationMs}` (see section 3).
- **Audit view:** labels "App created", "App updated", "App deleted" (the house pattern, as "Folder created"); target kind `app` links to `/apps/:id` (useAuditNames.ts gets a `case 'app'` reading `listApps`); category label "Apps". lib/activity.ts `WORDING` is typed `[K in AuditAction]`, so the dashboard activity feed needs the three app wordings too (no new activity object kind).
- Wording rules (P2-03 and P2-04) are unchanged. Everything is reachable and labelled by keyboard. No inline style attribute; geometry goes through `cssVars` or CSSOM.

### 9. Tests

- **contracts:**
  - every settings schema: valid, each bound, uppercase colour refused, control and direction characters refused, Text with both parts empty refused;
  - `AppContentSchema` refuses a mismatched type and settings pair;
  - v3 manifest: accepted; app item with `assetId` refused; extra key refused;
  - `ManifestV2Schema` refuses an app item (documents the v3 decision);
  - `parseManifest(4)` gives unsupported;
  - playlist item input union (fit on an app item refused);
  - portal-v2 fixtures.
- **domain:**
  - `manifestVersionFor` gives 1, 2 and 3;
  - `buildManifest` v3 parses and positions are kept;
  - `manifestAssetIds` skips apps;
  - push: settings change, duration change, app swapped for media (field `kind`), jsonb key order matches, removing the last app offers `schemaVersion`;
  - validatePlaylist `app_missing` and app duration range;
  - checkCapabilities skips apps;
  - worst-case JSON size (500 tickers × 300 '€') under 600 KB.
- **app-render (node):**
  - `clockText` 12 and 24 hour in Australia/Melbourne at fixed instants;
  - `dateText` contains day, month and year;
  - `countdownText` with ceil rounding, "1 day", and null at 0;
  - `wallToEpoch`: Melbourne '2026-12-25T09:00' gives 2026-12-24T22:00Z; '2026-07-01T09:00' gives 2026-06-30T23:00Z; gap '2026-10-04T02:30' is ±1 h; unknown zone does not throw;
  - `searchFontSize` monotone;
  - `qrPath('HELLO').size === 21`;
  - build checks.
- **db** (`stage-b-apps.integration.test.ts`):
  - app CHECKs;
  - grants exactly as listed (no UPDATE on type, org_id or id); update the "nothing more" test;
  - playlist_item one-source, app shape, and cross-org app FK refused;
  - deleting a used app gives 23503;
  - manifest CHECK accepts 3 and refuses 4 (rls.integration :777 moves from 3 to 4; stage-b.integration "accepts schema versions 1 and 2 and refuses 3" becomes 1 to 3 and refuses 4);
  - publication_asset guard with a v3 manifest (app at 0, media at 1): row at 1 accepted, row at 0 refused;
  - a worst-case v3 manifest fits the CHECK;
  - RLS: add `app` to `TENANT_TABLES`; `createOrg` seeds one app.
- **api:**
  - apps CRUD, type-change refusal, `app_in_use` with names, audit events;
  - publish: a playlist with an app gives v3, `publication_asset` rows only for media, served by /player/manifest; media-urls refuses anything that is not media;
  - push: app settings edit gives `changes`, then push, then `up_to_date`;
  - playlists: PUT with apps, list kinds and total, duplicate copies apps;
  - cross-org (GET, PATCH, DELETE the other org's app give 404; a PUT naming another org's appId gives 400);
  - session-csrf for POST, PATCH and DELETE /api/apps.
- **player:**
  - time-rules: apps ignore windows and obey hours;
  - playback: hold time for apps;
  - staging: an app-only publication activates with zero media requests;
  - sync: v3 ok, 4 unsupported;
  - `makeManifestV3` in fakes.
- **e2e player (`07-apps-player.spec.ts`):**
  - Clock in an Australia/Melbourne site shows `^\d{1,2}:\d{2} (am|pm)$` matching the zone;
  - `activeItemIndex` advances media to app to media;
  - a Countdown with a past target shows the finished text;
  - QR SVG present;
  - on 3840×480 the ticker line sits within the content rectangle and moves; with `reducedMotion: 'reduce'` it is still;
  - on 1376×774 the Text app has no overflow;
  - no CSP violations.
- **e2e portal (`08-apps-portal.spec.ts`):**
  - create a Clock through the dialog by keyboard; switch to 24-hour plus seconds and the preview shows HH:MM:SS;
  - poor-contrast warning; save;
  - Apps chip in the playlist editor, add, save; push gives in sync;
  - deleting while used is refused with the playlist name; after removing it from the playlist, delete works;
  - the ticker preview is still under reduced motion;
  - no CSP violations, no web storage.

### 10. Docs (WP7)

- docs/player-protocol-v1.md:
  - section 5: v3 and app items, with the per-app behaviour from section 7 and the renderer rules from section 5 above;
  - section 9: the version rule (v2 frozen; v3 frozen once 0.3.0 is released; a version is cut whenever a released player would reject the document), replacing the "Manifest v2 stays open while stage B is built" bullet.
- docs/portal-v2/stage-b.md: this slice, the release note ("reload screens after upgrading the player to 0.3.0") and the rollback rule.
- docs/portal-v2/README.md stage table: slice 2.
- apps/player-web/README.md (apps renderer, clock).
- apps/portal/README.md and src/ui/README.md (CanvasFrame `xl`, Apps pages).
- docs/security/threat-model.md and control-matrix.md:
  - operator text is drawn with textContent only; nothing is fetched;
  - QR content can point anywhere and is the operator's responsibility;
  - new dependency `uqr` (MIT, no dependencies) runs in the player and the portal.
- docs/prototype-m0.md D1 row: the new pinned dependency.
- tests/README.md: the two new spec files.

### 11. Work packages (file ownership does not overlap between packages)

- **Wave 1 / WP1 Contracts and domain** (sections 3 and 4).
  - Owns packages/contracts/src/{app (new), ids, text, manifest, playlist, audit, errors, routes, index}.ts, contracts.test.ts, portal-v2.test.ts;
  - packages/domain/src/{types, playlist, manifest, push, capability, index}.ts, their tests and fixtures.test-support.ts;
  - packages/delivery/test/* where the types break.
  - Publish `app.ts` first, with the exact names above.
- **Wave 1 / WP2 Migration 0007 and DB tests** (section 2).
  - Owns db/migrations/0007_stage_b_apps.sql; packages/db/test/{stage-b-apps.integration.test.ts (new), rls.integration.test.ts, portal-v2.integration.test.ts, stage-b.integration.test.ts, support.ts}.
- **Wave 1 / WP3 Shared renderer** (section 5).
  - Owns packages/app-render/**, the `@tinnox/app-render` dependency line in apps/player-web/package.json and apps/portal/package.json, and package-lock.json.
  - Owns eslint.config.js: add `packages/app-render/src/**/*.ts` to the browser block (the `innerHTML`/`outerHTML` and web-storage rules apply today to apps/portal and apps/player-web only; packages/** gets node globals).
  - Codes against the WP1 `AppContent` names in section 3.
- **Wave 2 / WP4 API** (section 6).
  - Owns apps/api/src/{app.ts, publishing.ts, routes/apps.ts (new), routes/playlists.ts}; apps/api/test/{apps.integration.test.ts (new), publish, push, playlists, audit-trail}.integration.test.ts, apps/api/test/support.ts; tests/integration/{cross-org, session-csrf}.test.ts.
- **Wave 2 / WP5 Player 0.3.0** (section 7).
  - Owns apps/player-web/src/{config.ts, app.ts}, core/{types, playback, time-rules, staging, sync}.ts and their tests, core/fakes.test-support.ts, ui/presenter.ts;
  - tests/e2e/07-apps-player.spec.ts (new), tests/e2e/support/{player, operator}.ts (adds `OperatorApi.createApp`).
- **Wave 2 / WP6 Portal** (section 8).
  - Owns apps/portal/src/{App.tsx, shell/nav.ts, shell/nav.test.ts, api/endpoints.ts and test};
  - lib/{apps (new), playlistDraft, playlistEditor, auditView, playlistsList, activity, screenDetail, mediaDetailDraft, mediaLibraryActions}.ts and tests, plus the strict DTO fixtures;
  - features/apps/** (new); features/playlists/** (editor, incl. dragSource.ts, list, PlaylistsPage.tsx); features/shared/PlaylistMosaic.tsx; features/audit/useAuditNames.ts; features/planned/PlannedPage.tsx; features/displays/detail/{CanvasFrame, AssignedPreview}.tsx and screenDetail.css;
  - tests/e2e/08-apps-portal.spec.ts (new), tests/e2e/support/portal.ts.
  - Portal e2e creates apps through the UI only.
- **Wave 3 / WP7 Docs** (section 10).

### 12. Deferred

- Tags, folders, availability windows and thumbnails for apps.
- Duplicating an app.
- Apps list grid, bulk actions and pagination.
- Preview in a chosen site's time zone.
- Keeping the clock offset across reloads.
- Exact handling of moments inside the DST gap or repeated hour.
- QR module-size warning.
- Apps in route capability profiles (for NovaStar and Huidu).
- Fading between apps.
- Language and locale choice (en-AU fixed).
- Clock and date on one item (comes with layouts).
- Other app types (World clock, count-up, Wi-Fi share).

### 13. Risks

- Font metrics differ between the portal's browser and the screen's browser. The renderer uses only system fonts and fits to its box, so the preview is proportionally honest but not pixel-exact.
- WAAPI tickers on low-power players can drop frames. They are compositor-driven; measure on target hardware.
- `uqr` is little maintained (0.1.3; first published 2023, no release between Aug 2023 and Apr 2026). It is small, dependency-free and pinned; check it in `npm audit`.
- Players stay on 0.2.0 until reloaded by hand. Screens with apps keep their old content meanwhile, and the portal shows the reload hint.
- The DB CHECK change re-reads every publication: run it during a quiet window.

### 14. Client questions (the build uses the default shown)

| Question | Default built |
|---|---|
| Clock default format | 12-hour, no seconds |
| Default colours for a new app | White text on black (black is "off" on LED) |
| Ticker speeds | Slow, medium, fast = 2, 3, 4.5 character heights per second |
| Countdown after the target | Shows the finished text until removed; no count-up |
| Contrast warning | Below 4.5:1, warning only, never blocks saving |
| Starting QR content | https://tinnox.com.au, caption "Scan me" |

### Self-check against the requested list

- **Forced RLS and tenant isolation:** `app` is forced, has a policy, is in the RLS list and is seeded per org; FKs are org-scoped.
- **Organisation only from the session:** every query uses `app_org_id()` inside `withOrg(session.orgId)`.
- **Immutable publications and idempotent push:** settings are copied into the manifest; publish and push idempotency is untouched.
- **Strict CSP:** CSSOM `setProperty`, `createElementNS` and WAAPI only, enforced by the build check.
- **A failed update never interrupts playback:** old players reject v3 as unsupported and keep their content; an app-only publication stages safely; an app render failure counts as an item failure.
- **v1 and 0.2.0 players:** screens without apps keep v1 or v2.
- **Over-building:** one new rejection code (`app_missing`) and one new error code (`app_in_use`) only; no new route-specific limit, no pagination, grid or bulk.

#### Critical files for implementation
- /Users/michael/Documents/github/tinnox-cms/packages/contracts/src/manifest.ts
- /Users/michael/Documents/github/tinnox-cms/packages/domain/src/push.ts
- /Users/michael/Documents/github/tinnox-cms/apps/api/src/publishing.ts
- /Users/michael/Documents/github/tinnox-cms/apps/player-web/src/ui/presenter.ts
- /Users/michael/Documents/github/tinnox-cms/apps/portal/src/lib/playlistDraft.ts
### Slice 2: release note and rollback

- Release note: **reload screens after upgrading the player to `player-web/0.3.0`.** A running player is never reloaded by the server. Until its page is reloaded, a 0.2.0 or older player that is sent a v3 manifest (any playlist with an app) reports `manifest_unsupported_version` and keeps playing its last content, or its waiting slate when it has none; the screen's Overview tab tells the operator to reload the player page. Screens whose playlists hold no app keep getting v1 or v2.
- Operations: rebuild (`npm run build`, which now includes `packages/app-render` in the player and portal bundles) and apply migration 0007 (`npm run db:migrate`) before the API of this slice starts. 0007 takes ACCESS EXCLUSIVE locks on `playlist_item` and `publication` and re-reads every publication to validate the new CHECK: run it while the API is stopped or idle.
- Rollback: taking a player below 0.3.0 after a v3 publication was activated is unsupported (as in slice 1). Recover on the server: remove every app from the screen's playlist and push again; the push then builds v2 or v1.

### Slice 2: as built (2026-11-16)

Built as specified above, except:

| Topic | Spec | As built, and why |
|---|---|---|
| Single-line text (section 5) | Clock, Date, the countdown value, the QR caption and the Text heading are one line (`nowrap`) | Each is fitted on one line first and wraps only when it would overflow at the minimum size (`shortSide/12`), so a long date on a portrait screen or a 60-character heading stays readable instead of clipped. |
| QR caption (section 5) | Beside the code on a wide box | As specified, and the caption area is at most twice the code's width, so on a very wide box code and caption stay together. |
| Finished countdown (section 5) | Shows `finishedText` permanently | It also removes its label ("Doors open in" would be false next to "Doors are open"). |
| Ticker measurement (section 5) | `copyWidth` | Measured in layout pixels (`offsetWidth`). Measured after CSS transforms, a screen rotated 90° or 270° gave the copy's height: the text moved about 190 px and snapped back 2.6 times a second. Covered by `e2e/07-apps-player.spec.ts` (rotation 90). |
| Date format control (section 8) | `Segmented` "Format" | A `Select`: three full dates do not fit side by side. |
| Contrast warning (section 8) | Banner | `live="polite"`, like the overflow Banner, so the warning is announced when it appears. |
| Screen page preview (section 8) | `AppPreview` for an app `first` | When the first item is an app, the disclaimer says the mock-up is drawn by the code the player uses for apps (there is no library file), and a time-based app adds the editor's sentence about this computer's time zone. |
| Playlist editor search (section 8) | "search matches the app name" | The search field is labelled "Search media and apps". |
| Audit wording (section 8) | "Created app", "Changed app", "Deleted app" | "App created", "App updated", "App deleted": the house pattern ("Folder created"). Section 8 now says so. |
| `validateAppDraft` (section 8) | `{ok, value: AppPatch}` | The patch carries only the fields that changed. |
| `loadPlaylistDto` (section 6) | `LEFT JOIN app a` | The item's apps are loaded in a second query by id, which reuses `APP_COLUMNS` and `toAppDto` (usage count included) instead of a second copy of the columns in the join. |
| `GET /api/apps` (section 6) | All apps | `LIMIT ABSOLUTE.maxListItems`, matching `AppListResponseSchema`'s `.max()`, so the response always parses. |
| App text (section 3) | Control and direction characters refused | Lone surrogates are refused too: they cannot be encoded as UTF-8, and the QR encoder would throw on the screen. |
| Player CSP (section 7) | No change outside the listed files | `apps/player-web` gained the portal's zod `jitless` alias (`vite.config.ts` maps `zod` to `src/zodJitless.ts`): zod's one-time `new Function` probe was reported as a violation by the player's CSP, which has no `'unsafe-eval'`. Parsing is unchanged. |
| Player geometry on failure (section 7) | Apply the geometry before mounting an app | Unchanged, and when that app then fails or times out while a previous item is on screen, the previous geometry is restored and laid out again, so the old item is not left rotated or letterboxed for the new canvas. Covered by reading only: `DomPresenter` has no unit-test seam (no DOM in the unit project). |
| `activeItemIndex` e2e (section 9) | "advances media to app to media" | Checked in two parts: the order on screen from a log of revealed layers (image, app, image, with no blank moment), and the player's reported index 1 while the app is shown. The order is not read from heartbeats, which are not sent at every item change. |

Open client questions (the build uses the default shown; each is a one-line change):

| Question | Default used |
|---|---|
| Clock default format | 12-hour, no seconds |
| Default colours for a new app | White text on black (black is "off" on LED) |
| Ticker speeds | Slow, medium, fast = 2, 3, 4.5 character heights per second |
| Countdown after the target | Shows the finished text, without its label, until removed; no count-up |
| Contrast warning | Below 4.5:1, warning only, never blocks saving |
| Starting QR content | https://tinnox.com.au, caption "Scan me" |
| Moving players to 0.3.0 | Manual page reload per screen; no automatic reload |

## Stage B, slice 3: schedules (build spec)

Date: 2026-11-17. Read `README.md` and slices 1 and 2 of `stage-b.md` first. Ponytail rule as before: every known limit gets `// shortcut: <limit>, <when to upgrade>`. Paths are relative to the repository root. Every claim about existing code below was checked against the files on `feat/stage-b-schedules` (6d88baf); nothing was run.

**What it delivers:** a customer sets which playlist a screen shows at which days and times, with a default playlist for every other moment.

**Model in four sentences.** A schedule is a named library object: one default playlist plus an ordered list of weekly events (playlist, days of the week, start, end). A screen has one playlist or one schedule assigned, never both. Events are checked from the top; the first one that covers the moment and has something to show wins, otherwise the default playlist plays. A push copies everything into one immutable publication, and the player decides locally, in the site's time zone, with no network at the change time.

**Shape in one sentence.** Everything stays flat: a scheduled publication is the default playlist's items followed by each event playlist's items in the one `assets[]`, plus a small `schedule` block that names the slices and the weekly rules. So the 0004 `publication_asset` guard, `createPublication`, media-URL authorisation, staging, verification, GC, heartbeat v1 and `activeItemIndex` are untouched.

### 1. Version rule

- `manifestVersionFor(draft): 1 | 2 | 3 | 4` (domain manifest.ts): `4` exactly when `draft.schedule !== null`; else the slice 2 rule.
- `draft.schedule` is non-null only for a schedule in which **at least one event uses a playlist other than the default**. A schedule with no events, or whose events all name the default playlist, can only ever play the default playlist, so it builds exactly the draft of its default playlist (v1, v2 or v3) and players older than 0.4.0 still take it. Editing the times of such events changes nothing a push would send.
- **v4 = v3 plus `schedule`.** It carries every v3 field. Top-level `transition` and `shuffle` are the default playlist's.
- **What a 0.3.0 or older player does with v4:** `parseManifest` gives `unsupported_version`; sync.ts reports `manifest_unsupported_version` and keeps its active version (or its waiting slate). It also **polls about every 2 seconds until its page is reloaded** (read from the code, not run): `syncCycle` returns before `onAttempt` (core/sync.ts:73-87), so `lastAttemptedPublicationId` is never set; every heartbeat answer then makes `hintDesired` (sync.ts:240-244, called from app.ts:474-481) wake the sync loop past its backoff; the cycle downloads the whole manifest again and reports the error, and `#report` (app.ts:223-227) asks for the next heartbeat after `minGapMs` (2 s). That is one heartbeat and one manifest GET per stale screen every 2 s, both under the route limits, so nothing stops it. 0.3.0 cannot be fixed; 0.4.0 fixes the loop for the v5 rollout (section 6, core/sync.ts). The Overview hint (OverviewTab.tsx:202) applies unchanged. The server stores no player version (only `apps/player-web/src/config.ts` knows it), so the portal cannot warn before the push; the schedule editor and the schedule picker carry a fixed sentence instead (section 7).
- Removing the schedule, or the last event that uses another playlist, makes the next draft v1 to v3; the push check reports `schemaVersion` and offers a push back.
- No header, no Vary, no negotiation; the ETag stays the publicationId.
- **Freeze:** v3 is frozen (0.3.0 is released). v4 is frozen the moment `player-web/0.4.0` is released; the next addition (dated events, layouts) is v5.
- **Deploy order inside the release:** the API must run the v4 `ManifestSchema` before any v4 row is stored, because `GET /player/manifest` throws on a stored manifest that fails `ManifestSchema` (routes/player.ts:391). One build ships both, so this holds as long as contracts, API and migration go out together.

### 2. Migration `db/migrations/0009_stage_b_schedules.sql`

```sql
-- 0009: portal v2, stage B slice 3: schedules (docs/portal-v2/stage-b.md, slice 3). 0001 to 0008 are unchanged.
--
--   1. schedule: a named timetable with a default playlist.
--   2. schedule_event: the weekly events of a schedule, in priority order.
--   3. display: a screen has a playlist or a schedule assigned, never both.
--   4. Deleted playlists: a schedule cannot use one, and a playlist that a schedule uses cannot be deleted.
--   5. publication: the manifest may be schema version 1, 2, 3 or 4.
--   6. Row-level security and runtime grants.
--
-- Every bound has its twin in packages/contracts (ScheduleRuleSchema, ABSOLUTE.maxScheduleEvents).
-- Takes ACCESS EXCLUSIVE locks on display and publication until commit, reads every display row and
-- re-reads every publication row to validate the new CHECKs; run it while the API is stopped or idle.

-- --------------------------------------------------------------------- 1. schedule

CREATE TABLE public.schedule (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organization (id),
  name                text NOT NULL,
  description         text,
  -- Plays whenever no event applies.
  default_playlist_id uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  CONSTRAINT schedule_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT schedule_name_trimmed CHECK (name = btrim(name)),
  CONSTRAINT schedule_description_length CHECK (char_length(description) BETWEEN 1 AND 500),
  CONSTRAINT schedule_default_playlist_fk FOREIGN KEY (default_playlist_id, org_id)
    REFERENCES public.playlist (id, org_id)
);
CREATE INDEX schedule_org_idx ON public.schedule (org_id, created_at);
-- Schedules that use a given playlist (refusal of a playlist delete).
CREATE INDEX schedule_default_playlist_idx ON public.schedule (default_playlist_id);
CREATE TRIGGER schedule_set_updated_at BEFORE UPDATE ON public.schedule
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------- 2. schedule_event

-- Rows are replaced as a set (delete, then insert), never updated; position is the identity.
CREATE TABLE public.schedule_event (
  schedule_id uuid NOT NULL,
  -- Priority order: the first event that covers a moment wins.
  position    integer NOT NULL,
  org_id      uuid NOT NULL REFERENCES public.organization (id),
  playlist_id uuid NOT NULL,
  -- Seven entries, Monday first: the days on which the event starts.
  days        boolean[] NOT NULL,
  -- Wall clock HH:mm in each screen's site zone. An end that is not after the start is on the next day.
  start_time  text NOT NULL,
  end_time    text NOT NULL,
  PRIMARY KEY (schedule_id, position),
  CONSTRAINT schedule_event_position_range CHECK (position BETWEEN 0 AND 49),
  -- One dimension, seven entries, no NULL, at least one true. The NULL test comes before ANY:
  -- with a NULL entry "true = ANY" is NULL, and a CHECK passes on NULL.
  CONSTRAINT schedule_event_days_shape CHECK (
    array_ndims(days) = 1
    AND array_lower(days, 1) = 1
    AND cardinality(days) = 7
    AND array_position(days, NULL::boolean) IS NULL
    AND true = ANY (days)
  ),
  CONSTRAINT schedule_event_start_format CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- 24:00 is the only way to say midnight at the end, so every rule has one stored form.
  CONSTRAINT schedule_event_end_format CHECK (
    end_time ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' AND end_time <> '00:00'
  ),
  CONSTRAINT schedule_event_not_empty CHECK (start_time <> end_time),
  CONSTRAINT schedule_event_schedule_fk FOREIGN KEY (schedule_id, org_id)
    REFERENCES public.schedule (id, org_id) ON DELETE CASCADE,
  CONSTRAINT schedule_event_playlist_fk FOREIGN KEY (playlist_id, org_id)
    REFERENCES public.playlist (id, org_id)
);
CREATE INDEX schedule_event_playlist_idx ON public.schedule_event (playlist_id);

-- ---------------------------------------------------------------------- 3. display

ALTER TABLE public.display
  -- The schedule a push would publish to this display. Assigning changes nothing on the display.
  ADD COLUMN assigned_schedule_id uuid,
  ADD CONSTRAINT display_assigned_schedule_fk FOREIGN KEY (assigned_schedule_id, org_id)
    REFERENCES public.schedule (id, org_id),
  ADD CONSTRAINT display_one_assignment
    CHECK (num_nonnulls(assigned_playlist_id, assigned_schedule_id) <= 1);
-- Displays that have a given schedule assigned (count per schedule, refusal of a delete).
CREATE INDEX display_assigned_schedule_idx ON public.display (assigned_schedule_id)
  WHERE assigned_schedule_id IS NOT NULL;

-- ------------------------------------------------------------ 4. deleted playlists

-- Same rule and same locking as display_assigned_playlist_guard (0005): using a playlist takes a
-- share lock on its row, which the UPDATE that deletes the playlist must hold exclusively, so one
-- of the two waits for the other and then sees its result. The error carries the trigger's name.
CREATE FUNCTION public.schedule_playlist_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  used_playlist_id uuid;
  is_deleted boolean;
BEGIN
  IF TG_TABLE_NAME = 'schedule' THEN
    used_playlist_id := NEW.default_playlist_id;
  ELSE
    used_playlist_id := NEW.playlist_id;
  END IF;
  -- A playlist that does not exist in this organisation is left to the foreign key.
  SELECT p.deleted_at IS NOT NULL INTO is_deleted
  FROM public.playlist p
  WHERE p.id = used_playlist_id AND p.org_id = NEW.org_id
  FOR SHARE;
  IF FOUND AND is_deleted THEN
    RAISE EXCEPTION 'a deleted playlist cannot be used in a schedule'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = TG_NAME;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER schedule_default_playlist_guard
  BEFORE INSERT OR UPDATE OF default_playlist_id ON public.schedule
  FOR EACH ROW EXECUTE FUNCTION public.schedule_playlist_guard();
CREATE TRIGGER schedule_event_playlist_guard
  BEFORE INSERT OR UPDATE OF playlist_id ON public.schedule_event
  FOR EACH ROW EXECUTE FUNCTION public.schedule_playlist_guard();
REVOKE ALL ON FUNCTION public.schedule_playlist_guard() FROM PUBLIC;

-- The 0005 function, replaced in place: it now also refuses while a schedule uses the playlist.
-- Same trigger, same constraint name, same privileges (CREATE OR REPLACE keeps the 0005 REVOKE).
CREATE OR REPLACE FUNCTION public.playlist_delete_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND (
    EXISTS (SELECT 1 FROM public.display d
            WHERE d.assigned_playlist_id = OLD.id AND d.org_id = OLD.org_id)
    OR EXISTS (SELECT 1 FROM public.schedule s
               WHERE s.default_playlist_id = OLD.id AND s.org_id = OLD.org_id)
    OR EXISTS (SELECT 1 FROM public.schedule_event e
               WHERE e.playlist_id = OLD.id AND e.org_id = OLD.org_id)
  ) THEN
    RAISE EXCEPTION 'a playlist that is assigned to a display or used by a schedule cannot be deleted'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'playlist_delete_guard';
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------ 5. publication

ALTER TABLE public.publication DROP CONSTRAINT publication_manifest_shape,
  ADD CONSTRAINT publication_manifest_shape CHECK (
    jsonb_typeof(manifest) = 'object'
    AND manifest ->> 'schemaVersion' IN ('1', '2', '3', '4')
    AND manifest ->> 'publicationId' = id::text
    AND manifest ->> 'displayId' = display_id::text
    AND jsonb_typeof(manifest -> 'assets') = 'array'
    AND jsonb_array_length(manifest -> 'assets') BETWEEN 1 AND 500
    AND pg_column_size(manifest) <= 1048576
  );

-- -------------------------------------------------------------- 6. RLS and grants

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schedule', 'schedule_event'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id())', t);
  END LOOP;
END $$;

-- Least privilege. A schedule's identity is never updatable; event rows are only added and removed.
GRANT SELECT, INSERT, DELETE ON public.schedule TO tinnox_app;
GRANT UPDATE (name, description, default_playlist_id) ON public.schedule TO tinnox_app;
GRANT SELECT, INSERT, DELETE ON public.schedule_event TO tinnox_app;
-- display is granted column by column.
GRANT UPDATE (assigned_schedule_id) ON public.display TO tinnox_app;
```

End the file with the two final-check DO blocks of 0007, unchanged except `unnest(ARRAY['schedule', 'schedule_event'])` in the tenant-policy check.

Facts that follow from the SQL:
- `publication.playlist_id` (NOT NULL, 0001:270) holds the **default playlist** of a scheduled publication. No `schedule_id` column: a schedule is hard-deleted and a publication lives for ever; the audit detail carries the id.
- Deleting a schedule that a screen has assigned fails on `display_assigned_schedule_fk` (23503). Deleting a schedule removes its events (cascade).
- Hard-deleting a playlist that a schedule uses fails on the two new FKs; the API only soft-deletes, which the replaced guard refuses (23001, `playlist_delete_guard`).
- `packages/db/src/constraints.ts` gains `export const STAGE_B_CONSTRAINTS = Object.freeze({ /** 23503: on a display, the schedule does not exist in this organisation; on a schedule, a delete was attempted while a display has it assigned. */ displayAssignedSchedule: 'display_assigned_schedule_fk' })`. It is the only new name a caller has to tell apart.

### 3. Contracts (packages/contracts, all objects `.strict()`)

**ids.ts:** `ScheduleIdSchema = UuidSchema`, `type ScheduleId`.

**refs.ts:** `ScheduleRefSchema = z.object({ id: ScheduleIdSchema, name: refName }).strict()`, `type ScheduleRef`.

**limits.ts:** `ABSOLUTE.maxScheduleEvents: 50`.

**schedule.ts (new; `export * from './schedule.ts'` in index.ts after `refs.ts`).** Imports only ids, limits, refs and text, so `manifest.ts` and `display.ts` can import it without a cycle.
- `ScheduleDaysSchema = z.array(z.boolean()).length(7).refine((d) => d.some(Boolean), { message: 'choose at least one day' })`. Index 0 is Monday, as in `WorkingHoursSchema`. A day is the day on which the event **starts**.
- `export const scheduleRuleShape = { days: ScheduleDaysSchema, start: LocalTimeSchema.refine((v) => v !== '24:00', 'start must be before 24:00'), end: LocalTimeSchema.refine((v) => v !== '00:00', 'use 24:00 for midnight at the end') }` (a plain shape, because zod refuses `.extend()` on a refined object).
- `export function checkScheduleRule(rule: { start: string; end: string }, ctx: z.RefinementCtx): void`: `start === end` adds an issue at `['end']`, `'end must differ from start'`.
- `ScheduleRuleSchema = z.object(scheduleRuleShape).strict().superRefine(checkScheduleRule)`, `type ScheduleRule = { days: boolean[]; start: string; end: string }`.
- Meaning (doc comment): `end > start` is a window on one day, `[start, end)`. `end < start` runs past midnight into the next day. `00:00` to `24:00` is the whole day.
- `export function eventCovers(rule: Pick<ScheduleRule, 'days' | 'start' | 'end'>, day: number, time: string): boolean`, the one evaluator (player and tests):
  ```ts
  if (rule.end > rule.start) return rule.days[day] === true && rule.start <= time && time < rule.end;
  return (rule.days[day] === true && time >= rule.start) || (rule.days[(day + 6) % 7] === true && time < rule.end);
  ```
  String compares, as working hours do; `'24:00'` is greater than every `time`.
- `ScheduleEventInputSchema = z.object({ playlistId: PlaylistIdSchema, ...scheduleRuleShape }).strict().superRefine(checkScheduleRule)`.
- `ScheduleInputSchema = z.object({ name: NameSchema, description: DescriptionInputSchema.optional(), defaultPlaylistId: PlaylistIdSchema, events: z.array(ScheduleEventInputSchema).max(ABSOLUTE.maxScheduleEvents) }).strict()`, `type ScheduleInput`. One schema for POST and PUT. On PUT an absent `description` is left as it is; null clears it (as the playlist PUT). Doc comment: **a refusal of this body names its fields with dots**, as `parseInput` (apps/api/src/errors.ts:46) joins zod paths: `name`, `description`, `defaultPlaylistId`, `events.3.playlistId`, `events.3.days`, `events.3.start`, `events.3.end` (the event index counts from 0). The API's own playlist check (section 5) and the portal's mapping (section 7) use the same strings. The bracket form (`events[n].playlist`) belongs to push issues only.
- `ScheduleEventDtoSchema = z.object({ playlist: PlaylistRefSchema, ...scheduleRuleShape }).strict()`.
- `ScheduleDtoSchema = { id: ScheduleIdSchema, name: z.string(), description: DescriptionSchema.nullable(), defaultPlaylist: PlaylistRefSchema, events: z.array(ScheduleEventDtoSchema).max(ABSOLUTE.maxScheduleEvents), assignedDisplayCount: int nonnegative, createdAt, updatedAt }`, `type ScheduleDto`.
- `ScheduleSummaryDtoSchema`: the same without `events`, plus `eventCount: z.number().int().nonnegative().max(ABSOLUTE.maxScheduleEvents)`. `type ScheduleSummaryDto`.
- `ScheduleListResponseSchema = { items: z.array(ScheduleSummaryDtoSchema).max(ABSOLUTE.maxListItems) }`.

**display.ts**
- `AssignedScheduleSchema = z.object({ id: ScheduleIdSchema, name: z.string().min(1).max(ABSOLUTE.maxNameLength), defaultPlaylist: PlaylistRefSchema }).strict()`. The default playlist is carried so the screen page can preview it without a second round trip.
- `DisplayDtoSchema += assignedSchedule: AssignedScheduleSchema.nullable()` (required; at most one of `assignedPlaylist` and `assignedSchedule` is non-null).
- `DisplayPatchSchema += assignedScheduleId: ScheduleIdSchema.nullable().optional()`, with a second refinement: both ids non-null is refused, path `['assignedScheduleId']`, message `'assign a playlist or a schedule, not both'`.
- Doc comment on the patch: a non-null id on one side clears the other side; null clears its own side; `{assignedPlaylistId: null, assignedScheduleId: null}` removes all content; an unknown schedule answers 404.

**push.ts**
- `PushPlanRowSchema += schedule: ScheduleRefSchema.nullable()` (required). For a scheduled screen `playlist` is the schedule's **default playlist**, so the existing refinement ("playlist is null exactly when `nothing_assigned`") stays as it is. One added refinement: `schedule !== null` requires `playlist !== null` (path `['schedule']`).
- Doc comments: `PushIssue.path` is `playlist` or `items[n]` for a playlist, and `default.playlist`, `default.items[n]`, `events[n].playlist`, `events[n].items[n]` or `schedule` for a schedule (n is the first event that uses the playlist). `skipped` means "nothing is assigned".

**manifest.ts**
- `MANIFEST_SCHEMA_VERSION_V4 = 4`.
- `ManifestSchedulePlaylistSchema = z.object({ count: z.number().int().positive().max(ABSOLUTE.maxPlaylistItems), transition: TransitionSchema, shuffle: z.boolean() }).strict()`.
- `ManifestScheduleEventSchema = z.object({ playlist: z.number().int().nonnegative().max(ABSOLUTE.maxScheduleEvents), ...scheduleRuleShape }).strict().superRefine(checkScheduleRule)`. `playlist` is an index into `schedule.playlists`.
- `ManifestScheduleSchema = z.object({ playlists: z.array(ManifestSchedulePlaylistSchema).min(1).max(ABSOLUTE.maxScheduleEvents + 1), events: z.array(ManifestScheduleEventSchema).min(1).max(ABSOLUTE.maxScheduleEvents) }).strict()`. `playlists` are consecutive slices of `assets`; `[0]` is the default playlist; a playlist used several times appears once. `events` are in priority order. The domain only builds this block with two or more playlists (section 4, step 5); the schema keeps `min(1)` and the player handles one.
- `ManifestV4Schema = manifestV2Object.extend({ schemaVersion: z.literal(4), assets: z.array(ManifestItemV3Schema).min(1).max(ABSOLUTE.maxPlaylistItems), schedule: ManifestScheduleSchema }).strict().superRefine(checkManifestV4Body)`.
- `checkManifestV4Body` = `checkManifestV2Body` (unchanged, over the flat list) plus:
  - the counts add up to `assets.length` (path `['schedule','playlists']`, `'playlist counts must add up to the number of assets'`);
  - every `events[i].playlist < playlists.length` (path `['schedule','events',i,'playlist']`);
  - top-level `transition` and `shuffle` equal `playlists[0]`'s (path `['schedule','playlists',0]`).
- No playlist id, no schedule id, no slice start in the manifest: the player reads none of them.
- `type ManifestV4`; `ManifestSchema` gains V4. `manifestV2Facts` needs no change (its body tests `=== 1`).
- `export interface ManifestPlaylistSlice { readonly from: number; readonly count: number; readonly transition: Transition; readonly shuffle: boolean }` and `export function manifestPlaylists(m: Manifest): ManifestPlaylistSlice[]`: v4 gives one entry per `schedule.playlists` with running `from`; v1 to v3 give one slice `{ from: 0, count: m.assets.length, ...transition and shuffle of manifestV2Facts(m) }`. Player code then has no version branches.
- `parseManifest`: case 4; the message becomes "expected 1, 2, 3 or 4" (build it from the four constants).
- Doc comment on `ManifestV3Schema`: "Frozen." On V4: "Frozen once player 0.4.0 is released; the next addition is version 5."

**audit.ts:** `AUDIT_ACTIONS += 'schedule.create','schedule.update','schedule.delete'` (after the playlist actions); `AUDIT_CATEGORIES += 'schedule'` (after `playlist`).

**errors.ts:** `API_ERROR_CODES += 'schedule_in_use'` (after `app_in_use`).

**routes.ts:** `schedules: '/api/schedules'` (GET, POST); `schedulePattern: '/api/schedules/:id'` (GET, PUT, DELETE; 409 `schedule_in_use` while a display has it assigned); `schedule: (id) => ...`. The comment on `playlistPattern` adds "or a schedule uses it".

**playlist.ts:** no new rejection code. `PUBLISH_REJECTION_CODES` stays at 18.

### 4. Domain (packages/domain)

**types.ts**
- `PublishIssue += readonly path?: string` ("Set for a scheduled screen: the full issue path, replacing the default `playlist` / `items[n]`.").
- `export interface DraftSchedule { readonly playlists: readonly { readonly count: number; readonly transition: Transition; readonly shuffle: boolean }[]; readonly events: readonly { readonly playlist: number; readonly days: readonly boolean[]; readonly start: string; readonly end: string }[] }`.
- `PublicationDraft += readonly schedule: DraftSchedule | null` (required). `items`, `transition` and `shuffle` keep their meaning: with a schedule, `items` is every playlist's items concatenated (default first) and `transition` / `shuffle` are the default playlist's.

**playlist.ts:** `buildPublicationDraft` sets `schedule: null`. No other change; it runs once per playlist.

**schedule.ts (new; export from index.ts)**
```ts
export interface SchedulePlanInput {
  readonly defaultPlaylistId: string;
  /** In priority order. */
  readonly events: readonly { readonly playlistId: string; readonly days: readonly boolean[]; readonly start: string; readonly end: string }[];
  /** Plans one playlist for the target display (planPublication with the display, records, limits and route bound). Undefined: the playlist no longer exists. */
  readonly planPlaylist: (playlistId: string) => { readonly name: string; readonly plan: PlanPublicationResult } | undefined;
  /** Judges the combined draft: the total number of items. */
  readonly route: PublicationValidator;
}
export function planSchedulePublication(input: SchedulePlanInput): PlanPublicationResult;
```
Rule, in this order:
1. Distinct playlist ids, compared in lower case: the default first, then event playlists in first-use order. The source of a playlist is `default`, or `events[n]` for the first event `n` that uses it (a playlist that is also the default has source `default`).
2. `planPlaylist(id)` for each. Undefined gives one issue `{ index: null, code: 'playlist_empty', path: '<source>.playlist', message: 'A playlist of this schedule no longer exists. Open the schedule and choose another.' }`.
3. A failed plan gives its issues, each with `path: '<source>.' + (index === null ? 'playlist' : 'items[' + index + ']')` and `message: 'In playlist "<name>": ' + message`. Item numbers stay per playlist because each playlist was planned on its own.
4. Any issue so far: `{ ok: false, issues }` (all of them, in playlist order).
5. No events, or no event uses a playlist other than the default (step 1 found one distinct id): return the default playlist's plan unchanged (`schedule: null`). The player could only ever pick slice 0, so the screen keeps the lowest version that fits.
6. Otherwise the combined draft: the default playlist's draft with `items` = all items concatenated in the order of step 1, and `schedule = { playlists: [{ count: items.length of each, transition, shuffle }], events: [{ playlist: index from step 1, days, start, end }] }`.
7. `input.route.validate(combined)`. Each part already passed, so only the total can fail; return those issues with `path: 'schedule'`, or `{ ok: true, draft: combined }`.

`// shortcut: a display-level refusal (canvas, content rectangle) is repeated once per playlist; the browser route never raises one. De-duplicate when a route that can ships.`

**capability.ts**
- The `too_many_items` message depends on the draft: with `draft.schedule !== null` it is `` `The playlists of this schedule hold ${draft.items.length} items in total; ${route} supports up to ${profile.maxItems}.` ``; otherwise today's sentence.
- Above it: `// shortcut: every route is the browser route, which plays schedules; add schedules to CapabilityProfile when a route that cannot evaluate them ships.`
- **The enforced total is the route's `maxItems`**, which is `limits.maxPlaylistItems` (apps/api/src/main.ts:45; 200 by default, 500 at most through `LIMIT_MAX_PLAYLIST_ITEMS`). No new limit and no new check. Each playlist also keeps its own limit of the same size. `// shortcut: one total for all playlists of a schedule; give schedules their own limit if 200 proves tight.`

**manifest.ts**
- `manifestVersionFor`: `if (draft.schedule !== null) return MANIFEST_SCHEMA_VERSION_V4;` first; return type `1 | 2 | 3 | 4`.
- `buildManifest`: for 4, the v3 object with `schemaVersion: 4` and `schedule` copied field by field (`playlists`: count, transition, shuffle; `events`: playlist, a copy of days, start, end). The Intl zone check runs for 2, 3 and 4. Self-check through `ManifestSchema`.
- `manifestAssetIds`, `manifestStorageBytes`: unchanged (flat `assets`).

**push.ts**
- `PlaybackField += 'schedule'`.
- `firstDraftManifestDifference`: the version check and the item loop are unchanged (items are flat). After the item loop, when `draft.schedule !== null` and the manifest is v4, `sameSchedule(draft.schedule, manifest.schedule)` false gives `{ kind: 'playback', field: 'schedule' }`. `sameSchedule` compares key by key, next to `sameHours`: the two `playlists` lists (length, then count, transition, shuffle each) and the two `events` lists (length, then playlist, each of the seven days, start, end). Never `JSON.stringify`.
- Update the "Compared" doc comment (v4 with a schedule in which an event uses another playlist; removing the schedule, or the last such event, offers a push back).
- `decidePushState`: unchanged.

### 5. API (apps/api; every route inside the operator scope, so session, CSRF and exact Origin apply; org only from `session.orgId` and `app_org_id()`; the global rate limit)

**routes/schedules.ts (new), `registerScheduleRoutes(api, ctx)`, registered after `registerAppRoutes` in app.ts.** Template: routes/apps.ts.
- `SCHEDULE_COLUMNS`: `s.id, s.name, s.description, s.created_at, s.updated_at, dp.id AS default_playlist_id, dp.name AS default_playlist_name, (SELECT count(*) FROM schedule_event e WHERE e.schedule_id = s.id AND e.org_id = s.org_id) AS event_count, (SELECT count(*) FROM display d WHERE d.assigned_schedule_id = s.id AND d.org_id = s.org_id) AS assigned_display_count`, over `schedule s JOIN playlist dp ON dp.id = s.default_playlist_id AND dp.org_id = s.org_id`.
- `loadScheduleDto(tx, id)`: that row plus `SELECT e.playlist_id, p.name AS playlist_name, e.days, e.start_time, e.end_time FROM schedule_event e JOIN playlist p ON p.id = e.playlist_id AND p.org_id = e.org_id WHERE e.schedule_id = $1 AND e.org_id = app_org_id() ORDER BY e.position`. node-postgres returns `boolean[]` as a JavaScript array.
- **GET /api/schedules** gives `{items}` (summaries), ordered `lower(s.name), s.id`, `LIMIT ABSOLUTE.maxListItems`.
- **GET /api/schedules/:id** gives a ScheduleDto, or 404 `notFound('The schedule')`.
- **POST /api/schedules** (`ScheduleInputSchema`) answers 201 with a ScheduleDto. **PUT /api/schedules/:id** (same schema) replaces the whole document. Both, in one transaction:
  1. PUT only: `SELECT 1 FROM schedule WHERE id = $1 AND org_id = app_org_id() FOR UPDATE`; none gives 404. This lock is what a push waits on (below).
  2. Every distinct playlist id must be live. **Lower-case `defaultPlaylistId` and the `playlistId` of every event once, right after parsing** (`UuidSchema` is `z.uuid()`, which accepts upper case; the database answers in lower case; `loadPlaylistDrafts` does the same at publishing.ts:223). The lower-cased values are the only ones used from here on: the distinct set, the missing-id check, the event insert and the audit detail. Then `SELECT id FROM playlist WHERE org_id = app_org_id() AND deleted_at IS NULL AND id = ANY($1::uuid[]) FOR SHARE`. A missing one gives 400 `validation_failed` "A playlist in this schedule does not exist or was deleted.", with details `{ path, message: 'The playlist was not found.' }` for every place it is used, where `path` is `'defaultPlaylistId'` or `` `events.${n}.playlistId` `` (dots, n from 0: the form `parseInput` gives every other field of this body; section 3).
  3. POST: `INSERT INTO schedule (org_id, name, description, default_playlist_id) VALUES (app_org_id(), …) RETURNING id`. PUT: `DELETE FROM schedule_event WHERE schedule_id = $1 AND org_id = app_org_id()`, then `UPDATE schedule SET name = $2, description = CASE WHEN $3::boolean THEN $4::text ELSE description END, default_playlist_id = $5 WHERE …` (always touches the row, so `updated_at` reflects event changes).
  4. Events in one statement (a 2-D array cannot go through `unnest`, so the days travel as text literals):
     ```sql
     INSERT INTO schedule_event (schedule_id, position, org_id, playlist_id, days, start_time, end_time)
     SELECT $1, (t.ordinal - 1)::int, app_org_id(), t.playlist_id, t.days::boolean[], t.start_time, t.end_time
     FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[])
          WITH ORDINALITY AS t(playlist_id, days, start_time, end_time, ordinal)
     ```
     with `days` sent as `` `{${event.days.map((d) => (d ? 't' : 'f')).join(',')}}` ``.
  5. Audit `schedule.create` / `schedule.update`, objectType `schedule`, detail `{ defaultPlaylistId, eventCount }` (ids lower case; never names).
  6. Catch 23503 and 23001 (a playlist went away between step 2 and the write): 409 `conflict` "A playlist in this schedule was deleted meanwhile. Reload and try again."
- **DELETE /api/schedules/:id**: lock the row `FOR UPDATE` (404 when absent); screens that have it assigned (names, `ORDER BY lower(d.name), d.id LIMIT 5`) give 409 `schedule_in_use` "This schedule is assigned to a screen. Assign other content to the screen first." with details `{ path: 'display', message: name }`; otherwise `DELETE`, audit `schedule.delete` with detail `{ eventCount }`, 204. 23503 (race): 409 `schedule_in_use` "This schedule has just been assigned to a screen. Try again."
- Overlapping events are **not** refused: list order decides (client question 2).

**routes/displays.ts**
- `DisplayRow` and `DISPLAY_SELECT` gain `asch.id AS assigned_schedule_id, asch.name AS assigned_schedule_name, asp.id AS assigned_schedule_playlist_id, asp.name AS assigned_schedule_playlist_name` through `LEFT JOIN schedule asch ON asch.id = d.assigned_schedule_id AND asch.org_id = d.org_id LEFT JOIN playlist asp ON asp.id = asch.default_playlist_id AND asp.org_id = asch.org_id`. `toDisplayDto` builds `assignedSchedule` (null unless all four are set).
- PATCH: the locked SELECT also reads `assigned_schedule_id`. A non-null `assignedScheduleId` is checked like a playlist: `SELECT 1 FROM schedule WHERE id = $1 AND org_id = app_org_id() FOR SHARE`, none gives `notFound('The schedule')`. The one UPDATE writes both columns:
  ```ts
  const playlist = patch.assignedPlaylistId !== undefined ? patch.assignedPlaylistId
    : patch.assignedScheduleId != null ? null : current.assigned_playlist_id;
  const schedule = patch.assignedScheduleId !== undefined ? patch.assignedScheduleId
    : patch.assignedPlaylistId != null ? null : current.assigned_schedule_id;
  ```
  So every existing caller that assigns a playlist (screen page, bulk assign, wizard, playlist pages) also clears a schedule, with no change on its side.
- Audit `display.update`: `fields` stays the sorted patch keys. The detail carries `assignedPlaylistId` and `assignedScheduleId` (lower case or null, the values written) when the patch sent that key, **and also when the UPDATE cleared a stored assignment the patch did not name**: `assignedScheduleId: null` when `current.assigned_schedule_id` was set and `schedule` is now null, `assignedPlaylistId: null` when `current.assigned_playlist_id` was set and `playlist` is now null. So the trail says that the schedule (or playlist) was taken off the screen, without the reader knowing the "never both" rule. The exact-detail assertion at audit-trail.integration.test.ts:206-215 stays green: that screen has no schedule.
- Error mapping adds `pg === '23503' && constraint === STAGE_B_CONSTRAINTS.displayAssignedSchedule` giving `notFound('The schedule')`.

**routes/playlists.ts**
- DELETE: after the screen check, a schedule check: `SELECT s.name FROM schedule s WHERE s.org_id = app_org_id() AND (s.default_playlist_id = $1 OR EXISTS (SELECT 1 FROM schedule_event e WHERE e.schedule_id = s.id AND e.org_id = s.org_id AND e.playlist_id = $1)) ORDER BY lower(s.name), s.id LIMIT 5`. Rows give 409 `playlist_in_use` "This playlist is used by a schedule. Choose another playlist in the schedule first." with details `{ path: 'schedule', message: name }`. `inUse` takes the message as a parameter; the 23001 race fallback says "This playlist has just been assigned to a screen or added to a schedule. Try again."
- Publish: the UPDATE that records the assignment becomes `SET assigned_playlist_id = $2::uuid, assigned_schedule_id = NULL` (same WHERE: with a schedule assigned the playlist column is null, so the row matches).

**publishing.ts**
- `DisplayPlanRow += assigned_schedule_id: string | null`; `DISPLAY_PLAN_COLUMNS += d.assigned_schedule_id`.
- `export interface ScheduleDraft { readonly id: string; readonly name: string; readonly defaultPlaylistId: string; readonly events: readonly { readonly playlistId: string; readonly days: boolean[]; readonly start: string; readonly end: string }[] }`.
- `export async function loadScheduleDrafts(tx, scheduleIds, lock): Promise<Map<string, ScheduleDraft>>` (ids lower-cased and de-duplicated first; none gives an empty map). **With `lock`, two statements, as `loadPlaylistDrafts` does (publishing.ts:231-249):**
  ```sql
  -- 1, only with lock
  SELECT id FROM schedule WHERE org_id = app_org_id() AND id = ANY($1::uuid[]) FOR SHARE
  -- 2, always, with no locking clause
  SELECT s.id, s.name, s.default_playlist_id, e.playlist_id, e.days, e.start_time, e.end_time
  FROM schedule s
  LEFT JOIN schedule_event e ON e.schedule_id = s.id AND e.org_id = s.org_id
  WHERE s.org_id = app_org_id() AND s.id = ANY($1::uuid[])
  ORDER BY s.id, e.position
  ```
  Why two: `withOrg` runs at READ COMMITTED (a plain `BEGIN`, packages/db/src/tx.ts). A single `… FOR SHARE OF s` join that waits on a PUT's `FOR UPDATE` took its snapshot before the PUT; after the PUT commits PostgreSQL re-reads only the locked row `s`, and the joined `schedule_event` rows still come from the old snapshot, so the push would publish the new name and default with the old events. With the lock taken first, statement 2 takes its snapshot while the share lock is held, and PUT and DELETE both take `FOR UPDATE` on the schedule row before they touch events, so the schedule and its events are the committed ones. Without `lock` (the push plan) statement 2 alone is one snapshot, which is enough for a read.
- `assessDisplays`: load the schedules of the displays first, then pass the assigned playlist ids **and** every schedule's default and event playlist ids to the existing `loadPlaylistDrafts` (one batch), then media and apps as today. Per display:
  - a playlist assigned: as today (`schedule: null`);
  - a schedule assigned: `plan = planSchedulePublication({ defaultPlaylistId, events, planPlaylist: (id) => { const p = drafts.get(id); return p === undefined ? undefined : { name: p.name, plan: planDraft(ctx, display, p, mediaById, appsById) }; }, route: ctx.delivery.get(display.route) })`; `playlist` is the default playlist's ref, `schedule` is `{ id, name }`; then `decidePushState` as today;
  - **the schedule is not in its map, or its default playlist is not in `drafts`** (a concurrent edit between two unlocked reads of the plan): return `{ playlist: null, schedule: null, state: 'nothing_assigned', draft: null, issues: [] }` (and the other fields as for a screen with nothing assigned) **before** `planSchedulePublication` is called. `schedule` must be null here: `PushPlanRowSchema` refuses a schedule without a playlist, and one such row would fail the strict parse of the whole `GET /api/push` answer in the portal. Only a missing **event** playlist reaches `planPlaylist`'s undefined branch (domain step 2, a `playlist_empty` issue at `events[n].playlist`). Neither can happen under `lock`: the display's foreign key keeps the schedule, and the delete guard keeps its playlists. No test reaches this branch (it needs two unlocked reads to interleave); keep it to the one early return with a comment.
  - `manifestFor` (current manifests to load) covers displays with either kind of content.
- `DisplayAssessment += readonly schedule: ScheduleRef | null`.
- `issueDetails`: `path: issue.path ?? (issue.index === null ? 'playlist' : \`items[${issue.index}]\`)`.
- `NewPublication += readonly scheduleId: string | null`; `createPublication` keeps `playlistId` (the default playlist) and adds `scheduleId` to the `publication.create` audit detail when it is not null.
- `auditRejectedPublication` input `+= readonly scheduleId: string | null`. With a schedule it records `objectType: 'schedule', objectId: scheduleId`; otherwise as today. The detail is unchanged (`displayId`, `reasons`, `via`).

**routes/push.ts**
- `toPlanRow += schedule: assessment.schedule`.
- `pushDisplay`: the skip at :106 stays (`playlist === null` still means nothing is assigned); the two later uses of `assessment.playlist.id` stay; both calls pass `scheduleId: assessment.schedule?.id ?? null`.
- The 23503 answer becomes "Something used by a screen's assigned content changed meanwhile. Nothing is lost: try again."

**Player routes:** no change. `GET /player/manifest` accepts v4 through the widened `ManifestSchema`; media URLs and media are authorised by `publication_asset`, which holds every media position of every playlist.

**Worst case:** 200 items and 50 events are far below the 1 MiB CHECK (500 tickers were about 550 KB in slice 2; an event is under 100 bytes). Tested in section 8.

### 6. Player 0.4.0 (apps/player-web)

- `PLAYER_VERSION = 'player-web/0.4.0'` (config.ts).
- Staging, verification, quota, activation and GC need **no change**: `uniqueAssets` and `manifestHashes` read the flat `assets`, so every playlist's media is downloaded and probed before the one-transaction activation, and none is collected while the publication is active. Stored records accept v4 through `ManifestSchema` (core/types.ts:46-61).

**core/time-rules.ts**
- `export function coveringSlices(manifest: Manifest, epochMs: number): number[]`: the indexes into `manifestPlaylists(manifest)` that the schedule's events name for this moment, **in priority order, each once**. `[]` when the manifest is not v4, when the clock or zone cannot be trusted (the two existing fail-open tests), or when no event covers the moment; otherwise the `playlist` of every `manifest.schedule.events` entry for which `eventCovers(e, local.day, local.time)`, de-duplicated keeping the first. It may contain 0: an event may name the default playlist to cut a hole in a lower event.
- `playableIndexes(manifest, epochMs, skipSlices: ReadonlySet<number> = NO_SLICES): number[]` (`NO_SLICES` is one module-level empty set), same return type, written over `manifestPlaylists(manifest)` so there is one code path. Order of the rules:
  1. v1: every index (as today).
  2. Clock more than 5 minutes behind `createdAt`, or zone unknown to the browser: **every index of slice 0**, windows ignored. For v2 and v3 slice 0 is the whole list, so this is today's behaviour; for v4 it is the default playlist only, never a mix of playlists.
  3. Outside working hours: `[]`. Hours outrank the schedule.
  4. Walk the candidates `[...coveringSlices(manifest, epochMs), 0]` in order. A slice other than 0 that is in `skipSlices` is passed over. For any other candidate take the indexes of that slice that pass the availability filter (apps always pass); **return the first list that is not empty**. So a higher event whose playlist has nothing to show now (every item outside its window, or skipped as failed) lets the next covering event play, and the default playlist plays only when no covering event has anything. Slice 0 is never skipped.
  5. No candidate had anything: `[]`, which is `not_now`, as today.
  - For v2 and v3 the candidates are `[0]`, so the result is today's.
  - Contract (doc comment): the result never mixes slices.
- Keep `// shortcut: an edge inside the repeated DST fall-back hour is ambiguous; upgrade if reported.` and extend it: "an event in the repeated hour plays twice; one wholly inside the skipped hour does not play that day".
- New: `// shortcut: a clock that is wrong but not behind the publication picks the wrong event with no signal; add time-sync gating (spec section 11 rule 7) with hardware players.`

**core/playback.ts**
- `PlaybackPosition`: no new field. The playlist on air is the slice that holds `index`.
- `nextStep(current, active, { now, random, skipSlices })` (`skipSlices?: ReadonlySet<number>`):
  - `allowed = playableIndexes(active, now, skipSlices)`; empty gives `'not_now'`.
  - `slice` = the entry of `manifestPlaylists(active)` that holds `allowed[0]`.
  - `switched` as today (publication changed). `restarted = switched || current.index is outside slice`.
  - On `restarted`: `order` = the indexes of the slice (`from .. from + count - 1`), shuffled when `slice.shuffle`; `cursor = 0`. Otherwise the kept order and `cursor + 1`. The wrap re-shuffles within the slice with the same no-repeat swap. `shuffled` becomes `shuffled(from, count, random)`; for one slice from 0 it draws the same random numbers as today, so v1 to v3 are byte-identical.
  - The loop invariant comment becomes "`order` holds every index of the slice and at least one is allowed".
  - `PlaybackStep += readonly restarted: boolean; readonly slice: number; readonly transition: Transition` (`slice` is the index into `manifestPlaylists(active)` of the playlist that holds `index`; `transition` is that playlist's).
  - `// shortcut: a playlist always starts at its first item (or a new shuffle) when it comes on; add resume at the interrupted item (spec section 11 rule 11) with priorities.`
- `Presenter.show(item, manifest, signal, transition: Transition)`. The loop passes `step.transition`.
- Loop:
  - `if (step.restarted) consecutiveFailures = 0;` `version_adopted` stays on `step.switched` only (app.ts keys GC and `notifyChange` on the publication id, which is right).
  - **A broken event playlist is skipped for a while, then tried again.** New field `#failed: { publicationId: string; retryAt: Map<number, number> } | null` (slice to the clock time of its next try). It is a set of slices, not one slot: with one slot two broken overlapping events would hand the skip to each other for ever and never reach the default. New `PlaybackTimings.eventRetryMs` (`DEFAULT_PLAYBACK_TIMINGS`: `300_000`; five minutes, not the 30 s of `allFailedRetryMs`, because every try restarts the playlist that was on air at its first item).
    - Before `nextStep`, with `now = clock.now()`: set `#failed = null` when `active` is null or the publication differs. Otherwise drop every entry whose slice is not in `coveringSlices(active, now)` (the event ended) or whose time has come: `now >= retryAt || now < retryAt - eventRetryMs` (the second half is a clock that was set back; without it the skip could outlive the five minutes by the size of the jump).
    - `const skipSlices = new Set(this.#failed?.retryAt.keys())`, a copy made once per step. The same object goes to `nextStep` and to `#hold` (below).
    - Where today's code detects `consecutiveFailures >= step.playable`: when `step.slice !== 0`, record `retryAt.set(step.slice, now + eventRetryMs)` (creating `#failed` for this publication when needed), reset the counter, wait `failureGapMs` and continue, **without** `clear()` and without `all_failed` (each failure was already reported as `item_failed`; the last good item stays on screen); when it is slice 0, today's behaviour (clear, `all_failed`, 30 s).
    - Effect: an event that never ends (00:00 to 24:00 on all seven days, or back-to-back events with the same playlist) recovers from one transient failure within about five minutes instead of staying off until the next push; a playlist that stays broken reports `item_failed` every five minutes, so the error does not age out of the report (`stillRelevant`, errors.ts:105-125, keeps one hour) while the screen shows something else.
    - The retry never cuts an item: the hold keeps the `skipSlices` of its step, so the event playlist is tried at the next item boundary after `retryAt`.
    - `// shortcut: a retry restarts the playlist that was on air at its first item; keep its position when resume (spec section 11 rule 11) is built.`
- **Switch time (`#hold`, stills and apps, v4 only).** The signature becomes `#hold(step: PlaybackStep, asset: ManifestItem, shown: ShownItem, skipSlices: ReadonlySet<number>)`; the loop passes the step it is showing and **the same `skipSlices` object it gave `nextStep` for that step**. With any other set the check below would see a skipped event playlist as chosen and cut every default still at each minute. For a manifest with `schemaVersion === 4` the hold sleeps in parts to the next wall-clock minute and ends early when the item may no longer be shown (the still and app branch; the video branch is unchanged):
  ```ts
  const scheduled = step.manifest.schemaVersion === 4;
  const stop = AbortSignal.any([signal, wake.signal]);   // composed once, before the loop: one wake controller and one signal for the whole hold
  let remaining = holdTimeMs(asset);
  while (remaining > 0) {
    const part = scheduled ? Math.min(remaining, 60_000 - (clock.now() % 60_000)) : remaining;
    await sleep(part, stop);
    remaining -= part;   // counted by what was slept, never by the clock: an instant test sleep or a clock jump cannot spin
    if (remaining > 0 && !playableIndexes(step.manifest, clock.now(), skipSlices).includes(step.index)) break;
  }
  ```
  Rules have minute granularity and every Australian offset is a whole number of minutes (Eucla +08:45 and Lord Howe +10:30 included), so a still or an app changes on the minute. This also ends a still at a working-hours or window edge, for v4 only. **v1 to v3 take one sleep as today**, so released behaviour and the existing playback tests do not move. Videos are never cut (existing rule).
  - Replace the comment at :165 with: `// shortcut: for manifests without a schedule (v1 to v3) rules are checked at item boundaries; an item may overrun an edge by its own length. A video is never cut, in any version.`
  - `// shortcut: minute alignment assumes whole-minute zone offsets; poll every few seconds instead if a zone with a second-level offset is ever supported.`

**ui/presenter.ts:** `show(asset, manifest, signal, transition)`; the fade test uses `transition === 'fade'` instead of `facts.transition`. On a change of playlist the incoming playlist's transition decides, as on a publication switch. Nothing else changes.

**core/sync.ts (stops the refused-version poll loop, for the next version's rollout).** In `syncCycle`, when `parseManifest` fails, read the id leniently before returning: when `fetched.raw` is an object, `PublicationIdSchema.safeParse` of its `publicationId`; on success call `deps.onAttempt?.(id)`. `SyncLoop` then records `lastAttemptedPublicationId`, and `hintDesired` leaves the update backoff alone for that publication. The answer stays `{ kind: 'update_failed', error, publicationId: null }` and the error is reported as today. A released 0.3.0 does not have this (section 1); from 0.4.0 on, a player that is sent a version it does not know retries on its backoff, not every 2 s.

**app.ts (one diagnostics row; nothing else changes: the GC and `notifyChange` keys are right as they are).** In the Content section of the diagnostics overlay, next to "Local time there" and "Clock offset" (app.ts:722-728), add `['Schedule picks', …]`, computed at the same instant as "Local time there" (`Date.now() + this.#clockOffsetMs`):
- no manifest, or a manifest that is not v4: `'— (no schedule)'`;
- `coveringSlices(manifest, t)[0]` undefined or 0: `'default playlist'`;
- otherwise `` `playlist ${slice + 1} of ${manifestPlaylists(manifest).length}` ``.

It names what the events ask for at the corrected clock, so "wrong content at 9" can be told apart from a wrong clock or zone on the device; the row above it ("On screen … item N") says what is really showing. No contract change. `// shortcut: the row names the first covering event's playlist, not the one on air after a fallback; derive it from the item on screen if support needs it.`

**Reporting:** `activeItemIndex` stays the flat index (heartbeat v1 untouched; at most 200 < 500). `item_started` is unchanged. No new event type.

**DST (wall-clock predicate, as working hours):** an event wholly inside the October gap does not play that day; one that starts inside the gap starts at 03:00; in the April repeated hour an event edge applies twice (02:30 to 03:30 plays 30 minutes, the default plays 30 minutes, then the event plays 60 minutes). Deterministic and never blank, but not spec section 11 rule 3; pinned by tests, listed in section 11.

### 7. Portal (UI kit only; operators read "screen"; no inline style attribute)

**Shell:** nav.ts: the Schedules entry loses `planned`. Remove `schedules` from `PlannedSection` and `PLANNED`. App.tsx: `page('schedules', schedulesPage, (m) => <m.SchedulesPage />)` and `page('schedules/:id', scheduleEditor, …)` in `PerObject`.

**api/endpoints.ts:** `listSchedules(signal?): Promise<ScheduleSummaryDto[]>`, `getSchedule(id, signal?): Promise<ScheduleDto>`, `createSchedule(input: ScheduleInput): Promise<ScheduleDto>`, `replaceSchedule(id, input: ScheduleInput): Promise<ScheduleDto>` (PUT), `deleteSchedule(id): Promise<void>`.

**lib/schedules.ts (pure, tested; mirrors lib/apps.ts)**
- `ScheduleEventDraft { key: string; playlistId: string ('' = not chosen); days: readonly boolean[]; start: string; end: string }` (times as the time fields hold them: `''` or `HH:mm`; an end of `00:00` means the end of the day).
- `ScheduleDraft { name; description; defaultPlaylistId; events: readonly ScheduleEventDraft[] }`.
- `scheduleDraftFromDto(dto)` (end `24:00` shown as `00:00`, as `workingHoursDraftOf` does), `scheduleIsDirty(saved, draft)`, `newEventDraft(key)` (no playlist, all seven days ticked, empty times), `moveEvent(events, index, delta)`, `endsNextDay(event): boolean` (both times set and the stored end is before the start).
- `validateScheduleDraft(draft): { ok: true; value: ScheduleInput } | { ok: false; errors: ScheduleErrors }`. An end of `00:00` is sent as `24:00`. Messages:
  - "Enter a name." (reuse `nameProblem`, lib/playlistEditor.ts:173);
  - the description: reuse `descriptionProblem` (lib/playlistEditor.ts:184; too long, tabs or other control characters). **The editor always sends `description`**: the trimmed text, or null when blank, as the playlist editor does (the rule of the private `descriptionToSave`, lib/playlistEditor.ts:69; write the three lines locally as lib/apps.ts:123 does, because WP6 owns that file). The create dialog sends none;
  - "Choose a default playlist.";
  - per event: "Choose a playlist.", "Choose at least one day.", "Enter a start and an end time.", "Start and end must differ. For the whole day, set both to 00:00." (a start and end of `00:00` is valid: the whole day).
- `ScheduleErrors { name?: string; description?: string; defaultPlaylistId?: string; form?: string; events: ReadonlyMap<string, { playlistId?: string; days?: string; time?: string }> }` (keyed by event `key`).
- `scheduleErrorsFromApi(details, draft)` reads the paths the API really sends (dots; section 3): split on `'.'`, as lib/apps.ts:247 does. `name`, `description` and `defaultPlaylistId` go to their slots; `events.<n>.playlistId` and `events.<n>.days` go to that slot of `draft.events[n]`; `events.<n>.start`, `events.<n>.end` and a bare `events.<n>` go to that event's `time` slot; anything else (an unknown path, an index with no event) goes to `form`, shown in the error summary. The first message per slot wins.
- `SCHEDULE_SORT_ACCESSORS`, `DEFAULT_SCHEDULE_SORT`, `filterScheduleList(items, query)` (name, description, default playlist name), `eventCountLabel(n)` ("No events", "1 event", "N events").
- **Reused, not rewritten:** the screens count is `assignedScreensLabel` from lib/playlistsList.ts:94 ("Not assigned", "1 screen", "N screens") in the list's Screens column and the editor fact. The names in an in-use refusal come from one function exported from lib/playlistsListActions.ts (WP5 owns it): `refusalNames(details: readonly ApiErrorDetail[], path: 'display' | 'schedule'): string[]`, which is the filter `deleteFailureText` has inline today (line 60); `deleteFailureText` uses it for both paths and `DeleteScheduleDialog` uses it with `'display'`. No `screenCountLabel`, no `inUseScreenNames`.

**Schedules list (`features/schedules/SchedulesPage.tsx`, the Apps list pattern):** `SearchField` "Search schedules", the count, a refresh icon button, primary "Create schedule". Table: Name (link), Default playlist (link to the playlist), Events, Screens, Updated, row menu (Edit, Delete). Empty state: "No schedules yet" / "A schedule shows different playlists at different days and times, and a default playlist the rest of the time." / "Create schedule". No-results state with "Clear search". `// shortcut: no grid, bulk selection or pagination; add when an organisation has over 100 schedules.`

**Create dialog (`CreateScheduleDialog.tsx`, Dialog `md`):** `Field` "Name"; native `Select` "Default playlist" (hint "Plays whenever no event applies.") listing `api.listPlaylists()` by name. With no playlist yet: an EmptyState "Create a playlist first" with a link to `/playlists`, and no form. Buttons Cancel and "Create schedule". POST with `events: []`, navigate to `/schedules/:id`, toast "Schedule created".

**Editor (`ScheduleEditorPage.tsx` loads; `ScheduleEditor.tsx` in `EditorPage`; back "Schedules"; Cancel and Save; `headerStatusLabel`; `useLeaveGuard`; Delete in the header menu).** Loads the schedule and `api.listPlaylists()`.
- **Details card:** Name, Description (its error under the textarea). Facts: Screens (`assignedScreensLabel`), Created, Updated.
- **Default playlist card:** `Select` "Default playlist". Hint: "Plays whenever no event applies. Keep at least one item in it that has no availability window, so the screen is never empty." A link "Open playlist".
- **Events card:** an ordered list (`<ol>`), not a grid and not a dialog. Each event is one `<li>` holding a `<fieldset>` whose `<legend>` is "Event N" (visible). Inside, in tab order:
  - `Select` labelled "Playlist" (first option "Choose a playlist"), and beside it a ghost link "Open playlist" to `/playlists/:id`, the same element the Default playlist card uses, hidden while no playlist is chosen (test id `schedule-event-{n}-open`). It is how an operator reaches the playlist that a push issue names ("In playlist “Lunch”: The playlist has no items."); the leave guard covers unsaved changes;
  - a nested `<fieldset>` with legend "Days" and seven `Checkbox`es labelled Monday … Sunday (reuse `WEEKDAYS`, lib/screenDetail.ts:204; the visible text may be the short form with the full name for assistive technology);
  - `TextInput type="time" width="sm"` "Start" and "End" (reuse the `.tx-screen-detail-pair` idea in the feature's own CSS);
  - `IconButton`s "Move event N up", "Move event N down" (disabled at the ends; focus stays on the moved event's button, the `moveItem` pattern of features/playlists/editor/PlaylistEditor.tsx:133) and "Remove event N".
  - Under the times, when `endsNextDay`: the hint "Ends the next day."
  - Errors sit under their control with `aria-invalid` and `aria-describedby`. A Save that fails validation shows the error summary Banner and **focuses the summary** (`summaryRef.current?.focus()` after the frame, as AppEditor.tsx:146-155 does). Each summary entry is a link that focuses its control: the Name and Description fields, `schedule-default-playlist`, and for an event `schedule-event-{n}-playlist`, `schedule-event-{n}-day-0` (a days error) or `schedule-event-{n}-start` (a time error), found by the test ids already listed (`[data-testid="…"]` inside the form); AppEditor's class-per-field lookup has no per-event form. Entries read "Event 3: Choose a playlist."
  - **Focus after adding and removing.** "Add event" focuses the new event's Playlist select. "Remove event N" focuses the Remove button of the event that takes its place; when the last event of the list was removed, the previous event's Remove button; when no event is left, "Add event". Focus never falls to the body.
  - Because every control sits in a fieldset named "Event N", each has a unique accessible name with 50 events on the page.
- Below the list: "Add event" (disabled at 50, with the reason as its hint). Above it, fixed help text:
  - "Events are checked from the top. When two events overlap, the higher one plays. If its playlist has nothing to show at that moment, the next event that applies plays. When no event applies, the default playlist plays."
  - "Times follow each screen's site time zone. Images and apps change on the minute; a video finishes first. Nothing plays outside a screen's working hours."
  - "Screens need player 0.4.0 or later to play events. Reload the player page on each screen after this update; until then an older player keeps its last content and the screen's page says so." (No "once": a reload while the screen cannot reach the player host serves the old build from the service worker cache, see the release note.)
- `// shortcut: native selects list every playlist; switch to PlaylistPickerDialog when organisations have hundreds of playlists.`
- `// shortcut: no warning for an event that can never play because events above it cover its times; add a week summary if operators report hidden events.`
- Save: `replaceSchedule`, toast "Schedule saved" with the detail "Screens that use it show Changes waiting until you push.", then `push.refresh()`. `validation_failed` details map to fields.
- Delete (`DeleteScheduleDialog.tsx`, ConfirmDialog danger): "Delete {name}?" / "The schedule is removed for good. Screens that already show it keep it until their next push." / "Delete schedule". `schedule_in_use` shows the error and the screen names (`refusalNames(details, 'display')`).
- `schedules.css` with `tx-schedule-` classes; the event rows wrap at phone width (no sideways scroll).
- Test ids: `schedules-create`, `schedules-table`, `schedule-create-dialog`, `schedule-save`, `schedule-error-summary`, `schedule-default-playlist`, `schedule-add-event`, `schedule-event-{n}` on each fieldset, and inside it `-playlist`, `-open`, `-day-{0..6}`, `-start`, `-end`, `-up`, `-down`, `-remove`.

**Schedule picker (`features/shared/SchedulePickerDialog.tsx`, exported from shared/index.ts):** a clone of `PlaylistPickerDialog` on `PickRow`, without the mosaic and without "none". Props: `open`, `onClose`, `onConfirm(schedule: ScheduleSummaryDto)`, `title = 'Choose a schedule'`, `description?`, `confirmLabel = 'Choose schedule'`, `currentId?`, `busy?`, `error?`, `errorTitle?`, `testId = 'shared-schedule-picker'`. Rows: the name and "Default: {playlist} · {eventCountLabel}". Empty state "No schedules yet" with a link to `/schedules`.

**Screen page**
- `detail/ContentCard.tsx`:
  - Nothing assigned: two buttons, "Assign playlist" (primary, `screen-detail-choose-playlist`) and "Assign schedule" (secondary, `screen-detail-choose-schedule`). The note says "Choose a playlist or a schedule for this screen, then push it."
  - Something assigned: the name with its kind ("Playlist" or "Schedule" as a caption), "Open playlist" or "Open schedule" (`/schedules/:id`, `screen-detail-open-schedule`), and one "Change" `Menu` (`screen-detail-change-content`) with "Choose a playlist…", "Choose a schedule…" and "Remove content".
  - The playlist picker loses `allowNone` here; "Remove content" sends `{ assignedPlaylistId: null, assignedScheduleId: null }`, toast "Content removed" with today's "keeps what it was last given" detail.
  - The schedule picker's description: "Choose the schedule for {name}. Nothing changes on the screen until you push. Screens need player 0.4.0 or later to play a schedule's events."
  - With a schedule, under its name: "Default playlist: {name}" and the playlist's summary line (the existing `PlaylistMeta`).
  - Toasts: "{name} assigned" for both kinds.
- `detail/useAssignedPlaylist.ts`: the playlist read is `display.assignedPlaylist?.id ?? display.assignedSchedule?.defaultPlaylist.id ?? null` (its `Pick` gains `assignedSchedule`). So the mosaic, the summary and the preview show the schedule's default playlist. `// shortcut: with a schedule the preview shows the default playlist only; add a "what plays at" preview (SCH-08) with the week view.`
- `detail/AssignedPreview.tsx` and lib/screenDetail.ts: `previewCaption`'s `nothing_assigned` text becomes "No playlist or schedule is assigned to this screen, so there is nothing to preview."; with a schedule the preview adds the sentence "This is the default playlist of the schedule “{name}”. Events may show other playlists."
- `detail/OverviewTab.tsx:167`: the text stays "Item N of the active publication"; when the screen has a schedule assigned a second sentence follows: "With a schedule, items are counted across all of its playlists, default playlist first." (The status view has no manifest, so the page cannot name the playlist on air; deferred.)
- lib/screenStatusPush.ts details: `nothing_assigned` "No playlist or schedule is assigned to this screen, so there is nothing to push."; `never_pushed` "Content is assigned, but nothing has been pushed to this screen yet."; `blocked` "The assigned content cannot be pushed to this screen until its problems are fixed."

**Other places that say or assume "playlist"**
- features/push/PushDialog.tsx: row meta shows a calendar icon and "Schedule: {name}" when `row.schedule !== null`, the playlist as today otherwise, and "Nothing assigned" for neither; with issues the link is "Open schedule" (`/schedules/:id`) for a scheduled row. lib/pushDialog.ts `searchRows` also matches `row.schedule?.name`. features/dashboard/PushCard.tsx caption: the schedule's name when set.
- **Push wording that says "playlist" for groups that can now hold scheduled screens** (WP6; no new code, only words, and the strings pinned in pushDialog.test.ts and dashboard.test.ts move with them). The rule: "the assigned playlist" becomes "the assigned content", "a playlist assigned" becomes "content assigned", "assign a playlist" becomes "assign a playlist or a schedule", "no playlist is assigned" becomes "nothing is assigned". The lines:
  - lib/pushDialog.ts `GROUP_TEXT`: :97 "The assigned content differs from what these screens were last given."; :101 "The assigned content cannot be pushed as it is. Each screen keeps the version it has."; :105 "The last push already matches the assigned content. There is nothing to push."; :109 "Assign a playlist or a schedule to a screen before pushing to it."
  - lib/pushDialog.ts result lines: :457 "rejected: the assigned content cannot be pushed as it is."; :473 "skipped: nothing is assigned."
  - lib/pushDialog.ts empty-selection texts: :553 "Fix the assigned content, then push."; :560 "Every screen with content assigned was already given its latest version."; :566 "No screen has content assigned yet. Assign a playlist or a schedule to a screen, then push." (pinned by pushDialog.test.ts:698).
  - lib/dashboard.ts: :385 "Add a screen and assign a playlist or a schedule to it. Its changes then wait here until you push."; :389 "Assign a playlist or a schedule to a screen. Its changes then wait here until you push."; :393 "Every screen with content assigned has been given its latest version."; `blockedText` :407 "blocked: the assigned content cannot be pushed as it is." (pinned by dashboard.test.ts:431).
- features/displays/list/ScreensList.tsx Content column: "Schedule: {name}" linking to the schedule. lib/screensList.ts: the search and sort accessors use the schedule's name when there is no playlist. `pushMarkerFor`: a scheduled screen gets the marker when `row.push.schedule?.id` matches `display.assignedSchedule.id`; a screen with a playlist gets it only when `row.push.schedule === null` **and** the playlist ids match (a stale plan row of a schedule whose default is that playlist is not a match). `ScreenRowMenu` "Nothing assigned" hint tests both.
- **ScreensList single-screen "Assign content" dialog:** `allowNone={assignSingle !== null && assignSingle.assignedSchedule === null}` (ScreensList.tsx:900). For a scheduled screen "No playlist" would be preselected (`commonPlaylistId` is null) and confirming it does nothing: `screensToAssign(targets, null)` (lib/screensList.ts:353) compares playlists only, and `{assignedPlaylistId: null}` alone leaves the schedule in place (section 5). So the row is not offered there; content is removed on the screen's page ("Remove content"). `screensToAssign` is unchanged: a scheduled screen has no playlist, so it counts for any playlist chosen. `// shortcut: content cannot be removed from a scheduled screen in the list; send both ids null and say "Content removed" if operators ask.`
- **Playlist pages must not take a scheduled screen for one of theirs.** Under the new contract `row.playlist` of a scheduled screen is the schedule's default playlist. lib/playlistEditor.ts `rowsForPlaylist` (:654, WP6) also requires `row.schedule === null`, so the playlist editor's Push card counts and pushes only screens that have the playlist assigned directly. Its empty texts change: `pushSummary([])` gives "No screen has this playlist assigned directly." and `pushHoldReason(false, [])` gives "No screen has this playlist assigned directly. Screens that play it through a schedule are pushed with Push to screens." (the top-bar button, shell/PushButton.tsx), so a playlist used only by a schedule no longer tells the operator to assign it over the schedule. lib/playlistsListActions.ts `assignPushView` (:183, WP5 makes this one-line change) requires `row.schedule === null && row.playlist?.id === playlistId`, so after assigning a playlist over a schedule the stale schedule row is not read as caught up and "Push now" is offered.
- **Assigning a playlist over a schedule is said out loud.** In the three playlist-assign dialogs (ScreensList bulk and single assign, playlists/list/AssignToScreens.tsx, playlists/editor/PushCard.tsx "Assign to screens") the description gains one sentence when any target or chosen screen has a schedule: "A screen that has a schedule gets this playlist instead of its schedule." features/shared/ScreenPickerDialog.tsx `contentLabel`: "Assigned: schedule {name}"; its search also matches the schedule's name.
- Wizard (`wizard/ContentStep.tsx`, lib/screenWizard.ts) stays playlist-only, but `/screens/new?screen=<id>&step=content` opens it on any existing screen. When `display.assignedSchedule !== null` the step shows the same one sentence as the dialogs above the list: "This screen has a schedule. It gets the playlist you assign here instead of its schedule." (WP6; no other change.)
- features/playlists/list/DeletePlaylistsDialog.tsx and lib/playlistsListActions.ts: a `playlist_in_use` refusal whose details have `path === 'schedule'` reads "Used by the schedule {names}." with the hint "Choose another playlist in that schedule, then delete the playlist." Such a refusal is not retried, like the screen one.
- **Audit and activity** (TypeScript forces the category and action maps): lib/auditView.ts `AUDIT_CATEGORY_LABELS.schedule = 'Schedules'`, `CATEGORY_SUBJECTS.schedule = 'Schedule'`, `OBJECT_TYPE_LABELS.schedule = 'Schedule'`, `AuditTargetKind += 'schedule'` (label "Schedule", path `/schedules/:id`), `RELATED_KEYS += { key: 'scheduleId', kind: 'schedule' }, { key: 'assignedScheduleId', kind: 'schedule' }, { key: 'defaultPlaylistId', kind: 'playlist' }` (the last one so the default playlist in a `schedule.create` / `schedule.update` detail shows with its name and a link; `OBJECT_TYPE_LABELS` and `RELATED_KEYS` are plain lists that TypeScript does not force, so they are named here and tested), `AuditNames.schedule`; features/audit/useAuditNames.ts and features/dashboard/useActivityNames.ts read `listSchedules`. lib/activity.ts `WORDING`: "Schedule created / updated / deleted" (attempts "Schedule creation / update / deletion", icon `other`); `REMOVALS += 'schedule.delete'`; the `display.update` special case is decided by `fields` (the patch keys) and the values, because the detail may now carry a null for the side the API cleared (section 5): `fields` holds only assignment keys, and then a non-null `assignedPlaylistId` reads "Playlist assigned to screen" (**also for `{ assignedPlaylistId: P, assignedScheduleId: null }`, never "Schedule removed"**), a non-null `assignedScheduleId` reads "Schedule assigned to screen" (related: the schedule), `fields` = both keys with both null reads "Content removed from screen", `fields` = `assignedScheduleId` alone with null reads "Schedule removed from screen", and `assignedPlaylistId` alone with null reads "Playlist removed from screen" as today.

### 8. Tests

- **contracts** (contracts.test.ts, portal-v2.test.ts):
  - `ScheduleRuleSchema`: valid; six days refused; no day ticked refused; start `24:00` refused; end `00:00` refused; start equal to end refused; `00:00` to `24:00` accepted; `22:00` to `02:00` accepted.
  - `eventCovers`: same-day window is half-open; overnight covers the start day's evening and the next day's morning; Sunday night runs into Monday; `24:00` end; a day that is not ticked.
  - v4 manifest: accepted; counts that do not add up refused; an event pointing past `playlists` refused; top-level transition differing from `playlists[0]` refused; extra key refused; **a v3 document with a `schedule` key refused**; a v4 without `schedule` refused.
  - `manifestPlaylists`: one slice for v1, v2, v3; running `from` for v4.
  - `parseManifest(5)` gives unsupported with "expected 1, 2, 3 or 4" (contracts.test.ts:175 moves from 4 to 5).
  - `DisplayPatchSchema`: both ids non-null refused; both null accepted. `PushPlanRowSchema`: schedule without playlist refused. Routes (pattern and builder), audit categories equal the derived set, `ScheduleInputSchema` with 51 events refused.
- **domain** (new schedule.test.ts; playlist.test.ts; push.test.ts):
  - `planSchedulePublication`: de-duplicates a playlist used by two events and by the default; slice order and counts; event indexes; an empty event playlist gives `playlist_empty` with path `events[1].playlist` and the prefixed message; an item problem keeps its per-playlist index (`events[0].items[2]`); a missing playlist; no events returns the default playlist's draft with `schedule: null`; **events that all use the default playlist** (one event, and two events, one with the id in upper case) return the same draft with `schedule: null`, and `manifestVersionFor` of it is below 4.
  - The total: two playlists of 150 items with `maxItems` 200 give one `too_many_items` with path `schedule` and the schedule sentence.
  - `manifestVersionFor` gives 4 only with a schedule; `buildManifest` v4 parses; worst case (200 tickers of 300 '€' in five playlists plus 50 events) is under 300 KB.
  - Push diff: an event's day, time or playlist changed gives `schedule`; reordered events give `schedule`; an event playlist's shuffle changed gives `schedule`; jsonb key order does not matter; removing the last event, and pointing the only event at the default playlist, each offer `schemaVersion`; an item changed inside an event playlist gives `item` at its flat index.
  - `checkCapabilities` still says "The playlist has…" without a schedule.
- **db** (new `packages/db/test/stage-b-schedules.integration.test.ts`, template stage-b-apps):
  - schedule and schedule_event CHECKs: name bounds; days with six entries, a NULL entry, two dimensions and all false each refused; start `24:00`, end `00:00`, start equal to end refused; position 50 refused.
  - Grants exactly as listed (no UPDATE on schedule_event, on `schedule.id` or `org_id`; UPDATE on `display.assigned_schedule_id`).
  - Cross-org playlist in a schedule or event refused (FK); cross-org schedule on a display refused.
  - `display_one_assignment`: both columns set refused (23514).
  - Guards: a deleted playlist as default or in an event refused (23001, the trigger's name); soft-deleting a playlist used as a default, and one used by an event, refused (23001 `playlist_delete_guard`); **regression:** soft-deleting a playlist that a display has assigned is still refused, and an unused playlist can still be deleted.
  - Deleting an assigned schedule gives 23503 `display_assigned_schedule_fk`; deleting an unassigned one removes its events.
  - Manifest CHECK accepts 4 and refuses 5: rls.integration.test.ts:791 and stage-b.integration.test.ts:169 move to 5.
  - A v4 publication with `publication_asset` rows for media positions in two playlists is accepted by the 0004 guard.
  - RLS lists: `TENANT_TABLES` gains `schedule` and `schedule_event`; `createOrg` (support.ts) seeds one schedule on the org's playlist with one event and `TestOrg.scheduleId`; the public-table list in migration-0005.integration.test.ts:551 gains both names ("// 0009, applied with the rest"). If a db test deletes an org's seeded playlist, seed the schedule on a second playlist and set `ROWS_PER_ORG.playlist = 2` instead.
- **api** (new `apps/api/test/schedules.integration.test.ts`; additions elsewhere; `support.ts` gains `createSchedule` and `assignSchedule`):
  - CRUD with audit events; PUT replaces events and keeps order; unknown, deleted and other-organisation playlists give 400 with the right paths (`defaultPlaylistId`, `events.1.playlistId`); 51 events refused.
  - **Upper-case ids:** a POST and a PUT whose `defaultPlaylistId` and event `playlistId` are in upper case succeed, the DTO and the audit detail carry them in lower case (the audit-trail test at :194-200 is extended to schedules in the same way).
  - **The path form of a schema refusal:** an event with six days gives 400 with a detail at `events.0.days`; a description with a tab gives one at `description`.
  - `schedule_in_use` with screen names; `playlist_in_use` with the schedule's name, for a default and for an event playlist.
  - Displays: assigning a schedule clears the playlist and the reverse; both in one patch refused; both null clears; unknown schedule 404; the DTO carries the default playlist. Audit: `{ assignedPlaylistId: P }` on a scheduled screen records `fields: ['assignedPlaylistId']` with `assignedPlaylistId: P` and `assignedScheduleId: null`; the reverse records `assignedPlaylistId: null`; on a screen with nothing assigned the detail has only the key the patch sent.
  - Push: a schedule with events gives `never_pushed`, then a v4 publication whose `publication_asset` rows cover media of every playlist, `publication.playlist_id` is the default playlist, the audit detail has `scheduleId`; then `up_to_date`; editing an event gives `changes`; a schedule without events, and one whose only event uses the default playlist, publish v1 to v3; removing the last event offers a push back.
  - **Push against a concurrent PUT (the lock of `loadScheduleDrafts`):** in a second connection, inside `withOrg`, take `SELECT 1 FROM schedule WHERE id = $1 FOR UPDATE`, replace the events and change the name with SQL, and keep the transaction open; start the push request without awaiting it; wait until `pg_locks` shows a waiting lock request (`NOT granted`) for the push's backend, then commit; the push answers `published` and the stored manifest's `schedule.events` are the new events (not the old ones, and not a mix of new name and old events).
  - A blocked schedule (empty event playlist): plan row `blocked` with path `events[0].playlist`; the push is `rejected` and audited with `objectType: 'schedule'`.
  - Over the total: `too_many_items` with path `schedule`.
  - Publish route on a scheduled screen clears the schedule.
  - Player: `/player/manifest` serves v4; media URLs are issued for an asset that is only in an event playlist.
  - dashboard.integration.test.ts category sets gain `schedule`; cross-org (GET, PUT, DELETE of another organisation's schedule give 404; a display patch naming it gives 404). tests/integration/session-csrf.test.ts: `OPERATOR_ROUTE_PATTERNS` gains **all five** entries, `['GET', '/api/schedules']`, `['POST', '/api/schedules']`, `['GET', '/api/schedules/:id']`, `['PUT', '/api/schedules/:id']`, `['DELETE', '/api/schedules/:id']`. The existing test "lists every /api route the application serves" (:101-121) fails for any served method and pattern that is not listed, the two GETs included; the session, CSRF and Origin loops then cover all five with no further change.
- **player** (existing clock seam: fake timers and `clock.now`; `makeManifestV4(playlists, events, overrides)` in fakes.test-support.ts):
  - time-rules: `coveringSlices` (priority order, de-duplicated, `[]` on fail-open and for v1 to v3); slice choice by day and time; overnight; first event wins on overlap; no event gives slice 0; **a higher event with nothing in its window lets the lower covering event play; a higher event in `skipSlices` lets the lower event play; both in `skipSlices` gives the default; an only event with nothing in its window gives the default**; an event that names slice 0 above a wider event gives the default; **fail-open returns slice 0 only** (clock behind, unknown zone); hours outrank events; v2 and v3 results unchanged.
  - DST with real instants, one table: Sydney 2026-10-04 (a 02:00 to 03:00 event does not match; a 02:30 to 04:00 event starts at 16:00Z), Sydney 2027-04-04 (02:30 to 03:30 matches at 15:30Z, not at 16:00Z, again at 16:30Z), Brisbane on both dates (no shift), Lord Howe 2026-10-04 (02:15 falls in the 30-minute gap). **The table builds its manifests with `createdAt: '2026-01-01T00:00:00.000Z'`** through the `overrides` of `makeManifestV4`: `makeManifest` sets `createdAt: '2026-11-14T01:00:00.000Z'` (fakes.test-support.ts:83), and the fail-open rule (time-rules.ts:61) gives slice 0 for any instant more than 5 minutes before that, so the October 2026 rows would pass or fail for the wrong reason. **Every "does not match" row has a control instant in the same test at which the same event does match** (the same wall-clock time one day earlier), so no row can pass by fail-open. These rows are the only pin on the SCH-02 and SCH-05 behaviour.
  - Every schedule test of `nextStep` and `PlaybackLoop` sets the clock after the fixture's `createdAt` (the existing `NOW`, 2026-11-16, is fine).
  - playback `nextStep`: order rebuilt over the slice on a playlist change, per-playlist shuffle stays inside the slice, `restarted` without `switched`, `transition` of the slice; v1 to v3 walks unchanged.
  - PlaybackLoop: a still in the default playlist is cut at the minute an event starts (set the clock to 10:59:58, a 10 s image, the event's item starts 2 s later); a video is not cut; no `version_adopted` on a playlist change; the failure counter resets on a playlist change; an event playlist whose only item fails falls back to the default without `all_failed` and without `clear()`, and is tried again after the event ended; **"a failed event playlist is tried again while the same event is still on"** (after `eventRetryMs`, at the next item boundary); **"a 00:00 to 24:00 event recovers after a transient failure"**; a higher event playlist that fails lets the lower covering event play, and both failing reaches the default; a clock set back does not extend the skip; **"while an event playlist is skipped as failed, a 3-minute default still is held for its full time"** (pins that `#hold` gets the step's `skipSlices`); a default playlist that fails still gives `all_failed`; a v2 still is **not** cut at a working-hours edge (pins the gate); an instant sleep cannot spin the hold.
  - staging: a v4 manifest stages the media of every playlist before activation; GC keeps the files of a playlist that is not on air.
  - sync: v4 activates; 5 is unsupported (sync.test.ts:172 moves to 5); **"an unsupported manifest's publication is remembered; a heartbeat hint for it does not wake the loop"** (`syncCycle` calls `onAttempt` with the id of a version-5 document; `SyncLoop.hintDesired` for that id does not wake, for another id it does); a malformed document without a usable id calls no `onAttempt`. idb-store: a stored v4 version loads.
- **portal** (unit): new lib/schedules.test.ts (draft, dirty, validate incl. `00:00` end, whole day and a description with a tab; API error mapping with the dotted paths `description`, `defaultPlaylistId`, `events.2.playlistId`, `events.0.days`, `events.1.start`, `events.1.end` and an unknown path going to `form`; move; labels); nav.test.ts (Schedules no longer planned); endpoints.test.ts (five calls, display fixtures gain `assignedSchedule: null`); every strict display and push-row fixture gains the new field (lib/screenDetail, screensList, screenWizard, screenDetailCanvas, dashboard, pushDialog, playlistEditor, playlistsListActions, lib tests; the `row()` fixture at playlistEditor.test.ts:814 gains `schedule: null`); screenDetail (captions); screensList (marker and labels for a scheduled screen; no marker for a playlist screen whose plan row carries a schedule; `screensToAssign` counts a scheduled screen for any playlist); pushDialog (search by schedule; the reworded strings); dashboard (the reworded strings); playlistEditor (`rowsForPlaylist` leaves out a scheduled row whose default is this playlist; the two empty texts); playlistsListActions (schedule refusal; `refusalNames`; `assignPushView` does not take a schedule row for caught up); auditView (`defaultPlaylistId` of a `schedule.update` detail is a related playlist; new kinds) and activity (new actions; `{ assignedPlaylistId: P, assignedScheduleId: null }` reads "Playlist assigned to screen"; the other assignment wordings).
- **e2e player (`tests/e2e/10-schedules-player.spec.ts`, written, not run by agents).** Site in Australia/Melbourne; playlist A (one image) and playlist B (another image); all through `OperatorApi` (`createSchedule`, `assignSchedule`).
  1. Schedule with default A and one event for B on all seven days, 00:00 to 24:00; assign; push. The player shows B's image; the manifest it fetched has `schemaVersion` 4; the reported `itemIndex` is 1.
  2. Replace the event with one that runs only on the weekday three days from today (Melbourne); push. The player shows A's image. (Neither case can flip at midnight.)
  3. Remove the event; push. The manifest has no `schedule` (version below 4) and A plays.
  4. No CSP violations. Edge crossing is unit-tested only: a faked browser clock does not move the server-corrected player clock (see the 06 header).
- **e2e portal (`tests/e2e/09-schedules-portal.spec.ts`, written, not run by agents):** create a schedule through the dialog by keyboard; add an event (focus lands on its Playlist select), save with no playlist chosen (focus lands on the error summary; its link focuses the event's Playlist select), choose a playlist ("Open playlist" appears beside it), tick days, set times, see "Ends the next day" for 22:00 to 02:00, move it, add a second event and remove it (focus lands on the first event's Remove button), remove the last event (focus lands on "Add event"), add it again, save; assign it on a screen's page through the Change menu; the push dialog row says "Schedule: {name}"; push gives Up to date; deleting the schedule is refused with the screen's name; deleting a playlist the schedule uses is refused with the schedule's name; assigning a playlist to that screen replaces the schedule and the dialog said so; phone width does not scroll sideways (`scrollsSideways`); no CSP violations, no web storage.

### 9. Docs (WP7)

- docs/portal-v2/stage-b.md: this slice, its release note and rollback, the deferred table of section 11, and after the build the as-built table.
- docs/player-protocol-v1.md: section 5 "Manifest v4 (stage B, slice 3: schedules)" with the rule order of section 6 above; section 9: the version sentence (v4 exactly when the assigned schedule has an event that uses a playlist other than its default; a schedule without such an event is sent as v1 to v3), the old-player bullet for 0.4.0, and the version rule (v3 frozen; v4 frozen when 0.4.0 is released; next is v5); the item total applies to all playlists of a schedule together.
- docs/portal-v2/README.md row B: slice 3 built; the wording "schedules with a calendar" becomes "schedules as a list of weekly events with a default playlist (a calendar view is deferred)" once client question 1 is answered.
- apps/player-web/README.md (schedule evaluation: the first covering event with something to show, else the default; minute alignment; a failed event playlist is skipped and tried again every five minutes while its event is on; the "Schedule picks" diagnostics row; a refused manifest version no longer polls every 2 s from 0.4.0; reloading to a new build: "reload while the screen can reach the player host; if the Overview error stays, reload again; the diagnostics overlay shows the build (player-web/0.4.0)"; line 415 "version 4 refused" becomes 5); apps/portal/README.md; apps/portal/src/ui/README.md (routes table, Schedules pages); features/shared/README.md (`SchedulePickerDialog`, `ScreenPickerDialog` label); features/push/README.md (row wording); tests/README.md (two new spec files).
- docs/security/threat-model.md and control-matrix.md: one row each: schedules add no outside data; schedule names are operator text shown with text nodes only; two new tenant tables under forced RLS.

### 10. Work packages (file ownership does not overlap between packages)

- **Wave 1 / WP1 Contracts and domain** (sections 3 and 4).
  - packages/contracts/src/{schedule (new), ids, refs, limits, display, push, manifest, audit, errors, routes, index}.ts, contracts.test.ts, portal-v2.test.ts.
  - packages/domain/src/{schedule (new), schedule.test (new), types, playlist, capability, manifest, push, index}.ts, playlist.test.ts, push.test.ts, fixtures.test-support.ts.
  - packages/delivery/test/{delivery.test.ts, fake-route.ts} where the draft type breaks.
  - Publish contracts `schedule.ts`, `manifest.ts` and domain `types.ts` first, with the exact names above.
- **Wave 1 / WP2 Migration 0009 and DB tests** (section 2).
  - db/migrations/0009_stage_b_schedules.sql; packages/db/src/constraints.ts (and index.ts if the new export needs it).
  - packages/db/test/{stage-b-schedules.integration.test.ts (new), rls.integration.test.ts, migration-0005.integration.test.ts, stage-b.integration.test.ts, support.ts}, and any other packages/db/test file that pins the table list, the display grants or the accepted manifest versions; tests/integration/migration-backfill.test.ts if 0008 breaks it.
- **Wave 2 / WP3 API** (section 5).
  - apps/api/src/{app.ts, publishing.ts, routes/schedules.ts (new), routes/displays.ts, routes/playlists.ts, routes/push.ts}.
  - apps/api/test/{schedules.integration.test.ts (new), push, publish, playlists, player, audit-trail, dashboard}.integration.test.ts, apps/api/test/support.ts.
  - tests/integration/{cross-org, session-csrf}.test.ts (session-csrf: the five route entries of section 8).
- **Wave 2 / WP4 Player 0.4.0** (section 6).
  - apps/player-web/src/config.ts; app.ts (**only** the "Schedule picks" diagnostics row of section 6); core/{time-rules, playback, sync}.ts and their tests; core/staging.test.ts, core/fakes.test-support.ts, platform/idb-store.test.ts, ui/presenter.ts.
  - tests/e2e/10-schedules-player.spec.ts (new), tests/e2e/support/{operator, player}.ts (`OperatorApi.createSchedule`, `replaceSchedule`, `assignSchedule`).
- **Wave 2 / WP5 Portal: schedules** (section 7, shell to schedule picker, plus audit and playlists-delete wording).
  - apps/portal/src/{App.tsx, shell/nav.ts, shell/nav.test.ts, api/endpoints.ts, api/endpoints.test.ts}.
  - features/schedules/** (new); features/planned/PlannedPage.tsx; features/shared/{SchedulePickerDialog.tsx (new), index.ts, shared.css (only if the schedule picker's rows need a rule)}; features/audit/**; features/dashboard/useActivityNames.ts; features/playlists/list/DeletePlaylistsDialog.tsx; features/styleguide/SurfaceSections.tsx (:201, the sample "Schedules are planned … They arrive with stage B" becomes a section that is still planned: "Layouts are planned" / "Layouts will split a screen into zones. They arrive with stage B.", with a fitting icon from ui/icons.ts).
  - lib/{schedules (new), auditView, activity, playlistsListActions}.ts and their tests. In playlistsListActions.ts WP5 also makes the one-line `assignPushView` change and exports `refusalNames` (section 7), although the flow they serve is WP6's.
  - tests/e2e/09-schedules-portal.spec.ts (new), tests/e2e/support/portal.ts (`createScheduleInPortal`, `saveSchedule`, `assignScheduleOnScreenPage`).
  - Writes `api/endpoints.ts` and `SchedulePickerDialog` first: WP6 codes against the names in section 7.
- **Wave 2 / WP6 Portal: screens and push** (section 7, "Screen page" and "Other places", except audit and the delete dialog).
  - features/displays/** (the wizard's ContentStep sentence included); features/push/{PushDialog.tsx, PushContext.tsx, push.css}; features/dashboard/PushCard.tsx; features/shared/ScreenPickerDialog.tsx; features/playlists/list/AssignToScreens.tsx; features/playlists/editor/PushCard.tsx.
  - lib/{screenDetail, screensList, screenStatusPush, pushDialog, status, screenWizard, dashboard, playlistEditor}.ts and the tests lib/{screenDetail, screensList, screenStatus, pushDialog, screenWizard, screenDetailCanvas, dashboard, playlistEditor, lib}.test.ts (strict fixtures; `rowsForPlaylist` and its two empty texts; the reworded push strings).
- **Wave 3 / WP7 Docs** (section 9): every file listed there, nothing else.

**Checks per package are scoped to what the package owns.** WP1 makes `DisplayDto.assignedSchedule`, `PushPlanRow.schedule` and `PublicationDraft.schedule` required, so after Wave 1 the root `npm run typecheck` is red in apps/api and apps/portal, and the unit project is red (for example apps/portal/src/api/endpoints.test.ts parses display fixtures through the strict `DisplayDtoSchema`), until WP3, WP5 and WP6 have all landed. No package can make the root commands green alone, so no package runs them as its gate:
- Typecheck, own workspaces only: WP1 `npm run typecheck -w @tinnox/contracts -w @tinnox/domain -w @tinnox/delivery`; WP2 `-w @tinnox/db`; WP3 `-w @tinnox/api`; WP4 `-w @tinnox/player-web`; WP5 and WP6 `-w @tinnox/portal`.
- Unit tests by path: `npx vitest run --project unit <own files or folders>`.
- Lint by path: `npx eslint --max-warnings=0 <own files or folders>`.
- WP2 and WP3 also run their own integration files (`npx vitest run --project integration <file>`), one agent at a time.
- **A failure in a file the package does not own is expected. Report it (file, line, message) in the hand-back; do not fix it.** For WP5 and WP6 the portal typecheck stays red on the other package's files until both have landed: each reports the errors left in its own files as zero and lists the rest.
- Files under tests/ (WP3: tests/integration; WP4 and WP5: tests/e2e) are typechecked only by the root `tsc -p tsconfig.json`. Those packages run it and answer for the errors in their own files; errors elsewhere are reported, not fixed.

**Integration step (the orchestrator, after Wave 2 and before WP7):** run the root `npm run typecheck`, `npm run lint` and `npm test`, then the integration files of WP2 and WP3 once more. The orchestrator owns every failure in a file that no package listed, and hands a failure in an owned file back to that package.

Nobody runs the e2e suite, starts or stops the dev stack, commits, pushes or switches branches.

### 11. Deferred (recorded, not dropped)

Product intent this slice does not meet. The slice 3 section of stage-b.md keeps this table.

| Source | What it asks | Status after this slice |
|---|---|---|
| README row B | "schedules with a calendar" | A list of weekly events. Calendar or week grid deferred (client question 1). |
| Spec 11 r5, SCH-07 | Priority 0 to 100, tie rule | List order is the priority. No numbers. |
| Spec 11 r11, SCH-07 | Resume at the interrupted item | A playlist starts at its first item each time it comes on. |
| Spec 11 r3, SCH-02 | Gap notice in the editor ("skipped on this date") | The event is skipped on the player; the editor says nothing. |
| Spec 11 r3, SCH-03 | Repeated hour runs once | It runs twice. |
| SCH-05 | Lord Howe 30-minute shift | Wall-clock predicate; pinned by a test, not conformant in the gap and repeat. |
| Spec 6.7, SCH-08 | "What plays at" preview equal to the player | Not built. The evaluator (`eventCovers`) is shared code, so the preview can reuse it. |
| SCH-09, SCH-10 | Date ranges, one-off dated overrides | Weekly only. **Dated events will cost manifest v5**, because v4 is frozen when 0.4.0 is released. Media availability windows cover "only between these dates": an event whose items are all outside their windows lets the next covering event play (section 6, rule 4), so a dated notice can sit above a standing event at the same times. |
| Spec 11 r2, r7 | 14-day materialisation, tzdata record, time-sync gating | Not built; the fail-open rule stands in. |
| SCH-06, SCH-11 | Zone change flow, zone picker | Sites are not editable yet. |

Also deferred: event names; "screen off" events and an empty filler (working hours already give a black screen); layouts, media or apps as event content; the name of the playlist on air on the screen's page (needs the manifest in the status read or heartbeat v2); a "used on screens" card with Push in the schedule editor; a warning for events hidden by events above them, and a warning when the default playlist can be empty by availability windows; schedules in the Add-screen wizard and in bulk assign; "used in schedules" count on the playlists list; schedules in route capability profiles; a dashboard counter; duplicating a schedule; list grid, bulk actions and pagination; a pre-push warning for old players (needs the player version on the server); removing content from a scheduled screen in the Screens list (it is done on the screen's page); the name of the playlist really on air in the player's diagnostics (the row names what the events ask for).

### 12. Risks

- **Every running player is 0.3.0 until its page is reloaded** and refuses v4. The first schedule push to such a screen leaves old content on it; only then does the Overview hint appear. Mitigation: the fixed sentences in the editor and the picker, and the release note.
- **An un-reloaded 0.3.0 player that is sent a schedule polls every 2 seconds** (one heartbeat with its `display_delivery` UPDATE and one full manifest GET, per stale screen, until its page is reloaded; section 1). Both stay under the route limits (120 and 240 per minute, routes/player.ts:361, :539), so nothing stops it, and 0.3.0 cannot be fixed. One more reason to reload every screen before the first schedule push. 0.4.0 remembers a refused publication, so the v5 rollout does not repeat this.
- **One reload is not always enough.** The shell service worker answers a navigation from the network only when it responds within 4 s (`NAVIGATION_TIMEOUT_MS`, apps/player-web/sw/sw.ts:22); otherwise it serves the cached page of the old build, and nothing on the screen says so. The server stores no player version, so the operator's only signs are the Overview error going away and the build in the diagnostics overlay (release note).
- **Player rollback with a v4 version stored blanks the screen:** `ActiveVersionSchema` (core/types.ts:47) parses the stored manifest with the old `ManifestSchema`, which no longer accepts it. Push v1 to v3 first (rollback rule below).
- All playlists of a schedule download before activation: more storage and a longer first push. A device that fails the quota check keeps its old version and reports the error.
- A clock that is wrong but plausible picks the wrong event silently (shortcut in time-rules.ts). The "Schedule picks" row in the diagnostics overlay, next to the local time and the clock offset, is the way to see it on the device.
- A broken event playlist is retried every five minutes while its event is on; each retry restarts the playlist that was showing at its first item.
- An event completely covered by events above it never plays, and the editor does not say so (shortcut).
- Required-nullable `DisplayDto.assignedSchedule` and `PushPlanRow.schedule` break every strict fixture (mechanical; WP3, WP5 and WP6 own them), and the root typecheck and unit run are red from the end of Wave 1 until WP3, WP5 and WP6 have all landed. Checks are scoped per package and the orchestrator runs the root commands after Wave 2 (section 10).
- 0009 re-reads every publication under ACCESS EXCLUSIVE: quiet window.
- The replaced `playlist_delete_guard` is shared with stage A behaviour; the regression test in section 8 guards it.
- The 200-item total across a schedule may be tight for long playlists (client question 5).

### 13. Client questions (the build uses the default shown)

Questions 1 and 2 decided what was written. The defaults below were built (2026-11-17); the questions stay open for the client. "Slice 3: as built" repeats them with what a different answer would change.

| # | Question | Default built |
|---|---|---|
| 1 | A calendar or week grid now? README row B says "with a calendar". | No: an ordered list of weekly events. The grid is all-new CSS plus a keyboard equivalent; the list is the accessible form anyway. README row B is reworded. |
| 2 | Overlapping events | Allowed; the higher one in the list plays (Move up, Move down). The alternative is to refuse overlaps, which needs no ordering but makes an exception inside a block mean splitting the block. |
| 3 | One-off or dated events | Not in this slice; weekly only. Adding them later is manifest v5. |
| 4 | Must a schedule have a default playlist? | Yes. Working hours give a black screen when wanted. |
| 5 | Items across all playlists of one schedule | At most the route limit, 200 (configurable to 500). |
| 6 | Moment of change | Images and apps on the minute; a video finishes first. |
| 7 | A playlist that comes back on | Starts from its first item (or a new shuffle). |
| 8 | Daylight saving | Wall-clock rule: skipped hour skips the event, repeated hour plays it twice. |
| 9 | An event playlist in which nothing can be shown (every item outside its dates, or every item failing) | The next event that covers the moment plays; the default playlist only when none does. A failing playlist is tried again every five minutes while its event is on; errors are reported. The alternative (straight to the default) is simpler to explain but breaks "a dated notice above a standing event". The first released 0.4.0 fixes this for every v4 manifest in the field, so it is decided now. |
| 10 | Moving players to 0.4.0 | Manual page reload per screen, while the screen can reach the player host; no automatic reload. |

### Self-check against the requested list

- **The task:** which playlist at which days and times, with a default: sections 2 to 7. Nothing else is built.
- **Forced RLS and tenant isolation:** both tables are forced, have the policy, org-scoped FKs, are in the RLS lists and are seeded per org.
- **Organisation only from the session:** every query uses `app_org_id()` inside `withOrg(session.orgId)`; routes sit in the operator scope.
- **Immutable publications and idempotent push:** the schedule is copied into the manifest; no publication column changes; key handling is untouched, except that a publish does not replay a stored schedule manifest ("Slice 3: as built").
- **A failed update never interrupts playback:** old players keep their content; all media is staged before activation.
- **Fails open, never blank by mistake:** untrusted clock or zone plays the default playlist; an empty or broken event playlist gives way to the next covering event and then to the default, and is tried again.
- **v1 to v3 and released players:** screens without a schedule, or with a schedule in which no event uses another playlist, keep v1 to v3; v1 to v3 playback is byte-identical (one slice, one sleep).
- **Validation, security, accessibility not cut:** DB CHECKs twin the contract; every event control has a unique accessible name; errors are tied to fields.
- **Judges' points:** 200 total with schedule wording (4); issue paths through `PublishIssue.path` (4, 5); rejected-push audit names the schedule (5); locks named (5); `boolean[]` hygiene and insert form (2, 5); one stored form for midnight (2, 3); hold counts down by slept time and is v4-only (6); broken event playlist falls back (6); flat-index wording (7); capability marker (4); overlaps allowed by list order (3, 7); silent schedule replacement said in the dialogs (7); old-player sentence (7); deferred acceptance tests listed (11); calendar and overlap put to the client (13).
- **Over-building avoided:** no new rejection code, one new error code, no event ids, no bitmask, no playlist or schedule id in the manifest, no status-contract change, no week summary, no "now and next", no event dialog, no new limit.

#### Critical files for implementation
- packages/contracts/src/manifest.ts
- packages/domain/src/schedule.ts (new)
- apps/api/src/publishing.ts
- apps/player-web/src/core/playback.ts
- apps/player-web/src/core/time-rules.ts
- apps/portal/src/features/schedules/ScheduleEditor.tsx (new)

### Slice 3: release note and rollback

- Release note: **reload screens after upgrading the player to `player-web/0.4.0`, before assigning a schedule with events to them.** A running player is never reloaded by the server. Until its page is reloaded, a 0.3.0 or older player that is sent a v4 manifest reports `manifest_unsupported_version` and keeps playing its last content, or its waiting slate when it has none; the screen's Overview tab tells the operator to reload the player page. Such a player also asks for the manifest and sends a heartbeat about every 2 seconds until it is reloaded, so reload first. **Reload while the screen can reach the player host; if the Overview error stays, reload again** (a reload that gets no answer within 4 seconds shows the old build from the cache). The diagnostics overlay shows the build (`player-web/0.4.0`). Screens with a playlist, or with a schedule in which no event uses a playlist other than the default, keep getting v1 to v3.
- Operations: rebuild (`npm run build`) and apply migrations 0008 and 0009 (`npm run db:migrate`) before the API of this slice starts; contracts, API and migration go out together, so no v4 row can exist before the API can read it. 0008 takes ACCESS EXCLUSIVE locks on `display` and `publication` and re-reads every publication: run it while the API is stopped or idle.
- Rollback: taking a player below 0.4.0 while a v4 version is stored on it is unsupported and blanks the screen. First, on the server: assign a playlist to the screen (or remove from its schedule every event that uses a playlist other than the default) and push; the push builds v1 to v3; wait until the screen reports it; then roll the player back. Taking the API below this slice after a v4 publication exists is unsupported for the same reason (`GET /player/manifest` would fail on it): push v1 to v3 to every scheduled screen first.

### Slice 3: as built (2026-11-17)

Built as specified above, except for the rows below. Checked at integration on 2026-11-17, with nothing committed: `npm run typecheck`, `npm run lint`, `npm test` (71 files, 1612 tests), `npm run format:check`, `npm run test:integration` (25 files, 302 tests, the `_test` database rebuilt from 0001 to 0008), `npm run build` and `npm run scan:secrets` all pass.

**Verified in the browser.** The full end-to-end suite passes (66 tests, 12.7 minutes, including 09 and 10 for this slice and 08 with its re-scoped toast checks). The schedules list, editor, create dialog and the screen page's Content card and Change menu were also looked at by hand at 1440, 1024 and 390 px in light and dark: no sideways scroll and no console errors. The Screens list's stale-copy toast and the Change menu's keyboard guard are covered by component tests in headless Chromium (`npm run test:component`; each was checked to fail without its fix). **Not verified yet:** a real player on hardware crossing an event edge (the edge is unit-tested only: a faked browser clock does not move the server-corrected player clock); a screen-reader pass.

| Topic | Spec | As built, and why |
|---|---|---|
| "Not both" tests (sections 3 and 5) | `!= null` in the `DisplayPatchSchema` refinement and in the PATCH snippet of routes/displays.ts | Written as `typeof … === 'string'` (`typeof … !== 'string'` in the refinement): the repository's `eqeqeq` lint rule refuses `!= null`. Same behaviour, since each id is a string, null or absent. The route's variables are `playlistAfter` and `scheduleAfter`. |
| Refinement messages (section 3) | Paths only for two of the v4 checks and for the `PushPlanRowSchema` refinement | The messages are 'playlist must be an index into schedule.playlists', 'the first playlist must carry the top-level transition and shuffle' and 'a row with a schedule carries the default playlist of the schedule'. |
| Exported types (section 3) | The listed names | Also the inferred types `ScheduleEventInput`, `ScheduleEventDto`, `ScheduleListResponse`, `AssignedSchedule`, `ManifestSchedulePlaylist`, `ManifestScheduleEvent` and `ManifestSchedule` (the domain's push.ts uses the last). `ScheduleRule` is `z.infer<typeof ScheduleRuleSchema>`, which is the shape the spec writes out. |
| Schedule description on PUT (section 3) | "null clears it" | Null or a blank string clears it: `DescriptionInputSchema` parses a blank string to null, as for playlists. The doc comment on `ScheduleInputSchema` says so. |
| Unreachable guards (sections 4 and 6) | Not listed | `planSchedulePublication` throws if no default draft exists after a clean pass, and `nextStep` answers `'not_now'` if no slice holds the first playable index. Neither can happen; both are there for the type checker and say so in a comment. |
| Manifest version pin in the database tests (section 8, db) | "Manifest CHECK accepts 4 and refuses 5" | Pinned by the two moved tests (stage-b.integration.test.ts and rls.integration.test.ts); the new file has a one-line pointer instead of a third copy. `ROWS_PER_ORG.playlist` stays 1: no database test deletes an organisation's seeded playlist. |
| `assessDisplays`, schedule or default playlist gone (section 5) | One early return before `planSchedulePublication` | One helper, `contentOf`, returns undefined for a missing playlist, a missing schedule and a schedule whose default playlist is missing, and all three share the existing `nothing_assigned` return with `schedule: null`. The current-manifest load filters with the same helper. |
| Schedule DELETE (section 5) | Lock the row, then delete, audit `{ eventCount }` | The locking SELECT also reads the event count, so the audit detail needs no second statement. |
| `{ assignedPlaylistId: null }` on a screen with a schedule (section 5) | Follows from the two-column formula | As the formula gives, and tested: the schedule stays and the audit detail records only `assignedPlaylistId: null`. To empty a screen whatever it holds, send both keys as null (the screen page's "Remove content" does). |
| Audit of a scheduled push (section 5) | `scheduleId` in the `publication.create` detail "when it is not null" | The detail carries `scheduleId` whenever the screen had a schedule assigned, also when the schedule was sent as its default playlist (v1 to v3). A rejected push of a scheduled screen is recorded with `objectType: 'schedule'`. |
| Activity wording for a scheduled push (section 7) | Not asked for | In lib/activity.ts a `publication.create` event that carries `detail.scheduleId`, or whose object is a schedule (a rejected push), names the schedule as its related object. Without it a scheduled push read "Playlist: {default playlist}" on the dashboard. Tested; one block to remove if unwanted. |
| Lock test for a push against a concurrent PUT (section 8, api) | Wait until `pg_locks` shows a waiting request "for the push's backend" | It reuses the `pushAgainstHeldEdit` helper of push.integration.test.ts, which waits for any ungranted lock. Integration files run one at a time, and the assertion on the stored events is the real pin: with `loadScheduleDrafts` replaced by a single `FOR SHARE OF s` join the test failed with the old events in the manifest. |
| Item-total test (section 8, api) | `too_many_items` with path `schedule` | Run in its own app with `LIMIT_MAX_PLAYLIST_ITEMS=3` and two playlists of two app items, not with more than 200 items. |
| Where the API tests live (section 8, api) | New `schedules.integration.test.ts`, "additions elsewhere" | The concurrent-PUT test and "the publish route clears the schedule" are in push.integration.test.ts (its helpers), the v4 and media-URL test in player.integration.test.ts, the playlist-delete refusals in playlists.integration.test.ts. publish.integration.test.ts needed no change. |
| `onAttempt` for a refused manifest (section 6) | "when `parseManifest` fails", read as the unsupported-version case | Also called for a malformed document whose `publicationId` is a readable UUID. The doc comment on `SyncDeps.onAttempt` says so. |
| Diagnostics row (section 6) | Add the 'Schedule picks' row; nothing else changes in app.ts | "Local time there" now reads the same `correctedNow` value, so the two rows describe one instant. |
| Player test data (section 8, player) | `makeManifestV4(playlists, events, overrides)` | `playlists` are `{ items, transition?, shuffle? }` objects and `events` are manifest events. In the daylight-saving table each row is one test that holds its own control instant and asserts the wall clock at every instant. |
| Help text in the Events card (section 7) | "Below the list: Add event. Above it, fixed help text" | The three paragraphs are at the top of the Events card, above the list. The sentence can be read either way, and there they stay in view with 50 events. |
| Error summary links (section 7) | Each entry is a link that focuses its control | The whole line ("Event 3: Choose a playlist.") is the link, not only a label as in the app editor, so two links to different controls of one event have different names. |
| Create dialog (section 7) | `Select` "Default playlist" | It starts on "Choose a playlist" and a playlist must be chosen ("Choose a default playlist."); the spec does not say whether one is preselected. |
| Day checkboxes (section 7) | Monday … Sunday, short form allowed | Mon to Sun on screen, with the full day name for assistive technology. |
| Server refusals in the editor (section 7) | The first message per slot wins | Each message is prefixed "The server refused this value: …", as lib/apps.ts does. |
| Playlist selects (section 7) | Native selects list every playlist | A select also gets one option for a chosen playlist that is not in the (capped) playlist list, named from the saved schedule, so a select never shows a value other than the draft's. |
| Extra file, names and test ids (section 7) | The files, names and test ids listed | One more file, `ScheduleEventRow.tsx` (the event fieldset and the shared `PlaylistSelect`). lib/schedules.ts also exports `MAX_SCHEDULE_EVENTS`, `NO_SCHEDULE_ERRORS`, `ScheduleEventErrors`, `ScheduleErrorEntry`, `scheduleErrorEntries`, `withoutScheduleError`, `withoutEventError`, `playlistsByName` and `scheduleSummaryLabel`; `scheduleDraftFromDto(dto, keys?)` takes the rendering keys so a save does not rebuild the event rows. More test ids: `schedules-search`, `-refresh`, `-count`, `-empty`, `schedules-row-<id>`, `schedules-row-menu`, `schedules-create-name`, `-playlist`, `-submit`, `schedules-delete-dialog` (`-confirm`, `-cancel`), `schedules-delete-screens`, `schedule-editor`, `schedule-editor-missing`, `schedule-name`, `schedule-description`, `schedule-save-state`, `schedule-cancel`, `schedule-menu`, `schedule-default-open`, `schedule-fact-screens`, `schedule-no-events`, `schedule-event-{n}-next-day`. |
| Playlist delete refused by a schedule (section 7) | "Used by the schedule {names}." with its hint | `deleteFailureText` also returns `bySchedule`, has a plural form ("Used by the schedules A and B.", "…in those schedules…"), and for a `playlist_in_use` refusal without names says "A screen has this playlist assigned or a schedule uses it.", because the API's race answer can now mean either. The dialog offers "Go to Schedules" beside "Go to Screens". The API checks screens first, so a playlist used both ways names the screens only. |
| Wording outside the listed lines (section 7) | The lines listed under "Push wording" | Two more strings follow the same rule: lib/status.ts "nothing has been published to this screen yet", and the push dialog's "No screens yet" text ("assign a playlist or a schedule"). |
| "A screen that has a schedule gets this playlist…" (section 7) | In the three playlist-assign dialogs | Also in the screen page's playlist picker when the screen has a schedule; its description is "Choose the playlist for {name}. Nothing changes on the screen until you push." The string is one constant, `SCHEDULE_REPLACED_NOTE` (lib/screensList.ts). In the two `ScreenPickerDialog` callers it appears once a screen with a schedule is ticked. |
| `ScreenPickerDialog.description` (section 7) | Not listed | May be a function of the chosen screens: the picker loads the screens itself, so its two callers cannot otherwise know whether a chosen screen has a schedule. |
| Preview sentence for a schedule (section 7) | "the preview adds the sentence" | Appended to the result of `previewCaption(state, playlistName, firstItemName, scheduleName)`, so it is also in the frame's accessible description. Not added for `nothing_assigned`. |
| Screen page Content card (section 7) | Buttons, the Change menu and the pickers | When a save swaps the two buttons for the Change menu or back, focus moves to the first button that took their place, so it never falls to the body. The test id `screen-detail-change-playlist` is gone (no end-to-end file used it); the schedule picker's test id, which the spec does not name, is `screen-detail-schedule-picker`. A failed "Remove content" shows an error in the card. |
| Push dialog row (section 7) | "Schedule: {name}" | Visible text, with a calendar icon; a playlist row keeps its visually hidden "Playlist: " prefix. |
| `ActivityCard.tsx` (section 10) | In no work package | `features/dashboard/ActivityCard.tsx` has an exhaustive label map over the activity object kinds; the new `schedule` kind needed `schedule: 'Schedule'` there. Added at integration. |
| Typecheck of files under tests/ (section 10) | "typechecked only by the root `tsc -p tsconfig.json`" | Wrong about the existing code: the root tsconfig includes only the root `*.ts` files, and tests/ is its own workspace (`npm run typecheck -w @tinnox/tests`). Both were run. |
| Lint and format configuration (not in the spec) | No change | `eslint.config.js` and `.prettierignore` now ignore `.claude/worktrees`. A leftover local git worktree there (a second copy of the repository, hidden from git) made `eslint .` run out of memory and put its run-state files into `prettier --check .`. CI has no such folder. If the worktree is removed instead, the two lines can go. |
| README row B (section 9) | Reworded "once client question 1 is answered" | Reworded with the build, to "a list of weekly events with a default playlist (a calendar view is deferred)": the page should describe what exists. Question 1 stays open below. |
| Security pages (section 9) | "one row each" | threat-model.md gains section 11 with one row (T2, T5). control-matrix.md has one row per control, so the passage went into row B4 (organisation isolation), as slice 2 extended B9. |
| Schedule item total (sections 4 and 5) | Plan every playlist, then check the combined draft against the route's `maxItems` | The raw item counts are added up first. With more than one distinct playlist and a total over `maxItems`, the only issue is `too_many_items` at path `schedule`, in the same words (one function, `scheduleTotalMessage` in capability.ts, writes them for both checks), and no playlist is planned. This keeps `GET /api/push` and the dashboard count cheap. Issues inside one playlist show only once the total fits. docs/player-protocol-v1.md section 9 gives this order. |
| Audit of a publish that takes a schedule off (section 5) | The publish UPDATE sets `assigned_schedule_id = NULL`; one `publication.create` event | Still one event. When the screen had a schedule, its detail also carries `assignedScheduleId: null`, so the audit trail shows that the schedule came off. The key is not `scheduleId`, because the portal reads that key as a scheduled push; the event still reads "Pushed to screen" with the playlist as its related object. |
| Publish idempotency after a scheduled push (section 5) | Key handling untouched: a repeated key replays when the stored publication has the same playlist | Also refused with 409 `idempotency_conflict` when the stored manifest has a `schedule` block. A scheduled push stores the default playlist's id, but a v4 manifest is not what publishing that playlist makes. A schedule sent as v1 to v3 is exactly that playlist's publication, so it still replays. docs/dev-handoff.md says so. |
| Event retry time (section 6) | `retryAt.set(step.slice, now + eventRetryMs)`, with the `now` read before `nextStep` | `retryAt` is the clock time at the failure plus `eventRetryMs`. A stalled video fails only after its watchdog (`ceil(d × 1.25) + 5` s), so for videos longer than about 236 s the retry time had already passed when it was stored, and the broken event was tried again at once, for ever. The set-back test `now < retryAt - eventRetryMs` now compares with the failure time. |
| Skip expiry while the playlist on air is failing (section 6) | Drop a skip at every boundary when `now >= retryAt` or the clock was set back | These two drops by time wait while the playlist on air is part-way through a run of failures (`consecutiveFailures > 0`); an entry whose event has ended is still dropped at once. Before, each retry restarted the playlist on air with a clean count, so a default whose items fail slowly (a round longer than `eventRetryMs`) never reached `all_failed`: no clear, no fault slate, no PLAYBACK_FAILED. A clock set back can now stretch a skip only to the end of the current failing run. docs/player-protocol-v1.md and the player README say the event is tried "at the next item boundary at which the playlist on air is not part-way through a run of failures". |
| Hold check (section 6) | The rule is checked after each minute-aligned sleep (`remaining > 0 && !playable → break`) | Checked at the top of each pass of the loop, v4 only. An item picked just before a minute edge, whose reveal (`presenter.show`) carried it past the edge, now ends at once instead of overrunning by up to 60 s. The time left still counts down by what was slept; v1 to v3 are unchanged (one sleep, no check). |
| Schedules list, Default playlist cell (section 7) | Default playlist (link to the playlist) | The link is capped at 28ch, with an ellipsis and the full name in its `title`. A percentage cap does not limit a no-wrap box in an auto-layout table cell, so a long playlist name pushed columns out of the table (at 1280 px the Default playlist column was dropped). |
| Event Start and End on a phone (section 7) | The event rows wrap at phone width (no sideways scroll) | Start and End keep their 160 px width and stack when the row is too narrow, instead of shrinking until a time such as "08:30 AM" is cut off. Checked from 320 to 1440 px on a static page that loads the portal CSS, not in the running portal. |
| Editor leave guard while saving (section 7) | `useLeaveGuard` | `useLeaveGuard(dirty, …)`, as in the playlist and screen editors: the guard stays on during the save request and turns off only once the save succeeds, so a failed save cannot lose edits without a warning. |
| Delete-schedule dialog opened again (section 7) | `DeleteScheduleDialog.tsx`, ConfirmDialog danger | Every open starts without the previous refusal and not busy, also when it opens again for the same schedule; the last schedule stays in the title while the dialog fades out. |
| Migration number (section 2) | `0008_stage_b_schedules.sql` | `0009_stage_b_schedules.sql`. While this slice was built, `main` gained `0008_null_safe_checks.sql` (backend review round 1, CX-02), which rewrote `publication_manifest_shape` in a NULL-safe form (`(…) IS TRUE`). 0009 keeps that form and only adds version 4, so the CX-02 fix is not undone. Layouts therefore take 0010. |
| Screens list "No playlist" on a screen that meanwhile got a schedule (section 7) | Success toast | The list's copy can be older than a schedule assigned in another tab. The PATCH then leaves the schedule in place, so instead of "Playlist unassigned" the list says "{name} now has a schedule" and how to remove it. An honest message, not a new option. |
| Screen page Change menu while "Remove content" saves (section 7) | The busy button | Arrow keys on the busy Change button no longer open the menu, and a save or a picker started while a save runs is ignored, so two saves cannot overlap. |
| Toast checks in the end-to-end files (section 8, e2e) | Not in the spec | Scoped to the Notifications region through a new `notifications(page)` helper in tests/e2e/support/portal.ts, in specs 08 and 09 and in `assignScheduleOnScreenPage`: 150 ms after a toast appears its words are copied into a hidden live region, and an unscoped `getByText` matched both. Spec 08 (slice 2) changed for its three toast checks only. |
| Keyboard create in spec 09 (section 8, e2e) | Not in the spec | The test waits until the page has settled (the empty state, or a loaded list whose count no longer reads "Loading schedules") before it focuses `schedules-create`: the empty state swaps in a new create button, and on the shared end-to-end database the list may not be empty. |

Open client questions (the build uses the default shown). Questions 6 to 9 are behaviour of `player-web/0.4.0`: after its release a different answer means a new player build and a reload of every screen.

| # | Question | Default used | If the answer differs |
|---|---|---|---|
| 1 | A calendar or week grid now? README row B said "with a calendar". | No: an ordered list of weekly events. README row B is reworded. | A portal-only addition on the same data (all-new CSS and a keyboard equivalent); the list stays as the accessible form. |
| 2 | Overlapping events | Allowed; the higher one in the list plays (Move up, Move down). | Refusing overlaps is a validation in the API and the editor; schedules saved meanwhile may hold overlaps. |
| 3 | One-off or dated events | Not in this slice; weekly only. Media availability windows cover "only between these dates". | Manifest v5 and a new player version. |
| 4 | Must a schedule have a default playlist? | Yes. Working hours give a black screen when wanted. | The column is `NOT NULL` and `publication.playlist_id` holds the default playlist: a schedule without one is a migration and a contract change. |
| 5 | Items across all playlists of one schedule | At most the route limit, 200 (`LIMIT_MAX_PLAYLIST_ITEMS`, up to 500). | Raise the setting, or give schedules their own limit (marked `shortcut:` in capability.ts). |
| 6 | Moment of change | Images and apps on the minute; a video finishes first. | Player change. |
| 7 | A playlist that comes back on | Starts from its first item (or a new shuffle). | Resume at the interrupted item is a player change (marked `shortcut:` in playback.ts). |
| 8 | Daylight saving | Wall-clock rule: the skipped hour skips the event, the repeated hour plays it twice. | Player change (spec section 11 rule 3 also asks for a "skipped on this date" notice in the editor; section 11 of this slice). |
| 9 | An event playlist in which nothing can be shown (every item outside its dates, or every item failing) | The next event that covers the moment plays; the default playlist only when none does. A failing playlist is tried again every five minutes while its event is on; errors are reported. | Player change. Decide before 0.4.0 is released: that release fixes the behaviour for every v4 manifest in the field. |
| 10 | Moving players to 0.4.0 | Manual page reload per screen, while the screen can reach the player host; no automatic reload. | An automatic reload is new work: today nothing reloads a running player, and the server stores no player version. |

### After this slice: layouts

Layouts were not built beside this slice: both builds would have claimed the same migration number, manifest version and player version, and both change how a screen records its content. They are the next slice of stage B. Guidance for it, from what this slice shipped:

- **Before it starts:** run the two end-to-end files of this slice (09 and 10) and get them green, apply 0009 to the development database, and have this slice committed. A layouts build on top of an unverified schedules build cannot tell its own faults from this slice's.
- **Numbers:** migration `0010` (now 0011: 0010 went to pairing hardening; see slice 4), manifest v5, `player-web/0.5.0`. 0001 to 0009 are never edited. v4 is frozen the moment `player-web/0.4.0` is released, so any new field or item shape is v5, through the single `manifestVersionFor`. The migration must replace the `publication_manifest_shape` CHECK once more (to accept `'5'`), which re-reads every publication under an ACCESS EXCLUSIVE lock: a quiet window again.
- **One version cut for everything that needs one.** Dated events (section 11) also cost v5. If the client wants them (question 3), put them into the same v5 as layouts, so one version is cut and every screen is reloaded once.
- **Model:** design on the shipped v4 shape. `assets` is one flat list and `schedule.playlists` names consecutive slices of it; regions of a layout can point at slices of the same flat list, which keeps the 0004 `publication_asset` guard, staging, verification, garbage collection, heartbeat v1 and `activeItemIndex` untouched, as they were here. `manifestPlaylists` is the version-free view the player already uses.
- **What a screen has assigned:** `display` now has `assigned_playlist_id` and `assigned_schedule_id` under the `display_one_assignment` CHECK (`num_nonnulls(...) <= 1`), column by column grants, and a PATCH rule in which a non-null id on one side clears the other in one UPDATE. A third kind of content must extend all three, and every place that reads "what is assigned" (`DisplayDto`, `PushPlanRow`, `assessDisplays`, the screen page's Content card, the push dialog, the screens list). `publication.playlist_id` is `NOT NULL` and holds the default playlist of a scheduled publication; decide what it holds for a layout.
- **Can a schedule's event show a layout?** Events name playlists only (section 11, "Also deferred"). Decide this in the layouts design, because it fixes whether v5 nests layouts in schedules or the reverse.
- **Rollout of v5:** nothing reloads a running player, so the reload rule of the release note applies again. A 0.4.0 player that is sent v5 keeps its content and retries on its backoff (it remembers the refused publication), so the 2-second poll of 0.3.0 does not repeat. The portal still cannot warn before a push: the server stores no player version.
- **Files this slice changed that a layouts slice will change again:** packages/contracts/src/{manifest, display, push, audit, errors, routes, index}.ts; packages/domain/src/{types, manifest, push, capability}.ts; apps/api/src/{app, publishing}.ts and routes/{displays, push, playlists}.ts; apps/player-web/src/{config, app}.ts, core/{playback, time-rules, sync}.ts, ui/presenter.ts; apps/portal/src/{App.tsx, shell/nav.ts, api/endpoints.ts}, features/planned/PlannedPage.tsx, features/displays/detail/ContentCard.tsx, the push dialog, lib/{playlistEditor, pushDialog, dashboard, screensList}.ts; the RLS test lists; docs/player-protocol-v1.md and this file. Do not run another build session on these files beside it.
- **Planned marker:** `/layouts` is still a `PlannedPage`, and the style guide's sample planned section is now "Layouts are planned"; both go when layouts are built.

## Stage B, slice 4: layouts (build spec)

Date: 2026-11-18. Read `README.md` and slices 1 to 3 of `stage-b.md` first, including "After this slice: layouts" at the end of slice 3. Ponytail rule as before: every known limit gets `// shortcut: <limit>, <when to upgrade>`; section 11 lists every one this slice adds. Paths are relative to the repository root. Every claim about existing code below was checked against the files on feat/stage-b-layouts (2068357); nothing was run.

**What it delivers:** a customer splits a screen into a main zone and a band along the bottom, each with its own playlist, and sets the band height from 5 to 50 %. A Ticker or Text app in the band's playlist is the MVP's text band (docs/tinnox-mvp-spec.md:60, :127; PL-04 at docs/acceptance-tests.md:77).

**Model in four sentences.** A layout is a named library object: two to four rectangles (zones), each with one playlist, stored in basis points of a screen's content area; zone 0 is the main zone. A screen has at most one of a playlist, a schedule or a layout assigned. A push resolves the zones to whole canvas pixels for that screen and copies every zone's playlist into one immutable publication (manifest v5). The player plays each zone as its own loop in its own box, and the main zone speaks for the screen (status, heartbeat, fault slate).

**Shape in one sentence.** Everything stays flat: a v5 publication is zone 0's items followed by each other zone's items in the one `assets[]`, plus a `zones` list that gives each zone its pixel rectangle, its item count, its transition and its shuffle, so the 0004 `publication_asset` guard, `createPublication`, media-URL authorisation, staging, verification, GC, heartbeat v1 and `activeItemIndex` are untouched, and the player hands each zone a version 3 view of its own run, so its playback code is untouched too.

**The rule behind the design.** The parts that freeze on release are general (the database, the API input, manifest v5 and player 0.5.0 all take two to four free rectangles); the part that is cheap to change later is small (the editor offers one preset). A free canvas editor (README row B, docs/portal-v2/README.md:26) is then portal-only work: no migration, no v6, no reload of every screen.

### 1. Version rule

- `manifestVersionFor(draft): 1 | 2 | 3 | 4 | 5` (domain manifest.ts:48-52): `5` exactly when `draft.zones !== null`, tested first; else the slice 3 rule. `zones` and `schedule` are never both set (`buildManifest` throws if they are).
- **A layout always gives v5.** A layout has two to four zones (contract minimum, section 3), so there is no collapse rule. A screen without a layout has `draft.zones === null`, and `manifestVersionFor` and `buildManifest` behave exactly as today, so those screens keep v1 to v4 byte for byte.
- **v5 = v3 plus `zones`.** It carries every v3 field (`manifestV2Object`, contracts manifest.ts:139-151). The top-level `transition` and `shuffle` are the main zone's. There is no `schedule` key (strict parsing refuses one) and no layout id or name, so no layout text reaches a player (as for schedules, docs/security/threat-model.md:154).
- **What a 0.4.0 player does with v5:** `parseManifest` gives `unsupported_version`; sync.ts reports `manifest_unsupported_version` and keeps its active version (or its waiting slate). It remembers the refused publication (apps/player-web/src/core/sync.ts:107-113) and retries on its update backoff, so the 2-second poll of 0.3.0 does not repeat. The server stores no player version, so the portal cannot warn before a push; the layout editor and the layout picker carry a fixed sentence (section 7), and the Overview hint under `manifest_unsupported_version` (apps/portal/src/features/displays/detail/OverviewTab.tsx:215-216) applies unchanged.
- Removing the layout from a screen (assigning a playlist or a schedule) makes the next draft v1 to v4; the push check reports `schemaVersion` and offers a push back.
- No header, no Vary, no negotiation; the ETag stays the publicationId.
- **Freeze:** v4 is frozen with `player-web/0.4.0`. v5 is frozen the moment `player-web/0.5.0` is released; the next addition (dated events, layouts in schedules) is v6. Client questions 4 and 5 (section 13) must be answered before 0.5.0 ships.
- **Deploy order inside the release:** the API must run the v5 `ManifestSchema` before any v5 row is stored, because `GET /player/manifest` throws on a stored manifest that fails `ManifestSchema` (apps/api/src/routes/player.ts:431-432). One build ships contracts, API and migration together, so this holds.

### 2. Migration `db/migrations/0011_stage_b_layouts.sql`

0010 is `0010_pairing_hardening.sql` (security review round 3), so layouts take 0011. 0001 to 0010 are never edited.

```sql
-- 0011: portal v2, stage B slice 4: layouts (docs/portal-v2/stage-b.md, slice 4). 0001 to 0010 are unchanged.
--
--   1. layout: a named split of a screen into zones.
--   2. layout_zone: the two to four zones of a layout, each a rectangle with a playlist; 0 is the main zone.
--   3. Deleted playlists: a layout cannot use one, and a playlist that a layout uses cannot be deleted.
--   4. display: a screen has one of a playlist, a schedule or a layout assigned.
--   5. Row-level security and runtime grants.
--   6. publication: the manifest may be schema version 1, 2, 3, 4 or 5.
--
-- Every bound has its twin in packages/contracts (LAYOUT_UNITS, LayoutInputSchema, ABSOLUTE.maxLayoutZones).
-- Takes ACCESS EXCLUSIVE locks on display and publication until commit, reads every display row and
-- re-reads every publication row to validate the new CHECKs; run it while the API is stopped or idle.

-- ----------------------------------------------------------------------- 1. layout

CREATE TABLE public.layout (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organization (id),
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  CONSTRAINT layout_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT layout_name_trimmed CHECK (name = btrim(name)),
  CONSTRAINT layout_description_length CHECK (char_length(description) BETWEEN 1 AND 500)
);
CREATE INDEX layout_org_idx ON public.layout (org_id, created_at);
CREATE TRIGGER layout_set_updated_at BEFORE UPDATE ON public.layout
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------ 2. layout_zone

-- Rows are replaced as a set (delete, then insert), never updated; position is the identity.
CREATE TABLE public.layout_zone (
  layout_id   uuid NOT NULL,
  -- 0 is the main zone: it speaks for the screen. Twin of ABSOLUTE.maxLayoutZones (4).
  position    integer NOT NULL,
  org_id      uuid NOT NULL REFERENCES public.organization (id),
  playlist_id uuid NOT NULL,
  -- Basis points (1/10 000) of each screen's content rectangle, origin top-left (LAYOUT_UNITS).
  x_bp        integer NOT NULL,
  y_bp        integer NOT NULL,
  width_bp    integer NOT NULL,
  height_bp   integer NOT NULL,
  PRIMARY KEY (layout_id, position),
  CONSTRAINT layout_zone_position_range CHECK (position BETWEEN 0 AND 3),
  CONSTRAINT layout_zone_in_bounds CHECK (
    x_bp >= 0 AND y_bp >= 0 AND width_bp >= 1 AND height_bp >= 1
    AND x_bp + width_bp <= 10000 AND y_bp + height_bp <= 10000
  ),
  CONSTRAINT layout_zone_layout_fk FOREIGN KEY (layout_id, org_id)
    REFERENCES public.layout (id, org_id) ON DELETE CASCADE,
  CONSTRAINT layout_zone_playlist_fk FOREIGN KEY (playlist_id, org_id)
    REFERENCES public.playlist (id, org_id)
);
-- Layouts that use a given playlist (the fourth EXISTS of playlist_delete_guard).
CREATE INDEX layout_zone_playlist_idx ON public.layout_zone (playlist_id);

-- ------------------------------------------------------------ 3. deleted playlists

-- Same rule and same locking as schedule_playlist_guard (0009): using a playlist takes a share
-- lock on its row, which the UPDATE that deletes the playlist must hold exclusively, so one of
-- the two waits for the other and then sees its result. The error carries the trigger's name.
CREATE FUNCTION public.layout_zone_playlist_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  is_deleted boolean;
BEGIN
  -- A playlist that does not exist in this organisation is left to the foreign key.
  SELECT p.deleted_at IS NOT NULL INTO is_deleted
  FROM public.playlist p
  WHERE p.id = NEW.playlist_id AND p.org_id = NEW.org_id
  FOR SHARE;
  IF FOUND AND is_deleted THEN
    RAISE EXCEPTION 'a deleted playlist cannot be used in a layout'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = TG_NAME;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER layout_zone_playlist_guard
  BEFORE INSERT OR UPDATE OF playlist_id ON public.layout_zone
  FOR EACH ROW EXECUTE FUNCTION public.layout_zone_playlist_guard();
REVOKE ALL ON FUNCTION public.layout_zone_playlist_guard() FROM PUBLIC;

-- The 0009 function, replaced in place: it now also refuses while a layout uses the playlist.
-- Same trigger, same constraint name, same privileges (CREATE OR REPLACE keeps the 0005 REVOKE).
CREATE OR REPLACE FUNCTION public.playlist_delete_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND (
    EXISTS (SELECT 1 FROM public.display d
            WHERE d.assigned_playlist_id = OLD.id AND d.org_id = OLD.org_id)
    OR EXISTS (SELECT 1 FROM public.schedule s
               WHERE s.default_playlist_id = OLD.id AND s.org_id = OLD.org_id)
    OR EXISTS (SELECT 1 FROM public.schedule_event e
               WHERE e.playlist_id = OLD.id AND e.org_id = OLD.org_id)
    OR EXISTS (SELECT 1 FROM public.layout_zone z
               WHERE z.playlist_id = OLD.id AND z.org_id = OLD.org_id)
  ) THEN
    RAISE EXCEPTION 'a playlist that is assigned to a display or used by a schedule or a layout cannot be deleted'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'playlist_delete_guard';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------- 4. display

ALTER TABLE public.display
  -- The layout a push would publish to this display. Assigning changes nothing on the display.
  ADD COLUMN assigned_layout_id uuid,
  ADD CONSTRAINT display_assigned_layout_fk FOREIGN KEY (assigned_layout_id, org_id)
    REFERENCES public.layout (id, org_id),
  -- Same name as in 0009 (pinned by packages/db/test/stage-b-schedules.integration.test.ts).
  DROP CONSTRAINT display_one_assignment,
  ADD CONSTRAINT display_one_assignment
    CHECK (num_nonnulls(assigned_playlist_id, assigned_schedule_id, assigned_layout_id) <= 1);
-- Displays that have a given layout assigned (count per layout, refusal of a delete).
CREATE INDEX display_assigned_layout_idx ON public.display (assigned_layout_id)
  WHERE assigned_layout_id IS NOT NULL;

-- -------------------------------------------------------------- 5. RLS and grants

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['layout', 'layout_zone'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id())', t);
  END LOOP;
END $$;

-- Least privilege. A layout's identity is never updatable; zone rows are only added and removed.
GRANT SELECT, INSERT, DELETE ON public.layout TO tinnox_app;
GRANT UPDATE (name, description) ON public.layout TO tinnox_app;
GRANT SELECT, INSERT, DELETE ON public.layout_zone TO tinnox_app;
-- display is granted column by column. Required: the display PATCH writes every column.
GRANT UPDATE (assigned_layout_id) ON public.display TO tinnox_app;

-- ------------------------------------------------------------------ 6. publication

-- Last in the file, so the ACCESS EXCLUSIVE lock on publication is held for the shortest time.
-- The NULL-safe form of 0008 and 0009 (IS TRUE: a missing field fails instead of passing), with 5 added.
ALTER TABLE public.publication DROP CONSTRAINT publication_manifest_shape,
  ADD CONSTRAINT publication_manifest_shape CHECK (
    (
      jsonb_typeof(manifest) = 'object'
      AND manifest ->> 'schemaVersion' IN ('1', '2', '3', '4', '5')
      AND manifest ->> 'publicationId' = id::text
      AND manifest ->> 'displayId' = display_id::text
      AND jsonb_typeof(manifest -> 'assets') = 'array'
      AND jsonb_array_length(manifest -> 'assets') BETWEEN 1 AND 500
      AND pg_column_size(manifest) <= 1048576
    ) IS TRUE
  );
```

End the file with the two final-check DO blocks of 0009 (db/migrations/0009_stage_b_schedules.sql:185-225), unchanged except `unnest(ARRAY['layout', 'layout_zone'])` in the tenant-policy check. No `sec.*` function changes, so the file needs no `SET LOCAL ROLE`. No data is backfilled.

The CHECK is replaced exactly as 0009 replaced it (0009:150-162): a plain `DROP` and `ADD`, so PostgreSQL re-reads every publication under the ACCESS EXCLUSIVE lock. The new list is a strict superset of the old one, so every existing row passes. There is no `NOT VALID`.

Facts that follow from the SQL:
- `publication.playlist_id` (NOT NULL, db/migrations/0001_schema.sql:270) holds the **main zone's playlist** of a layout's publication. No `layout_id` column: a layout is hard-deleted and a publication lives for ever, as for schedules; the audit detail carries the id.
- Deleting a layout that a screen has assigned fails on `display_assigned_layout_fk` (23503). Deleting a layout removes its zones (cascade).
- Hard-deleting a playlist that a zone uses fails on `layout_zone_playlist_fk`; the API only soft-deletes, which the replaced guard refuses (23001, `playlist_delete_guard`). Putting a deleted playlist in a zone fails with 23001, constraint `layout_zone_playlist_guard`.
- **Not database rules**, because they span rows: no overlap, at least two zones, and positions without gaps. The contract refuses the first two (section 3), and the API only writes positions 0 to n-1. A row set that breaks them can only come from direct SQL; `buildManifest`'s self-check (packages/domain/src/manifest.ts:134-142) is then the last line and the push answers 500.
- `x_bp + width_bp` overflows only for values near 2^31; such a row is refused with 22003 instead of 23514. The contract caps every value at 10 000.
- **NULL safety:** every column in a new CHECK is NOT NULL, except `description`, where NULL means "no description" and is meant to pass (as `schedule_description_length`, 0009:28). `num_nonnulls` never returns NULL.
- **Locks, all held until 0011 commits**, because the runner applies each file in one transaction with its `schema_migrations` row (packages/db/src/migrate.ts:97-104):
  - ACCESS EXCLUSIVE on `display` (ADD COLUMN without a default, so no rewrite; the CHECK and the foreign key scan the table);
  - ACCESS EXCLUSIVE on `publication`, taken by the last statement, which re-reads every row;
  - SHARE ROW EXCLUSIVE on `organization`, `playlist` and `layout` for the new foreign keys.
  - The migrator's `lock_timeout` is 30 s (infra/postgres/init/01-roles.sh:44). The header says to run it while the API is stopped or idle (a quiet window), as 0009:11-12 does.
- `packages/db/src/constraints.ts` (`STAGE_B_CONSTRAINTS`, :42-48) gains:
  ```ts
  /**
   * 23503: on a display, the layout does not exist in this organisation; on a layout, a
   * delete was attempted while a display has it assigned.
   */
  displayAssignedLayout: 'display_assigned_layout_fk',
  ```
  and its doc comment (:37-41) becomes "The names of db/migrations/0009_stage_b_schedules.sql and 0011_stage_b_layouts.sql that a caller has to tell apart. Deleted playlists keep their stage A names: `playlist_delete_guard` now also refuses while a schedule or a layout uses the playlist." It is the only new name a caller has to tell apart.

### 3. Contracts (packages/contracts, all objects `.strict()`)

**ids.ts:** `LayoutIdSchema = UuidSchema`, `type LayoutId = Uuid` (after `ScheduleIdSchema`, :18, :33).

**refs.ts:** `LayoutRefSchema = z.object({ id: LayoutIdSchema, name: refName }).strict()`, `type LayoutRef` (after `ScheduleRefSchema`, :16-17).

**limits.ts:** `ABSOLUTE.maxLayoutZones: 4`, after `maxScheduleEvents` (:104-105), with the doc comment "Zones in one layout. Twin of the layout_zone position CHECK (0011). The ceiling of manifest v5, frozen with player 0.5.0." Why 4: it is the wire ceiling that 0.5.0's strict parser freezes, so a later free editor with three or four zones (for example main, band, clock or date; stage-b.md:809) needs no v6; it bounds the worst case at 8 `<video>` elements (2 per zone while items swap, apps/player-web/src/ui/presenter.ts:184-200); Pi-class hardware already lags with more than one moving zone (docs/research/round2/AV4-layouts-scheduling.md:56); the preset uses 2.

**canvas.ts:** one new function, used by layout.ts and manifest.ts:
```ts
/** True when the interiors of two rectangles intersect; rectangles that only touch do not overlap. Any unit. */
export function rectsOverlap(
  a: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  b: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
```

**layout.ts (new; `export * from './layout.ts'` in index.ts after `./canvas.ts`).** Imports only ids, limits, refs, text and canvas. It must never import playlist.ts, which imports manifest.ts (packages/contracts/src/playlist.ts:14).
```ts
/** Zone geometry is in basis points of each screen's content rectangle: 10 000 is its whole width or height. Twin of layout_zone_in_bounds (0011). */
export const LAYOUT_UNITS = 10_000;

const offset = z.number().int().min(0).max(LAYOUT_UNITS);
const extent = z.number().int().min(1).max(LAYOUT_UNITS);
/** A zone's rectangle, origin top-left, in basis points (a plain shape: zod refuses `.extend()` on a refined object). */
export const layoutBoxShape = { x: offset, y: offset, width: extent, height: extent };
export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The cross-zone checks of a layout: every zone ends inside the area, and no two zones overlap
 * (touching is allowed). Paths use the dotted form the API gives (`zones.1.width`).
 */
export function checkLayoutZones(zones: readonly LayoutBox[], ctx: z.RefinementCtx): void {
  zones.forEach((zone, n) => {
    if (zone.x + zone.width > LAYOUT_UNITS) {
      ctx.addIssue({ code: 'custom', path: ['zones', n, 'width'], message: 'x + width must not exceed 10000' });
    }
    if (zone.y + zone.height > LAYOUT_UNITS) {
      ctx.addIssue({ code: 'custom', path: ['zones', n, 'height'], message: 'y + height must not exceed 10000' });
    }
    const earlier = zones.slice(0, n).findIndex((other) => rectsOverlap(other, zone));
    if (earlier !== -1) {
      // Both zones counted from 1, as zone_too_small names its zone; the path counts from 0.
      ctx.addIssue({ code: 'custom', path: ['zones', n], message: `zone ${n + 1} overlaps zone ${earlier + 1}` });
    }
  });
}

export const LayoutZoneInputSchema = z.object({ playlistId: PlaylistIdSchema, ...layoutBoxShape }).strict();
export type LayoutZoneInput = z.infer<typeof LayoutZoneInputSchema>;

export const LayoutInputSchema = z
  .object({
    name: NameSchema,
    description: DescriptionInputSchema.optional(),
    /** Position order: [0] is the main zone. */
    zones: z.array(LayoutZoneInputSchema).min(2).max(ABSOLUTE.maxLayoutZones),
  })
  .strict()
  .superRefine((input, ctx) => {
    checkLayoutZones(input.zones, ctx);
  });
export type LayoutInput = z.infer<typeof LayoutInputSchema>;

export const LayoutZoneDtoSchema = z.object({ playlist: PlaylistRefSchema, ...layoutBoxShape }).strict();
export type LayoutZoneDto = z.infer<typeof LayoutZoneDtoSchema>;

export const LayoutDtoSchema = z
  .object({
    id: LayoutIdSchema,
    name: z.string(),
    description: DescriptionSchema.nullable(),
    /** Position order: [0] is the main zone. */
    zones: z.array(LayoutZoneDtoSchema).min(2).max(ABSOLUTE.maxLayoutZones),
    /** How many displays have this layout assigned. */
    assignedDisplayCount: z.number().int().nonnegative(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type LayoutDto = z.infer<typeof LayoutDtoSchema>;

export const LayoutListResponseSchema = z
  .object({ items: z.array(LayoutDtoSchema).max(ABSOLUTE.maxListItems) })
  .strict();
export type LayoutListResponse = z.infer<typeof LayoutListResponseSchema>;
```
- Doc comment on `LayoutInputSchema` (as on `ScheduleInputSchema`, packages/contracts/src/schedule.ts:80-93): `POST /api/layouts` and `PUT /api/layouts/:id`, the whole layout. On PUT an absent `description` is left as it is; null or a blank string clears it. An unknown or deleted playlist answers 400. **A refusal of this body names its fields with dots**, as `parseInput` joins zod paths (apps/api/src/errors.ts:46): `name`, `description`, `zones`, `zones.1`, `zones.1.playlistId`, `zones.1.x`, `zones.1.width` (the zone index counts from 0). The bracket form (`zones[1].playlist`) belongs to push issues only.
- One DTO serves the list and the detail: a layout has at most four child rows.

**display.ts**
- `export const ASSIGNMENT_KEYS = ['assignedPlaylistId', 'assignedScheduleId', 'assignedLayoutId'] as const; export type AssignmentKey = (typeof ASSIGNMENT_KEYS)[number];` This one list drives the patch refinement below, the API PATCH and its audit (section 5) and the portal's `ASSIGNMENT_FIELDS` (apps/portal/src/lib/activity.ts:272).
- `AssignedLayoutSchema = z.object({ id: LayoutIdSchema, name: z.string().min(1).max(ABSOLUTE.maxNameLength), mainPlaylist: PlaylistRefSchema }).strict()`, `type AssignedLayout`, modelled on `AssignedScheduleSchema` (:55-66). The main zone's playlist is carried so the screen page can preview it without a second round trip.
- `DisplayDtoSchema += assignedLayout: AssignedLayoutSchema.nullable()` (required), after `assignedSchedule` (:95-99). Its doc comment: at most one of `assignedPlaylist`, `assignedSchedule` and `assignedLayout` is set.
- `DisplayPatchSchema += assignedLayoutId: LayoutIdSchema.nullable().optional()`. The refinement at :155-162 is replaced by a `.superRefine` that needs a path chosen at run time:
  ```ts
  // Each id is a string, null or absent: two strings name two kinds of content.
  .superRefine((p, ctx) => {
    const second = ASSIGNMENT_KEYS.filter((key) => typeof p[key] === 'string')[1];
    if (second !== undefined) {
      ctx.addIssue({ code: 'custom', path: [second], message: 'assign one of a playlist, a schedule or a layout' });
    }
  })
  ```
  The path is the second string key in `ASSIGNMENT_KEYS` order, so a playlist and a schedule keep the path `assignedScheduleId`. The message changes: the two pins that move are packages/contracts/src/portal-v2.test.ts:737 and apps/api/test/schedules.integration.test.ts:577.
- The patch doc comment (:126-139): "`assignedLayoutId`: an unknown layout answers 404. A display has one of a playlist, a schedule or a layout: a non-null id clears the other two, null clears its own kind only, and all three keys null removes all content. Two non-null ids are refused."

**push.ts**
- `PushPlanRowSchema += layout: LayoutRefSchema.nullable()` (required), after `schedule` (:65-66). For a display with a layout, `playlist` is **the main zone's playlist**, so the refinement at :75-81 stays as it is. Two refinements are added in the `superRefine`:
  - `row.layout !== null && row.playlist === null`: path `['layout']`, message `'a row with a layout carries the playlist of its main zone'`;
  - `row.layout !== null && row.schedule !== null`: path `['layout']`, message `'a row has a schedule or a layout, not both'`.
- The `playlist` doc comment (:60-63) adds "or for a display with a layout the main zone's playlist"; the `schedule` one says "null for a display with a playlist, a layout or nothing assigned"; the `layout` one says "The assigned layout; null otherwise".
- The `PushIssueSchema` path doc (:39-46) adds: "`zones[n].playlist`, `zones[n].items[k]`, `zones[n]` (the zone is too small on this screen) or `layout` for a layout (n is the zone, from 0; item numbers count inside that zone's playlist; `layout` is a problem of all its playlists together)". `PUSH_STATES` doc (:10): "nothing_assigned: no playlist, schedule or layout is assigned".

**manifest.ts**
```ts
export const MANIFEST_SCHEMA_VERSION_V5 = 5;

/**
 * One zone of a layout's manifest: a rectangle in canvas pixels, inside the content rectangle
 * (the whole canvas when there is none), and the next `count` entries of `assets`, played with
 * this zone's transition and shuffle. `zones[0]` is the main zone.
 */
export const ManifestZoneSchema = z
  .object({
    rect: RectSchema,
    count: z.number().int().positive().max(ABSOLUTE.maxPlaylistItems),
    transition: TransitionSchema,
    shuffle: z.boolean(),
  })
  .strict();
export type ManifestZone = z.infer<typeof ManifestZoneSchema>;

/** Checks of version 5: those of version 2 over the flat list, plus the zones. */
function checkManifestV5Body(
  m: Pick<ManifestV3, 'canvas' | 'contentRect' | 'assets' | 'transition' | 'shuffle'> & {
    zones: ManifestZone[];
  },
  ctx: z.RefinementCtx,
): void {
  checkManifestV2Body(m, ctx);
  if (m.zones.reduce((sum, zone) => sum + zone.count, 0) !== m.assets.length) {
    ctx.addIssue({ code: 'custom', path: ['zones'], message: 'zone counts must add up to the number of assets' });
  }
  const first = m.zones[0];
  if (first !== undefined && (first.transition !== m.transition || first.shuffle !== m.shuffle)) {
    ctx.addIssue({ code: 'custom', path: ['zones', 0], message: 'the first zone must carry the top-level transition and shuffle' });
  }
  const area = m.contentRect ?? { x: 0, y: 0, width: m.canvas.width, height: m.canvas.height };
  m.zones.forEach((zone, i) => {
    const r = zone.rect;
    if (r.x < area.x || r.y < area.y || r.x + r.width > area.x + area.width || r.y + r.height > area.y + area.height) {
      ctx.addIssue({ code: 'custom', path: ['zones', i, 'rect'], message: 'the zone must lie inside the content rectangle' });
    }
    if (m.zones.slice(0, i).some((other) => rectsOverlap(other.rect, r))) {
      ctx.addIssue({ code: 'custom', path: ['zones', i, 'rect'], message: 'zones must not overlap' });
    }
  });
}

/**
 * Manifest version 5: version 3 plus `zones`. Written exactly when the screen has a layout
 * assigned. `assets` is every zone's items in one flat list, zone 0 (the main zone) first; the
 * top-level `transition` and `shuffle` are the main zone's. No layout id or name: a player reads
 * neither. Frozen once player 0.5.0 is released; the next addition is version 6.
 */
export const ManifestV5Schema = manifestV2Object
  .extend({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION_V5),
    assets: z.array(ManifestItemV3Schema).min(1).max(ABSOLUTE.maxPlaylistItems),
    zones: z.array(ManifestZoneSchema).min(2).max(ABSOLUTE.maxLayoutZones),
  })
  .strict()
  .superRefine(checkManifestV5Body);
export type ManifestV5 = z.infer<typeof ManifestV5Schema>;
```
- Built from `manifestV2Object`, because V4 is refined and cannot be extended (:139-151, :272-279). `rectsOverlap` is imported from canvas.ts.
- **Flat list.** Zone *i* plays `assets[from_i, from_i + count_i)`, zone 0 first.
- **The same playlist in two zones** is sent twice and counts twice against `maxItems`. The schedule's de-duplication (packages/domain/src/schedule.ts:45-49) is not copied: it would merge two zones into one run.
- `ManifestSchema` (:289-294) gains `ManifestV5Schema`. `manifestV2Facts` needs no change (its body tests `=== 1`).
- **`manifestZones`**, new, next to `manifestPlaylists`:
  ```ts
  /**
   * The zones of any manifest, each as a manifest a player can play on its own, so player code
   * has no version branches. Versions 1 to 4 give `[m]`, the same object. Version 5 gives one
   * version 3 view per zone: the zone's run of `assets`, the zone's transition and shuffle, and
   * the zone's rectangle as the content rectangle; every other field is copied from `m`.
   * Built on the player; never stored or sent.
   */
  export function manifestZones(m: Manifest): Exclude<Manifest, ManifestV5>[] {
    if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION_V5) return [m];
    let from = 0;
    return m.zones.map((zone): ManifestV3 => {
      const view: ManifestV3 = {
        schemaVersion: MANIFEST_SCHEMA_VERSION_V3,
        publicationId: m.publicationId,
        displayId: m.displayId,
        createdAt: m.createdAt,
        canvas: m.canvas,
        contentRect: zone.rect,
        muted: m.muted,
        timeZone: m.timeZone,
        transition: zone.transition,
        shuffle: zone.shuffle,
        rotation: m.rotation,
        workingHours: m.workingHours,
        assets: m.assets.slice(from, from + zone.count),
      };
      from += zone.count;
      return view;
    });
  }
  ```
  The views have `schemaVersion: 3`, so the player's `=== 4` gates (apps/player-web/src/core/playback.ts:409; core/time-rules.ts:93, :136; apps/player-web/src/app.ts:726) never see v5, and every "slice 0" fallback (time-rules.ts:123, :126, :137) is the zone's own run by construction.
- `manifestPlaylists` (:330-346) gains an explicit v5 branch that returns one slice per zone with a running `from` (count, transition and shuffle of the zone), so it stays honest. Its doc comment says so.
- `parseManifest` (:352-396): case 5 (`ManifestV5Schema`); the `schema` type gains it; the message becomes "expected 1, 2, 3, 4 or 5", built from the five constants.
- Doc comment on `ManifestV4Schema` (:266-271): "Frozen." (drop "once player 0.4.0 is released; the next addition is version 5").

**playlist.ts:** `PUBLISH_REJECTION_CODES += 'zone_too_small'` after `'multiple_regions_unsupported'` (:220), 19 codes. This widens the strict `PublishRejectionCodeSchema` used by `PushIssueSchema.code` (push.ts:52), so a portal tab still open on the previous build fails to parse a push plan with a blocked row that carries it (release note, section "Slice 4: release note and rollback"). No exhaustive map in the code consumes the list.

**audit.ts:** `AUDIT_ACTIONS += 'layout.create', 'layout.update', 'layout.delete'` after the schedule actions (:33-35); `AUDIT_CATEGORIES += 'layout'` after `schedule` (:54).

**errors.ts:** `API_ERROR_CODES += 'layout_in_use'` after `schedule_in_use` (:22).

**routes.ts:** after the schedule routes (:75-79):
```ts
  /** GET, POST. */
  layouts: '/api/layouts',
  /** GET, PUT, DELETE (409 `layout_in_use` while a display has it assigned). */
  layoutPattern: '/api/layouts/:id',
  layout: (id: string) => `/api/layouts/${enc(id)}`,
```
The comment on `playlistPattern` (:66) becomes "…while a display has it assigned or a schedule or a layout uses it". Without these entries the session-csrf test misses the routes silently (tests/integration/session-csrf.test.ts:113-116 walks `ROUTES`).

**`publication.playlist_id`** holds the main zone's playlist (section 2).

### 4. Domain (packages/domain)

**types.ts**
- Remove `regions: 1` and its comment (:139-140). Its only writer is packages/domain/src/playlist.ts:230 and its only reader is packages/domain/src/capability.ts:25-29.
- Add, after `DraftSchedule` (:112-129):
  ```ts
  /**
   * One zone of a layout's publication: a rectangle in canvas pixels, already resolved for the
   * target display, and a run of `count` consecutive entries of the draft's `items`. [0] is the
   * main zone; its run starts at 0.
   */
  export interface DraftZone {
    readonly rect: Rect;
    readonly count: number;
    readonly transition: Transition;
    readonly shuffle: boolean;
  }
  ```
- `PublicationDraft += readonly zones: readonly DraftZone[] | null` (required), after `schedule`, with the doc comment "Null unless a layout is assigned. Never set together with `schedule`." The doc comments of `items` and `transition` (:142-145) add "with a layout: every zone's items, main zone first" and "the main zone's".

**playlist.ts:** `buildPublicationDraft` (:224-239) drops `regions: 1` and sets `zones: null`. No other change.

**geometry.ts:** one new pure function, used by the planner and the portal preview (the portal already depends on `@tinnox/domain`, apps/portal/package.json:16):
```ts
/**
 * A zone's rectangle in canvas pixels. `area` is the effective content rectangle (the content
 * rectangle, or the whole canvas) and `zone` is in basis points of it (LAYOUT_UNITS). Edges are
 * rounded, not sizes: two zones that share an edge in basis points share it in pixels, so they
 * never gap or overlap, and rounding is monotone, so disjoint zones stay disjoint. The products
 * are at most 16 384 × 10 000, exact in doubles.
 */
export function zoneRect(area: Rect, zone: LayoutBox): Rect {
  const x0 = area.x + Math.round((area.width * zone.x) / LAYOUT_UNITS);
  const x1 = area.x + Math.round((area.width * (zone.x + zone.width)) / LAYOUT_UNITS);
  const y0 = area.y + Math.round((area.height * zone.y) / LAYOUT_UNITS);
  const y1 = area.y + Math.round((area.height * (zone.y + zone.height)) / LAYOUT_UNITS);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
```
`LAYOUT_UNITS` and `type LayoutBox` come from `@tinnox/contracts`. The zone origin is added (`area.x +`), because `effectiveContentRect` (:39-52) returns a non-zero origin when a content rectangle is set. A resolved side may be 0 or under 16 px on a small canvas; the planner refuses that (below), never clamps.

**capability.ts**
- `scheduleTotalMessage` (:8-11) is replaced by:
  ```ts
  /** Why the playlists of a schedule or a layout are refused together: their item total is over the route's limit. */
  export function contentTotalMessage(owner: 'schedule' | 'layout', total: number, route: string, max: number): string {
    return `The playlists of this ${owner} hold ${total} items in total; ${route} supports up to ${max}.`;
  }
  ```
  The schedule sentence stays byte for byte.
- `export function regionCount(draft: PublicationDraft): number { return draft.zones?.length ?? 1; }` drives the check at :25-31 (`regionCount(draft) > profile.maxRegions`, and the message names `regionCount(draft)`), so the count has one source.
- Above it: `// shortcut: a layout may put video in every zone (up to 8 <video> elements while items swap); add CapabilityProfile.maxVideoRegions if Pi-class players lag (AV4:56).`
- The `too_many_items` message (:57-66) branches: `draft.zones !== null` gives `contentTotalMessage('layout', …)`, `draft.schedule !== null` gives `contentTotalMessage('schedule', …)`, otherwise today's playlist sentence.

**sources.ts (new; export from index.ts after `./schedule.ts`).** Lifted from schedule.ts:51-99, so the schedule and the layout planners share one planning step:
```ts
/**
 * One playlist for the target display: its name, its number of items, and `plan`, which plans
 * it (planPublication with the display, records, limits and route bound) when called.
 * Undefined: the playlist no longer exists. Called once per source, with the id in lower case.
 * A layout may name one playlist in two zones, so `plan` may run twice for one id and must be pure.
 */
export type PlanPlaylist = (playlistId: string) =>
  | { readonly name: string; readonly itemCount: number; readonly plan: () => PlanPublicationResult }
  | undefined;

/** One playlist of a schedule or a layout, and where it is used: `default`, `events[n]` or `zones[n]`. */
export interface PlanSource {
  readonly source: string;
  readonly playlistId: string;
}

export type PlannedSources =
  | { readonly ok: true; readonly drafts: readonly PublicationDraft[] }
  | { readonly ok: false; readonly issues: readonly PublishIssue[] };

export function planSources(
  sources: readonly PlanSource[],
  planPlaylist: PlanPlaylist,
  route: PublicationValidator,
  owner: 'schedule' | 'layout',
): PlannedSources;
```
It takes **a list**, never the schedule's Map, so a layout's two zones on one playlist stay two sources. In this order:
1. `found = sources.map(...)`, `planPlaylist(playlistId)` for each.
2. When `sources.length > 1` and every playlist exists: the raw total (`itemCount` summed); over `route.capabilities().maxItems` it returns the one issue `{ index: null, code: 'too_many_items', path: owner, message: contentTotalMessage(owner, total, profile.label, profile.maxItems) }` and plans nothing. Keep `// shortcut: one total for all playlists of a schedule or a layout; give them their own limit if 200 proves tight.`
3. A missing playlist gives `` { index: null, code: 'playlist_empty', path: `${source}.playlist`, message: `A playlist of this ${owner} no longer exists. Open the ${owner} and choose another.` } `` (the schedule's wording, byte for byte, for `owner` `schedule`).
4. A failed plan gives its issues with `` path: `${source}.${issue.index === null ? 'playlist' : `items[${issue.index}]`}` `` and `` message: `In playlist "${name}": ${issue.message}` ``. Keep the moved `// shortcut: a display-level refusal (canvas, content rectangle) is repeated once per playlist; the browser route never raises one. De-duplicate when a route that can ships.`
5. Any issue: `{ ok: false, issues }`; otherwise `{ ok: true, drafts }` in source order.

**schedule.ts:** `SchedulePlanInput.planPlaylist` becomes `readonly planPlaylist: PlanPlaylist` (the doc comment at :14-19 moves to `PlanPlaylist`). `planSchedulePublication` keeps its Map de-duplication (:43-49) and its collapse rule (:104-105) and replaces :51-99 with `const planned = planSources([...sources].map(([playlistId, source]) => ({ source, playlistId })), input.planPlaylist, input.route, 'schedule'); if (!planned.ok) return planned; const drafts = planned.drafts;`. So `sources.size > 1` keeps its meaning. **packages/domain/src/schedule.test.ts is the pin of this extraction and must not change** (it does not mention `regions`).

**layout.ts (new; export from index.ts)**
```ts
export interface LayoutPlanInput {
  readonly canvas: Canvas;
  readonly contentRect: Rect | null;
  /** Two to ABSOLUTE.maxLayoutZones zones in position order; [0] is the main zone. Basis points (LAYOUT_UNITS). */
  readonly zones: readonly ({ readonly playlistId: string } & LayoutBox)[];
  readonly planPlaylist: PlanPlaylist;
  /** Judges the combined draft: the number of regions and the item total. */
  readonly route: PublicationValidator;
}
export function planLayoutPublication(input: LayoutPlanInput): PlanPublicationResult;
```
Rule, in this order:
1. `area = effectiveContentRect(canvas, contentRect)`; `rects = zones.map((zone) => zoneRect(area, zone))`. Every zone with a side under `ABSOLUTE.minCanvasSidePx` (16, the `RectSchema` floor, packages/contracts/src/canvas.ts:18) gives `` { index: null, code: 'zone_too_small', path: `zones[${n}]`, message: `On this screen zone ${n + 1} of the layout is ${w} × ${h} px; a zone needs at least 16 px each way. Make it larger in the layout, or assign other content.` } `` (`×` is U+00D7; zone 1 is the main zone). Any such issue: return all of them and plan nothing. Without this check `buildManifest`'s self-check throws and the request answers 500 (manifest.ts:134-142). Example: a 96 px tall LED canvas with a 10 % band gives a 10 px band (blocked); 20 % gives 19 px (plays).
2. `` planned = planSources(zones.map((zone, n) => ({ source: `zones[${n}]`, playlistId: zone.playlistId.toLowerCase() })), planPlaylist, route, 'layout') ``, with **no de-duplication**; not ok: return its issues. `// shortcut: a playlist in two zones is sent twice; share a run by index if the item total bites.`
3. The combined draft: `{ ...main, items: drafts.flatMap((d) => d.items), zones: drafts.map((d, n) => { const rect = rects[n]; if (rect === undefined) throw new Error('a zone has no rectangle'); return { rect, count: d.items.length, transition: d.transition, shuffle: d.shuffle }; }) }`. Every count is positive: an empty playlist is already refused as `playlist_empty` by its own plan.
4. `route.validate(combined)`: any issue is returned with `path: 'layout'`; otherwise `{ ok: true, draft: combined }`. With the browser route only the region count (`maxRegions` 4) and the total can fail here.
`const [main] = drafts` is always set after a clean step 2; if it is not, throw `new Error('a layout always has a main zone')` with the comment "Unreachable: with no issue there is one draft per zone." (as schedule.ts:101-103). The `rects[n]` guard in step 3 is unreachable too (one rectangle per zone). Both guards are what make step 3 typecheck: the repository sets `noUncheckedIndexedAccess` (tsconfig.base.json:9), so an indexed read is `T | undefined`.

**manifest.ts**
- `manifestVersionFor` (:44-52): `if (draft.zones !== null) return MANIFEST_SCHEMA_VERSION_V5;` first; return type `1 | 2 | 3 | 4 | 5`; doc "5 with a layout, 4 with a schedule, …".
- `buildManifest` (:74-143): first `if (draft.zones !== null && draft.schedule !== null) throw new Error('a draft has a schedule or zones, not both');`. Next to the schedule block (:114-131), `...(draft.zones === null ? {} : { zones: draft.zones.map((zone) => ({ rect: { x: zone.rect.x, y: zone.rect.y, width: zone.rect.width, height: zone.rect.height }, count: zone.count, transition: zone.transition, shuffle: zone.shuffle })) })`, field by field. The Intl zone check runs for 2 to 5. Self-check through `ManifestSchema` as today.
- `manifestAssetIds`, `manifestStorageBytes`: unchanged (flat `assets`).

**push.ts**
- `PlaybackField += 'zones'` (:41-48).
- A private `sameRun(a, b)` (count, transition and shuffle equal), lifted from the per-playlist check of `sameSchedule` (:87-95), which then calls it.
- `sameZones(a: readonly DraftZone[], b: readonly ManifestZone[])`: same length, then for each zone `sameRect(zone.rect, other.rect)` (:64-67) and `sameRun`. Key by key, never `JSON.stringify`.
- In `firstDraftManifestDifference`, after the schedule check (:212-218): `draft.zones !== null && manifest.schemaVersion === MANIFEST_SCHEMA_VERSION_V5 && !sameZones(draft.zones, manifest.zones)` gives `{ kind: 'playback', field: 'zones' }`. A band-height change moves the rectangles, so the screen shows `changes`; a canvas change shows `canvas` first.
- The "Compared" doc comment (:127-153): v5 with a layout; with a layout the play list is every zone's items in one list (a changed item is reported at its flat index), and last come the zones (each zone's rectangle, item count, transition and shuffle). "Not compared": `publicationId`, `createdAt` and `muted` (the "region count" is no longer a field).
- `decidePushState`: unchanged; its `PushStateInput.plan` doc (:231-236) adds "`planLayoutPublication` for an assigned layout".

**delivery (packages/delivery/src/browser/browser-route.ts)**
- `profileVersion: 2` (:39): the profile changed, and the field exists to say so. Nothing reads it.
- `maxRegions: ABSOLUTE.maxLayoutZones` (:44).
- The doc comment (:28-31) becomes "Browser route, capability profile version 2: JPEG, PNG and MP4 (H.264), muted, up to four regions (the zones of a layout; one without a layout), contain or cover, optional content rectangle. Version 1 had one full-frame region. Tested in desktop Chrome only; it says nothing about LED controllers."
- Test doubles that pin a refusal keep `maxRegions: 1`: packages/delivery/test/fake-route.ts:32 and the `route()` fixture at packages/domain/src/fixtures.test-support.ts:163-182 (which gains a second parameter, section 8).

### 5. API (apps/api; every route inside the operator scope, so session, CSRF and exact Origin apply; org only from `session.orgId` and `app_org_id()`; the global rate limit)

**routes/layouts.ts (new), `registerLayoutRoutes(api, ctx)`, registered after `registerScheduleRoutes` (apps/api/src/app.ts:111).** Template: routes/schedules.ts.
- **One read for list and detail, in one statement.** One snapshot, so the strict two-to-four-zone DTO can never see a zone set half replaced by a PUT:
  ```sql
  WITH l AS (
    SELECT l.id, l.name, l.description, l.created_at, l.updated_at,
           (SELECT count(*) FROM display d
            WHERE d.assigned_layout_id = l.id AND d.org_id = l.org_id) AS assigned_display_count
    FROM layout l
    WHERE l.org_id = app_org_id() AND ($2::uuid IS NULL OR l.id = $2::uuid)
    ORDER BY lower(l.name), l.id
    LIMIT $1
  )
  SELECT l.id, l.name, l.description, l.created_at, l.updated_at, l.assigned_display_count,
         p.id AS playlist_id, p.name AS playlist_name, z.x_bp, z.y_bp, z.width_bp, z.height_bp
  FROM l
  JOIN layout_zone z ON z.layout_id = l.id AND z.org_id = app_org_id()
  JOIN playlist p ON p.id = z.playlist_id AND p.org_id = z.org_id
  ORDER BY lower(l.name), l.id, z.position
  ```
  `loadLayouts(tx, id: string | null): Promise<LayoutDto[]>` runs it with `[ABSOLUTE.maxListItems, id]` and groups the rows by layout in order. Inner joins: a layout written through the API always has two to four zones and a zone's playlist cannot be deleted, so nothing is lost; a layout without zones (direct SQL only) is left out. `// shortcut: no pagination, the list is capped at ABSOLUTE.maxListItems; page it when an organisation has more layouts than that.`
- **GET /api/layouts** gives `{ items: await loadLayouts(tx, null) }`. **GET /api/layouts/:id** gives `loadLayouts(tx, id)[0]`, or 404 `notFound('The layout')`.
- **POST /api/layouts** (`LayoutInputSchema`) answers 201 with a `LayoutDto`. **PUT /api/layouts/:id** (same schema) replaces the whole layout. Both, in one `withOrg`, through `saveLayout(tx, session, id | null, input)`:
  1. PUT only: `SELECT 1 FROM layout WHERE id = $1 AND org_id = app_org_id() FOR UPDATE`; none gives 404. This lock is what a push waits on (below).
  2. Lower-case every `playlistId` once, right after parsing (as routes/schedules.ts:118-124); only these values are used from here on.
  3. `SELECT id FROM playlist WHERE org_id = app_org_id() AND deleted_at IS NULL AND id = ANY($1::uuid[]) FOR SHARE` over the distinct ids. A missing one gives 400 `validation_failed` "A playlist in this layout does not exist or was deleted." with details `` { path: `zones.${n}.playlistId`, message: 'The playlist was not found.' } `` for every zone that uses it (dots, n from 0). Another organisation's playlist is invisible here, so it gets exactly this answer (as routes/schedules.ts:126-147).
  4. POST: `INSERT INTO layout (org_id, name, description) VALUES (app_org_id(), $1, $2) RETURNING id`. PUT: `DELETE FROM layout_zone WHERE layout_id = $1 AND org_id = app_org_id()`, then `UPDATE layout SET name = $2, description = CASE WHEN $3::boolean THEN $4::text ELSE description END WHERE id = $1 AND org_id = app_org_id()` (always touches the row, so `updated_at` reflects zone changes).
  5. Zones in one statement; position 0 is the main zone:
     ```sql
     INSERT INTO layout_zone (layout_id, position, org_id, playlist_id, x_bp, y_bp, width_bp, height_bp)
     SELECT $1, (t.ordinal - 1)::int, app_org_id(), t.playlist_id, t.x_bp, t.y_bp, t.width_bp, t.height_bp
     FROM unnest($2::uuid[], $3::int[], $4::int[], $5::int[], $6::int[])
          WITH ORDINALITY AS t(playlist_id, x_bp, y_bp, width_bp, height_bp, ordinal)
     ```
  6. `auditScoped` `layout.create` or `layout.update`, objectType `layout`, detail `{ mainPlaylistId, zoneCount }` (the lower-cased id of zone 0 and the number of zones; ids and a count, never names), on the same `Tx`.
  7. The DTO from `loadLayouts(tx, layoutId)`.
  8. Catch 23503 and 23001 (a playlist went away between step 3 and the write): 409 `conflict` "A playlist in this layout was deleted meanwhile. Reload and try again."
- **DELETE /api/layouts/:id**: lock the row and count its zones in one statement, `SELECT (SELECT count(*) FROM layout_zone z WHERE z.layout_id = l.id AND z.org_id = l.org_id) AS zone_count FROM layout l WHERE l.id = $1 AND l.org_id = app_org_id() FOR UPDATE` (404 when absent; as routes/schedules.ts:302-309). Screens that have it assigned (`SELECT d.name FROM display d WHERE d.assigned_layout_id = $1 AND d.org_id = app_org_id() ORDER BY lower(d.name), d.id LIMIT 5`) give 409 `layout_in_use` "This layout is assigned to a screen. Assign other content to the screen first." with details `{ path: 'display', message: name }`. Otherwise `DELETE FROM layout WHERE id = $1 AND org_id = app_org_id()` (the zones cascade), audit `layout.delete` with detail `{ zoneCount }`, 204. 23503 (a screen took it meanwhile): 409 `layout_in_use` "This layout has just been assigned to a screen. Try again."

**routes/displays.ts**
- `DisplayRow` (:48-76) and `DISPLAY_SELECT` (:78-96) gain `lay.id AS assigned_layout_id, lay.name AS assigned_layout_name, lmp.id AS assigned_layout_playlist_id, lmp.name AS assigned_layout_playlist_name` through
  ```sql
  LEFT JOIN layout lay ON lay.id = d.assigned_layout_id AND lay.org_id = d.org_id
  LEFT JOIN layout_zone lz ON lz.layout_id = lay.id AND lz.org_id = lay.org_id AND lz.position = 0
  LEFT JOIN playlist lmp ON lmp.id = lz.playlist_id AND lmp.org_id = lz.org_id
  ```
  `toDisplayDto` (:120-158) builds `assignedLayout: { id, name, mainPlaylist: { id, name } }`, or null unless all four are set.
- **PATCH** (:380-528):
  - the locked SELECT (:395-399) also reads `d.assigned_layout_id`;
  - a string `assignedLayoutId` is checked like a schedule (:426-434): `SELECT 1 FROM layout WHERE id = $1 AND org_id = app_org_id() FOR SHARE`, none gives `notFound('The layout')`;
  - the two-column formula (:435-449) is replaced by one function over `ASSIGNMENT_KEYS`:
    ```ts
    const ASSIGNMENT_COLUMNS = {
      assignedPlaylistId: 'assigned_playlist_id',
      assignedScheduleId: 'assigned_schedule_id',
      assignedLayoutId: 'assigned_layout_id',
    } as const satisfies Record<AssignmentKey, string>;

    /**
     * The assignment columns as the one UPDATE writes them: a key the patch names takes its
     * value; a key it does not name is cleared when another key is set to an id, and otherwise
     * keeps the stored value. The contract refuses two ids; the database refuses a row with two.
     */
    function assignmentAfter(
      current: Readonly<Record<(typeof ASSIGNMENT_COLUMNS)[AssignmentKey], string | null>>,
      patch: DisplayPatch,
    ): Record<AssignmentKey, string | null>
    ```
    So every existing caller that assigns a playlist or a schedule also clears a layout, with no change on its side;
  - the UPDATE (:458-481) gains `assigned_layout_id = $15` with `after.assignedLayoutId`;
  - the audit (:485-507) records, for each key of `ASSIGNMENT_KEYS` in order, `key: after[key]?.toLowerCase() ?? null` when the patch named the key **or** the stored value was set and is now null (the slice 3 rule, written as a loop). The exact-detail assertion at apps/api/test/audit-trail.integration.test.ts:206-215 stays green: that screen has no schedule or layout;
  - error mapping (:512-528) adds `pg === '23503' && constraint === STAGE_B_CONSTRAINTS.displayAssignedLayout` giving `notFound('The layout')`.

**routes/playlists.ts**
- DELETE (:435-508): after the schedule check (:460-475), a layout check:
  ```sql
  SELECT l.name FROM layout l
  WHERE l.org_id = app_org_id()
    AND EXISTS (SELECT 1 FROM layout_zone z
                WHERE z.layout_id = l.id AND z.org_id = l.org_id AND z.playlist_id = $1)
  ORDER BY lower(l.name), l.id LIMIT 5
  ```
  Rows give 409 `playlist_in_use` "This playlist is used by a layout. Choose another playlist in the layout first." with details `{ path: 'layout', message: name }`. The 23001 race message (:501-503) becomes "This playlist has just been assigned to a screen or added to a schedule or a layout. Try again." The doc comment (:426-434) adds layouts.
- Publish (:520-620):
  - the idempotency refusal (:540-546) also covers a stored manifest with zones: `const container = typeof previous.manifest === 'object' && previous.manifest !== null && ('schedule' in previous.manifest || 'zones' in previous.manifest);` (a layout push stores the main zone's playlist id, but a v5 manifest is not what publishing that playlist makes);
  - the UPDATE (:588-594) becomes `SET assigned_playlist_id = $2::uuid, assigned_schedule_id = NULL, assigned_layout_id = NULL` (same WHERE). Without it the one-assignment CHECK raises 23514, which answers 500;
  - both calls of `auditRejectedPublication` and `createPublication` pass `layoutId: null`;
  - `assigned_display_count` (:185-187) stays a count of direct assignments.

**publishing.ts**
- `DisplayPlanRow` (:55-72) gains `assigned_layout_id: string | null` (doc: "A display has one of a playlist, a schedule or a layout assigned (migration 0011)"); `DISPLAY_PLAN_COLUMNS` (:75-79) gains `d.assigned_layout_id`.
- New, after `ScheduleDraft` (:100-111):
  ```ts
  /** A layout as publishing sees it: its zones in position order; [0] is the main zone. */
  export interface LayoutDraft {
    readonly id: string;
    readonly name: string;
    readonly zones: readonly {
      readonly playlistId: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }[];
  }
  ```
- New `export async function loadLayoutDrafts(tx, layoutIds, lock): Promise<Map<string, LayoutDraft>>`, after `loadScheduleDrafts` (:298-369); ids lower-cased and de-duplicated first, none gives an empty map. **Two statements, as `loadScheduleDrafts` does:**
  ```sql
  -- 1, only with lock
  SELECT id FROM layout WHERE org_id = app_org_id() AND id = ANY($1::uuid[]) FOR SHARE
  -- 2, always, with no locking clause
  SELECT l.id, l.name, z.playlist_id, z.x_bp, z.y_bp, z.width_bp, z.height_bp
  FROM layout l
  JOIN layout_zone z ON z.layout_id = l.id AND z.org_id = l.org_id
  WHERE l.org_id = app_org_id() AND l.id = ANY($1::uuid[])
  ORDER BY l.id, z.position
  ```
  Its doc comment repeats the reason of :298-309: `withOrg` runs at READ COMMITTED; a single `… FOR SHARE OF l` join that waits on a PUT's `FOR UPDATE` took its snapshot before the PUT, and after the wait PostgreSQL re-reads only the locked layout row, so the zones (child rows) would still be the old ones. With the lock taken first, statement 2 takes its snapshot while the share lock is held, and PUT and DELETE both lock the layout row before they touch zones. Without `lock` (the push plan) statement 2 alone is one snapshot.
- **`assessDisplays`** (:544-658):
  - loads the schedules, then the layouts (`loadLayoutDrafts(tx, displays' assigned_layout_id, options.lock)`), then one `loadPlaylistDrafts` batch (:555-565) that also holds every zone's playlist id;
  - `contentOf` (:578-589) returns `{ playlist, schedule: ScheduleDraft | null, layout: LayoutDraft | null }`: for a layout, `playlist` is the draft of `layout.zones[0].playlistId`. A layout missing from its map, or a missing main-zone playlist (only possible between two unlocked reads of the plan), gives undefined, so the row is `nothing_assigned` with `layout: null` and `schedule: null`; `PushPlanRowSchema` refuses a layout without a playlist. A missing playlist of another zone reaches `planPlaylist`'s undefined branch (a `playlist_empty` issue at `zones[n].playlist`). The doc comment (:566-577) says so. The current-manifest filter (:653) goes through `contentOf` and needs no change;
  - the `planPlaylist` closure (:616-625) moves out of the schedule branch, typed `PlanPlaylist`, so both planners share it; the plan choice (:610-627) becomes `layout !== null ? planLayoutPublication({ canvas: { width: display.canvas_width, height: display.canvas_height }, contentRect: contentRectOf(display), zones: layout.zones, planPlaylist, route }) : schedule !== null ? planSchedulePublication({ …, planPlaylist, route }) : planDraft(…)`;
  - the assessment carries `layout: layout === null ? null : { id: layout.id, name: layout.name }`, and the `nothing_assigned` one `layout: null`.
- `DisplayAssessment` (:126-147) `+= readonly layout: LayoutRef | null`; the `playlist` doc adds "or the main zone's playlist of the assigned layout".
- `issueDetails` (:159-170): unchanged code; its doc lists the layout paths.
- `NewPublication` (:660-672) `+= readonly layoutId: string | null`. In `createPublication` (:726-747) the `publication.create` detail gains `...(input.layoutId === null ? {} : { layoutId: input.layoutId })` and, as :740-742, `...(input.via === 'publish' && display.assigned_layout_id !== null ? { assignedLayoutId: null } : {})`.
- `auditRejectedPublication` (:755-779) input `+= readonly layoutId: string | null`; `objectType` is `'layout'` with `objectId: layoutId` when it is set, else as today (:770-771).
- **Lock order** (no cycle): a push takes the display `FOR NO KEY UPDATE` (:226-236), then the schedule or layout `FOR SHARE`, then playlists `FOR SHARE`, then media and apps `FOR KEY SHARE`. A layout PUT takes the layout `FOR UPDATE`, then playlists `FOR SHARE`: the same direction. A display PATCH takes the display `FOR UPDATE`, then the layout `FOR SHARE`. A playlist DELETE locks the playlist `FOR UPDATE` and reads zones without a lock: it either waits for the push and then refuses because the zone exists, or it wins only when no zone uses the playlist.
- The file's head comment (:1-14) adds "and a display with a layout plans every zone's playlist the same way (`planLayoutPublication`)".

**routes/push.ts**
- `toPlanRow` (:39-48) `+= layout: assessment.layout`.
- `pushDisplay`: the skip at :107-110 stays (`playlist === null` still means nothing is assigned); `auditRejectedPublication` (:114-121) and `createPublication` (:139-147) both get `layoutId: assessment.layout?.id ?? null`.
- The head comment (:4) reads "Editing a playlist, a schedule or a layout, or assigning one, changes nothing on a display."

**Player routes:** no change. `GET /player/manifest` accepts v5 through the widened `ManifestSchema` (routes/player.ts:431-432); media URLs and media are authorised by `publication_asset` (:454-461, :543-549), which holds every media position of every zone.

**Worst case:** at most `LIMIT_MAX_PLAYLIST_ITEMS` (500) items across four zones plus four small zone objects, far below the 1 MiB CHECK (500 tickers were about 550 KB in slice 2; a zone object is under 120 bytes).

### 6. Player 0.5.0 (apps/player-web)

- `PLAYER_VERSION = 'player-web/0.5.0'` (config.ts:5).
- Staging, verification, quota, activation and GC need **no change**: `uniqueAssets` and `manifestHashes` read the flat `assets` (core/types.ts:186-196), so every zone's media is downloaded and probed before the one-transaction activation. Stored records accept v5 through `ManifestSchema` (core/types.ts:46-49).
- `PlaybackLoop`, `nextStep`, core/time-rules.ts and core/sync.ts are **unchanged**: each zone's loop is handed a version 3 view (`manifestZones`, section 3). The one edit in core/playback.ts is the shortcut text at :222: `// shortcut: for manifests without a schedule (v1 to v3, and the v3 views of v5 zones) rules are checked at item boundaries; an item may overrun an edge by its own length. A video is never cut, in any version.`

**ui/stage.ts (new), `DomStage`, one per session.** It owns everything about the whole display, so two zones cannot break each other:
```ts
/**
 * The publication canvas in the window: `.canvas` (test id `canvas`), scaled to fit, centred and
 * turned for the screen's rotation, with one box per zone. Zone 0's box is `.content` with test
 * id `content`; zone n's box is `.content` with test id `zone-{n}`. The canvas shows while at
 * least one zone shows something. One window resize listener, removed in `dispose`.
 */
export class DomStage {
  constructor(root: HTMLElement);
  /** The box of a zone, created (and appended to the canvas) on first use. A presenter puts its layers in it. */
  box(zone: number): HTMLDivElement;
  /**
   * Lays out the zone's box from `effectiveContentRect(view.canvas, view.contentRect)`, marks the
   * zone as showing and shows the canvas. The canvas itself (size, scale, rotation, `data-canvas`)
   * follows the view zone 0 last placed; a zone 1 or higher sets it only while zone 0 has placed nothing.
   */
  place(zone: number, view: Manifest): void;
  /** The zone shows nothing; the canvas is hidden when no zone shows anything. */
  release(zone: number): void;
  /** Takes a zone's box off the canvas (zones 1 and up). */
  remove(zone: number): void;
  /** Removes the resize listener and hides the canvas. */
  dispose(): void;
}
```
- The layout math moves from apps/player-web/src/ui/presenter.ts:105-133 unchanged (`stageTransform`, `canvasToViewport`, `px`), applied to every placed box; `data-canvas` stays on `.canvas`.
- Every canvas-visibility site of today's presenter moves here: the `replaceChildren` (presenter.ts:90) goes to the constructor; the un-hide in `#applyGeometry` (:142-143) becomes `place`; the hide in the catch path (:205-206) and in `clear()` (:221) become `release`. The resize listener (:91-93, never removed today) is the stage's one listener, removed in `dispose()`.
- A secondary zone never re-turns or rescales the canvas, so a stale view restored in its catch path moves only its own box. When zone 0 places a view with another canvas or rotation, every placed box is laid out again from its own last view (the same pass as a window resize).
- Boxes are appended in zone order, so during a change of layout a later zone draws on top.
- Zones sit inside `.canvas`, which `stageTransform` turns as a whole (presenter.ts:116-124): "bottom" is the bottom of the picture on any mounting. Neighbouring zones get their shared edge from the same integer through `px()` (presenter.ts:114); any hairline at a fractional scale is black on black (apps/player-web/src/styles.css:38-50). Unverified pending runtime.

**ui/presenter.ts: `DomPresenter` becomes one zone**, built as `new DomPresenter(stage: DomStage, zone: number, getBlob, now)`.
- `#contentEl = stage.box(zone)`. The fields `#stage` (the element), `#canvasEl`, `#geometry` and the method `#layout()` go; a field `#view: Manifest | null` (the view its box was last placed from) takes `#geometry`'s place.
- `#applyGeometry(view)` becomes `this.#view = view; this.#stage.place(this.#zone, view);` (called at :175 and :183 as today).
- The catch path (:202-211): `const shownView = this.#view` is captured where `shownGeometry` is today (:155); on failure, `if (this.#current === null) this.#stage.release(this.#zone); else if (this.#view !== shownView && shownView !== null) { this.#view = shownView; this.#stage.place(this.#zone, shownView); }`. A band whose first item fails therefore never blanks the main zone.
- `clear()` (:217-222) ends with `this.#stage.release(this.#zone)`.
- New `remove(): void` = `this.clear(); this.#stage.remove(this.#zone);` (zones 1 and up).
- The layer test id (:255) is `active-layer` for zone 0 and `zone-${zone}-active-layer` for the others. Playwright's strict `getByTestId` on `canvas`, `content` and `active-layer` (tests/e2e/support/player.ts:86-88, :106; tests/e2e/02-canvases.spec.ts, 06-stage-b.spec.ts, 07-apps-player.spec.ts) still matches one element each. The v1 to v4 DOM is unchanged.
- The layer logic (:146-419) is otherwise unchanged. `inUse()` stays.

**core/zones.ts (new, no DOM, unit-tested with fakes), `ZoneSet`.**
```ts
/** A zone's presenter as the zone set uses it: DomPresenter, or a fake in tests. */
export interface ZonePresenter extends Presenter {
  inUse(): ReadonlySet<string>;
  /** Clears the zone and takes its box off the stage. */
  remove(): void;
}
export interface ZoneSetDeps {
  /** Builds the presenter (and the box) of zone `zone`, 1 or more. */
  createPresenter(zone: number): ZonePresenter;
  /** Builds the loop of zone `zone`, 1 or more; the zone set starts it. */
  createLoop(
    zone: number,
    presenter: Presenter,
    loadActive: () => Promise<Manifest | null>,
    signal: AbortSignal,
  ): { start(): void; wake(): void };
  /** The session's signal: every zone stops with it. */
  readonly signal: AbortSignal;
}
export class ZoneSet {
  constructor(deps: ZoneSetDeps);
  /** The main zone's `loadActive` calls this with the active manifest; returns the main zone's view. */
  adopt(manifest: Manifest | null): Manifest | null;
  /** Hashes in use by zones 1 and up. */
  inUse(): ReadonlySet<string>;
  /** Stops every zone but the main one (revocation, reset). */
  stopAll(): void;
}
```
- Views are cached by `publicationId`: a call for the publication already adopted returns the cached view 0 and does nothing else, so most calls are free. For v1 to v4 view 0 is the manifest itself.
- On a new publication `adopt` computes `manifestZones(manifest)` (none for null) and reconciles zones 1 and up, **in this order**:
  1. **Gone zones are stopped first:** abort the zone's signal, `presenter.remove()` (which clears it and takes its box off). Their decoders are released before any new zone starts.
  2. A kept zone gets its new view and `wake()`: a still or an app ends now, a video finishes first (core/playback.ts:254-257). Its loop picks the view up at its next item, because its `loadActive` reads the zone set's current views at each call.
  3. A new zone gets `createPresenter(n)` and `createLoop(n, presenter, async () => this.#views[n] ?? null, AbortSignal.any([deps.signal, zoneAbort.signal]))`, then `start()`.
  4. Return view 0, or null.
- `adopt(null)` stops every secondary zone.
- `// shortcut: zones adopt a new publication at their own next item; for up to one video old and new geometry share the screen (a later zone draws on top). Hand over atomically if operators notice.`
- `// shortcut: removing a zone cuts a video playing in it.`

**app.ts**
- `#startSession` (:402-430): `const stage = new DomStage(this.#stage)`; `const presenter = new DomPresenter(stage, 0, getBlob, clock.now)`; `const zones = new ZoneSet({ createPresenter: (zone) => new DomPresenter(stage, zone, getBlob, clock.now), createLoop: (zone, zonePresenter, loadActive, zoneSignal) => new PlaybackLoop({ loadActive, presenter: zonePresenter, clock, sleep, random: Math.random, signal: zoneSignal, onEvent: (event) => { if (event.type === 'item_failed') this.#report(event.error); } }), signal })`. The main loop's `loadActive` becomes `async () => zones.adopt((await store.getActive())?.manifest ?? null)`.
- `Session` (:56-67) gains `stage: DomStage` and `zones: ZoneSet`.
- GC `inUse` (:442) is `() => new Set([...presenter.inUse(), ...zones.inUse()])`. An old band asset is collected at the next GC; this costs storage only.
- Revocation (:602) and reset (:626): after `presenter.clear()`, `zones.stopAll()` and `stage.dispose()`.
- `onActivated` (:466-469) still wakes the main loop, which adopts.
- **Zone 0 drives everything display-wide, exactly as today** (:522-569): the phase, the slate and `session.rendering`; heartbeat `activeItemIndex`, which is already the flat index because zone 0's run starts at 0 (heartbeat v1 unchanged, contracts player.ts:127-128); GC on a publication change (:531-543). Zones 1 and up report only `item_failed`: their `all_failed` leaves their box black and retries after `allFailedRetryMs` (core/playback.ts:347-352), with no slate; zone 0's `all_failed` puts the fault slate over everything (:552-557). Working hours: every view carries them, so all zones go dark within one item of an edge.
- `// shortcut: heartbeat v1 reports the main zone; a band can play while the screen reports idle. Heartbeat v2 with per-zone state if support needs it.` (next to the `item_started` case, :526).
- No new diagnostics row: "Schedule picks" already reads "— (no schedule)" for v5 (:724-726), because `coveringSlices` returns `[]` for anything but v4 (core/time-rules.ts:93).

**core/errors.ts:** above `ErrorLog.add` (:149-161): `// shortcut: the log dedupes only against the newest entry, so failures from two zones in turn can push older entries out; dedupe by code and asset if support reports it.`

**Decoders.** At most 2 `<video>` per zone (the one showing and the one being prepared, presenter.ts:184-200): 4 with the preset, 8 at the ceiling. No limit (the shortcut is in capability.ts, section 4). Unverified pending runtime on Pi-class hardware (AV4:56).

**PL-04 end-to-end test, `tests/e2e/13-layouts-player.spec.ts`** (written, not run by agents). All through `OperatorApi` (`createLayout`, `replaceLayout`, `assignLayout`, section 8).
- Content: the main zone is a playlist with one image; the band is a playlist with one Ticker app; band 15 %.
- Canvases: 1920 × 1080; 1080 × 1920; 1920 × 1080 at rotation 90; 3840 × 480 with a content rectangle.
- For each it asserts that the fetched manifest has `schemaVersion` 5; that the `zone-1` box matches the band within 1 px (from `zoneRect` of the manifest, scaled as the page lays out); that the ticker font is `min(0.6·h, 0.25·w)` of the band box (packages/app-render/src/render.ts:238); and the reported `itemIndex` is 0.
- With reduced motion emulated, the ticker text wraps inside the band (render.ts:220; the moving ticker never wraps, :234).
- Changing the band height (`replaceLayout`) and pushing never shows two `canvas` elements, and the new `zone-1` box matches the new band.
- Assigning the image's playlist instead and pushing gives v1 and no `zone-1`.
- No CSP violations.

### 7. Portal (UI kit only; operators read "screen"; no inline style attribute)

**Shell**
- apps/portal/src/shell/nav.ts:100: drop `planned: true` from the Layouts entry.
- App.tsx:130: replace the planned route with `page('layouts', layoutsPage, (m) => <m.LayoutsPage />)` and `page('layouts/:id', layoutEditor, (m) => (<PerObject><m.LayoutEditorPage /></PerObject>))`, with `const layoutsPage = () => import('./features/layouts/LayoutsPage.tsx')` and `const layoutEditor = () => import('./features/layouts/LayoutEditorPage.tsx')` next to the schedule ones (:62-63).
- features/planned/PlannedPage.tsx: drop `layouts` from `PlannedSection` (:6) and `PLANNED` (:37-42), and the unused icon import.
- features/styleguide/SurfaceSections.tsx:196-205: the planned sample becomes Users, which is still planned (nav.ts:114): icon `Users` (ui/icons.ts:97), title "Users are planned", text "People and their roles will be managed here. They arrive with stage C." Swap the `LayoutTemplate` import (:29; the sample at :202 is its only use) for `Users`, or lint fails on an unused import.
- nav.test.ts: the planned list (:43) loses `/layouts`; a line "Built in stage B, slice 4." asserts `/layouts` is not planned; the `navItemName` test (:132-138) uses `media-audio` ("Audio (planned)") instead of `layouts`; the active-link table (:100) gains `['/layouts/<uuid>', 'layouts']`.

**api/endpoints.ts** (mirroring :142-148 and :325-346): `listLayouts(signal?): Promise<LayoutDto[]>`, `getLayout(id, signal?): Promise<LayoutDto>`, `createLayout(input: LayoutInput): Promise<LayoutDto>`, `replaceLayout(id, input: LayoutInput): Promise<LayoutDto>` (PUT; doc "The whole layout. Leaving `description` out keeps the stored one; null clears it."), `deleteLayout(id): Promise<void>` (doc "409 `layout_in_use` while a display has the layout assigned."). The `deletePlaylist` doc (:137) adds "or a layout".

**lib/assignedContent.ts (new, pure, tested; WP5 writes it first).** Stops a third branch at about 25 call sites:
```ts
export type ContentKind = 'playlist' | 'schedule' | 'layout';
export interface ContentRef { readonly kind: ContentKind; readonly id: string; readonly name: string }
/** The Record makes TypeScript ask for a fourth kind. */
export const CONTENT_KIND_LABEL: Record<ContentKind, string> = { playlist: 'Playlist', schedule: 'Schedule', layout: 'Layout' };
/** What a screen has assigned, or null. At most one of the three is set. */
export function assignedContent(display: Pick<DisplayDto, 'assignedPlaylist' | 'assignedSchedule' | 'assignedLayout'>): ContentRef | null;
/** What a push-plan row is about: its layout, else its schedule, else its playlist; null for nothing assigned. A row of a layout or a schedule also carries a playlist (the main zone's or the default), so the container wins. */
export function planRowContent(row: Pick<PushPlanRow, 'playlist' | 'schedule' | 'layout'>): ContentRef | null;
/** `/playlists/:id`, `/schedules/:id` or `/layouts/:id`. */
export function contentHref(kind: ContentKind, id: string): string;
/** The sentence a playlist-assign dialog adds when a screen it is about has a schedule or a layout. */
export const CONTENT_REPLACED_NOTE = 'A screen that has a schedule or a layout gets this playlist instead.';
/** True when any of the screens has a schedule or a layout: assigning a playlist replaces it. */
export function anyHasOtherContent(displays: readonly Pick<DisplayDto, 'assignedPlaylist' | 'assignedSchedule' | 'assignedLayout'>[]): boolean;
```
It is used **only at sites this slice must touch anyway** (WP6 unless marked):
- `assignedContentName` and `hasContentAssigned` (lib/screensList.ts:103-115) are removed; their callers use `assignedContent(display)?.name ?? null` and `assignedContent(display) !== null` (screensList.ts:123, :250; ScreenRowMenu.tsx:21).
- `pushMarkerFor` (screensList.ts:266-284): the plan row is about the assignment when `assignedContent(row.display)` and `planRowContent(push)` have the same kind and the same id (`idKey`). For a playlist screen this keeps today's rule: a row with a schedule or a layout is not a match.
- The three "direct playlist" filters become `planRowContent(row)?.kind === 'playlist'` plus today's id test: lib/playlistEditor.ts:664 (`rowsForPlaylist`), lib/playlistsListActions.ts:229 (`assignPushView`, WP5) and the playlist branch of `pushMarkerFor` (screensList.ts:281).
- features/push/PushDialog.tsx meta and link (:584-597, :638-658) and lib/pushDialog.ts `searchRows` (:56-62, which also matches `row.layout?.name`).
- features/dashboard/PushCard.tsx caption (:105-110): `planRowContent(row)?.name`.
- features/shared/ScreenPickerDialog.tsx `contentLabel` (:90-96): "Assigned: schedule {name}", "Assigned: layout {name}", "Assigned: {playlist}" or "Nothing assigned"; its search (:138-148) also matches `display.assignedLayout?.name`.
- features/displays/list/ScreensList.tsx: the Content column (:415-440), `allowNone` (:924-925), the "kept" toast (:296-309) and the assign-dialog note (:917).
- The four places that add `SCHEDULE_REPLACED_NOTE`: ContentCard.tsx:296, ScreensList.tsx:917, features/playlists/list/AssignToScreens.tsx:106 and features/playlists/editor/PushCard.tsx:223. `SCHEDULE_REPLACED_NOTE` and `anyHasSchedule` (lib/screensList.ts:390-400) are removed; the callers use `CONTENT_REPLACED_NOTE` and `anyHasOtherContent`.
- The wizard note (features/displays/wizard/ContentStep.tsx:147-154).

**lib/layouts.ts (new, pure, tested; mirrors lib/schedules.ts)**
- `BAND_PERCENT = { min: 5, max: 50, initial: 15 } as const`.
- `bandZones(percent: number, mainPlaylistId: string, bandPlaylistId: string): LayoutZoneInput[]`: `[{ playlistId: main, x: 0, y: 0, width: 10000, height: 10000 - percent·100 }, { playlistId: band, x: 0, y: 10000 - percent·100, width: 10000, height: percent·100 }]`.
- `bandPercentOf(zones: readonly LayoutBox[]): number | null`: the band height in whole per cent when the zones are exactly `bandZones` of some percent from 5 to 50, else null.
- `zoneLabel(index: number, preset: boolean): string`: "Main zone" for 0; "Band" for 1 when `preset`; otherwise "Zone {index + 1}".
- `LayoutZoneDraft { playlistId: string ('' = not chosen); x; y; width; height }` and `LayoutDraft { name; description; bandPercent: string | null (the Stepper's text; null when the saved zones match no preset); zones: readonly LayoutZoneDraft[] }`.
- `layoutDraftFromDto(dto)`, `layoutIsDirty(saved, draft)`.
- `validateLayoutDraft(draft): { ok: true; value: LayoutInput } | { ok: false; errors: LayoutErrors }`. Messages: "Enter a name." (`nameProblem`, lib/playlistEditor.ts:173); the description through `descriptionProblem` (lib/playlistEditor.ts:184), sent always as the trimmed text or null (write the three lines of the private `descriptionToSave` locally, as lib/schedules.ts:110-114 does); band height "Enter a whole number from 5 to 50."; a zone without a playlist "Choose a playlist.". The value's zones are `bandZones(Number(bandPercent), zones[0].playlistId, zones[1].playlistId)` when `bandPercent !== null`, otherwise the saved geometry with the chosen playlists. **The editor never replaces zones silently.**
- `LayoutErrors { name?; description?; bandPercent?; form?; zones: ReadonlyMap<number, { playlistId?: string }> }`, `NO_LAYOUT_ERRORS`.
- `layoutErrorsFromApi(details, draft)` reads the dotted paths the API sends (section 3), split on `'.'` as lib/apps.ts:247 does: `name` and `description` to their slots; `zones.<n>.playlistId` to zone n; anything else (`zones`, `zones.<n>`, `zones.<n>.width`, an index with no zone, an unknown path) to `form`. The first message per slot wins; each is prefixed "The server refused this value: ", as lib/apps.ts does.
- `layoutErrorEntries(errors, draft)` for the error summary: "Enter a name.", the description message, "Band height: Enter a whole number from 5 to 50.", "{zoneLabel}: Choose a playlist." and the form message.
- `zoneSizes(shape: CanvasPreviewShape, zones: readonly LayoutBox[]): { rect: Rect; tooSmall: boolean }[]`: `zoneRect(effectiveContentRect(shape.canvas, shape.contentRectOutOfBounds ? null : shape.contentRect), zone)` from `@tinnox/domain`, `tooSmall` when a side is under 16 px.
- `zoneSizeSentence(shape, zones, labels)`: "On 1080 × 1920: main zone 1080 × 1632 px, band 1080 × 288 px." (labels lower-cased).
- `bandLabel(dto)`: "15%" or "Custom"; `layoutSummaryLabel(dto)`: "Main zone: {name} · Band 15%" or "Main zone: {name} · 3 zones".
- `LAYOUT_SORT_ACCESSORS`, `DEFAULT_LAYOUT_SORT`, `filterLayoutList(items, query)` (name, description and every zone's playlist name).
- Reused, not rewritten: `assignedScreensLabel` (lib/playlistsList.ts:94), `playlistsByName` (lib/schedules.ts:48), `refusalNames` (lib/playlistsListActions.ts, below).

**Layouts list (`features/layouts/LayoutsPage.tsx`, the Schedules list pattern):** `SearchField` "Search layouts", the count, a refresh icon button, primary "Create layout". Table: Name (link), Main zone (link to the playlist, capped at 28ch with the full name in its `title`, as the schedules list), Band ("15%" or "Custom"), Screens, Updated, row menu (Edit, Delete). Empty state "No layouts yet" / "A layout splits a screen into a main zone and a band along the bottom, each with its own playlist." / "Create layout". No-results state "No layout matches" with "Clear search". `// shortcut: no grid, bulk selection or pagination; add when an organisation has over 100 layouts.`

**Create dialog (`CreateLayoutDialog.tsx`, Dialog `md`):** `Field` "Name"; native `Select` "Main zone playlist"; native `Select` "Band playlist" (hint "Put a Ticker or Text app in this playlist; its text is sized to the band."). Both start on "Choose a playlist". With no playlist yet: an EmptyState "Create a playlist first" with a link to `/playlists`, and no form. Buttons Cancel and "Create layout". Validation "Enter a name.", "Choose a playlist for the main zone.", "Choose a playlist for the band."; a failed submit focuses the first invalid field (as CreateScheduleDialog.tsx:80-86). POST `{ name, zones: bandZones(BAND_PERCENT.initial, main, band) }`, navigate to `/layouts/:id`, toast "Layout created". The same playlist may be chosen twice.

**Editor (`LayoutEditorPage.tsx` loads; `LayoutEditor.tsx` in `EditorPage`; back "Layouts"; Cancel and Save; `headerStatusLabel`; `useLeaveGuard(dirty, …)`; "Delete layout" in the header menu).** It loads the layout, `api.listPlaylists()` and `api.listDisplays()` (for "Preview on", as AppEditor.tsx:68, :115).
- **Details card:** Name, Description (its error under the textarea). Facts: Screens (`assignedScreensLabel`), Created, Updated.
- **Zones card:**
  - Fixed help text at the top: "Screens need player 0.5.0 or later to show a layout. Reload the player page on each screen after this update; until then an older player keeps its last content and the screen's page says so."
  - With a preset (`bandPercent !== null`): `Field` "Band height (%)" holding a `Stepper` (min 5, max 50, step 1, unit "%", `stepLabel` "band height"), hint "Part of the height of each screen's content area. The main zone fills the rest."
  - Without one: an info `Banner` "These zones were set outside this editor; their sizes are kept." and no Stepper. Each zone's playlist stays editable.
  - Then one `<fieldset>` per zone (`LayoutZoneFields.tsx`) with a visible `<legend>` from `zoneLabel` ("Main zone", "Band", "Zone 3"). Inside, `Field` "Playlist" with `PlaylistSelect` and its "Open playlist" link. The band's Field has the hint "Put a Ticker or Text app in the band; its text is sized to the band." Because each control sits in a named fieldset, every control has a unique accessible name.
  - `// shortcut: one preset (bottom band); add numeric x/y/width/height fields per zone (the keyboard form of a free editor) and top/side presets when the client asks (question 1).`
- **Preview card (`LayoutPreview.tsx`):**
  - `Field` "Preview on": a native `Select` from `previewShapes(displays)` (lib/apps.ts:284-298).
  - `CanvasFrame` (`size="xl"`, features/displays/detail/CanvasFrame.tsx:31) with one box per zone as its children. Each box is placed with `cssVars` percentages of the content area (ui/cssVars.ts:9; the content area itself comes from `frameGeometry`, lib/screenDetailCanvas.ts:202-222), computed from `zoneSizes`; no style attribute.
  - Each box carries a text label "{zoneLabel}: {playlist name}" ("…: no playlist chosen" while none is chosen).
  - The frame's `description` is `zoneSizeSentence`, so assistive technology hears the pixel sizes.
  - When a zone is under 16 px on the chosen shape, a warning `Banner` under the frame: "On {shape label}, the {zone label, lower case} is {w} × {h} px. A zone needs at least 16 px each way, so screens of this shape cannot show this layout. Make it larger." Nothing is shown by colour alone.
  - While the band height is not a whole number from 5 to 50 the frame shows its `emptyText` "Enter a band height from 5 to 50 to see the zones."
  - `// shortcut: zone outlines only, no live content or 1:1 zoom in the preview.`
- **Keyboard.** Every control is native (`Select`, `Stepper`, buttons and links); nothing works by pointer only, so no separate keyboard equivalent is needed. The Stepper steps by 1 with Arrow Up and Arrow Down and by 10 with Page Up and Page Down (ui/Stepper.tsx:46-57), and the preview follows the draft as it changes. The zone boxes in the preview are not focusable: they are a picture, described in text.
- **Errors and focus.** Errors sit under their control with `aria-invalid` and `aria-describedby`. A Save that fails validation shows the error summary `Banner` and **focuses the summary** after the frame (as AppEditor.tsx:146-155). Each summary entry is a link (the whole line) that focuses its control, found by test id inside the form: `layout-name`, `layout-description`, `layout-band-percent`, `layout-zone-{n}-playlist`. Focus never falls to the body.
- **Save:** `replaceLayout`, toast "Layout saved" with the detail "Screens that use it show Changes waiting until you push.", then `push.refresh()`. `validation_failed` details map through `layoutErrorsFromApi`.
- **Delete (`DeleteLayoutDialog.tsx`, ConfirmDialog danger):** "Delete {name}?" / "The layout is removed for good. Screens that already show it keep it until their next push." / "Delete layout". `layout_in_use` shows the error and the screen names (`refusalNames(details, 'display')`). Every open starts without the previous refusal (slice 3 as-built).
- `layouts.css` with `tx-layout-` classes: the zone boxes (outline, label), the cards; the fieldsets wrap at phone width (no sideways scroll).
- Apply `.agents/skills/web-design-guidelines/`.
- **Test ids:** list `layouts-create`, `layouts-table`, `layouts-search`, `layouts-refresh`, `layouts-count`, `layouts-empty`, `layouts-row-<id>`, `layouts-row-menu`; create dialog `layout-create-dialog`, `layouts-create-name`, `layouts-create-main`, `layouts-create-band`, `layouts-create-submit`; editor `layout-editor`, `layout-editor-missing`, `layout-name`, `layout-description`, `layout-save`, `layout-save-state`, `layout-cancel`, `layout-menu`, `layout-error-summary`, `layout-fact-screens`, `layout-band-percent`, `layout-custom-note`, `layout-zone-{n}` on each fieldset and inside it `-playlist` and `-open`, `layout-preview` (the frame; its content area `layout-preview-content`), `layout-preview-shape`, `layout-preview-zone-{n}`, `layout-preview-warning`; delete `layouts-delete-dialog` (`-confirm`, `-cancel`), `layouts-delete-screens`.

**Pickers**
- `PlaylistSelect` moves from features/schedules/ScheduleEventRow.tsx:21-87 to **features/shared/PlaylistSelect.tsx** unchanged (its shortcut comment moves with it), exported from shared/index.ts. Its CSS rule `.tx-schedule-pick` (features/schedules/schedules.css:114-125) moves to shared.css as `.tx-playlist-select`. ScheduleEventRow.tsx and ScheduleEditor.tsx (:49, the import only) import it from shared.
- The body of `SchedulePickerDialog` (features/shared/SchedulePickerDialog.tsx:57-234) moves into a generic **features/shared/LibraryPickerDialog.tsx**: `LibraryPickerDialog<T extends { id: string; name: string }>` with today's props plus `load: (signal) => Promise<T[]>` (a module-level function, so `useLoadWhileOpen` sees a stable one), `meta: (item: T) => string`, `searchTexts: (item: T) => readonly (string | null)[]`, `icon: IconComponent` and `noun: { singular: string; plural: string; href: string }`. Its texts are built from the noun: "Search {plural}", "Loading {plural}", "The {plural} could not be loaded", "No {plural} yet", "Go to {plural}", "Create a {singular} first, then come back to choose it.", the radiogroup label "{Plural}", "No {singular} matches", `countLabel(n, singular)`.
- `SchedulePickerDialog` keeps its props and texts as a thin wrapper, so its callers and tests pin it. A new thin **`LayoutPickerDialog`** beside it: props as `SchedulePickerDialog` with `onConfirm(layout: LayoutDto)`, defaults `title = 'Choose a layout'`, `confirmLabel = 'Choose layout'`, `testId = 'shared-layout-picker'`; icon `LayoutTemplate`; rows show the name and `layoutSummaryLabel`; search over name, description and zone playlist names; empty state links to `/layouts`. There is no third copy.

**Screen page**
- `detail/ContentCard.tsx`:
  - `AssignState.kind` (:49) gains `'layout'`; `hasContent` (:65) and `savedHasContent` (:92) use `assignedContent(…) !== null`; the `save` patch type (:80-83) gains `assignedLayoutId`.
  - Nothing assigned: three buttons, "Assign playlist" (primary, `screen-detail-choose-playlist`), "Assign schedule" (`screen-detail-choose-schedule`) and "Assign layout" (icon `LayoutTemplate`, `screen-detail-choose-layout`). The note (:183-185) says "Choose a playlist, a schedule or a layout for this screen, then push it."
  - With a layout: the caption "Layout", its name, "Main zone: {mainPlaylist.name}" (`screen-detail-main-playlist`), the existing `PlaylistMeta`, and "Open layout" (`/layouts/:id`, `screen-detail-open-layout`).
  - The Change menu (:207-228) gains "Choose a layout…" (icon `LayoutTemplate`) after "Choose a schedule…".
  - "Remove content" (:132-139) sends `{ assignedPlaylistId: null, assignedScheduleId: null, assignedLayoutId: null }`.
  - The playlist picker's description (:295-297) adds `CONTENT_REPLACED_NOTE` when the screen has a schedule or a layout.
  - A `LayoutPickerDialog` with title "Assign content", description "Choose the layout for {name}. Nothing changes on the screen until you push. Screens need player 0.5.0 or later to show a layout.", `confirmLabel` "Assign layout", `errorTitle` "The layout was not assigned", `testId` `screen-detail-layout-picker`. Toast "{name} assigned".
  - The focus rule stays: when a save swaps the buttons for the Change menu or back, focus moves to the first control that took their place (:67-76).
- `detail/useAssignedPlaylist.ts` (:28-33): the `Pick` gains `assignedLayout`; the playlist read falls back to `display.assignedLayout?.mainPlaylist.id`. `// shortcut: with a layout the preview shows the main zone's playlist only; draw the zones on the screen page if operators ask.`
- `detail/AssignedPreview.tsx` (:51-58) and `lib/screenDetail.ts` `previewCaption` (:536-549): a fifth parameter `layoutName: string | null = null` (the existing calls and tests keep their four arguments); with a layout the caption adds "This is the main zone of the layout “{name}”." The `nothing_assigned` text (:559) becomes "No playlist, schedule or layout is assigned to this screen, so there is nothing to preview."
- `detail/ScreenTabs.tsx:102` and `detail/OverviewTab.tsx` (:22-23, :78-84, :173-178): the prop `scheduled: boolean` becomes `contentKind: ContentKind | null`; the schedule sentence is unchanged, and with a layout the "Item N of the active publication" fact adds "With a layout, this is the item in the main zone; other zones are not reported."
- lib/screenStatusPush.ts:23: "No playlist, schedule or layout is assigned to this screen, so there is nothing to push."

**Other places that say or assume "playlist or schedule"** (WP6 unless marked)
- ScreensList Content column: "Layout: {name}" linking to the layout (the schedule and playlist cells as today), through `assignedContent` and `contentHref`. `allowNone` is offered only when `assignedContent(assignSingle)` is null or a playlist. The "kept" toast (:296-309) reads "{name} now has a {kind}" / "Its {kind} stays assigned. To remove it, use "Remove content" on the screen's page." for a schedule or a layout. The shortcut at :924 reads "content cannot be removed from a screen with a schedule or a layout in the list; …".
- PushDialog row meta: a `LayoutTemplate` icon and "Layout: {name}" when `row.layout !== null`; with issues the link is "Open layout" (`/layouts/:id`, with the visually hidden name). Its empty state (:336): "Add a screen and assign a playlist, a schedule or a layout to it, then push from here."
- Wording that says "a playlist or a schedule" becomes "a playlist, a schedule or a layout": lib/pushDialog.ts:111 and :568; lib/dashboard.ts:386 and :391; lib/playlistEditor.ts:707 ("…Screens that play it through a schedule or a layout are pushed with Push to screens."). The pins move with them: pushDialog.test.ts:199 and :732, dashboard.test.ts:477 and :482, playlistEditor.test.ts:903, screenDetail.test.ts:365, screenStatus.test.ts:241.
- Wizard (ContentStep.tsx:147-154): with a schedule as today (`screen-wizard-schedule-note`); with a layout the same Banner reads "This screen has a layout. It gets the playlist you assign here instead of its layout." (`screen-wizard-layout-note`).
- **Playlist delete refusal (WP5)**: `DeleteFailureText.bySchedule` (lib/playlistsListActions.ts:55) becomes `refusedBy: 'display' | 'schedule' | 'layout' | null` (null when the delete was not refused as in use). `refusalNames(details, path: 'display' | 'schedule' | 'layout')`. `deleteFailureText` checks schedule names, then layout names ("Used by the layout {names}." / "Used by the layouts A and B.", hint "Choose another playlist in that layout, then delete the playlist." / "…in those layouts…"), then screen names. The refusal without names (a race, :92-101) keeps `refusedBy: 'display'` and reads "A screen has this playlist assigned, or a schedule or a layout uses it." with the hint "Assign other content to the screen, or choose another playlist in the schedule or layout, then delete the playlist." (pinned at playlistsListActions.test.ts:158). features/playlists/list/DeletePlaylistsDialog.tsx (:212-229) adds a "Go to Layouts" button (icon `LayoutTemplate`, `/layouts`) when any refusal has `refusedBy === 'layout'`.
- **Audit and activity (WP5; TypeScript forces the category and action maps)**:
  - lib/auditView.ts: `AUDIT_CATEGORY_LABELS.layout = 'Layouts'` (:34-47), `CATEGORY_SUBJECTS.layout = 'Layout'` (:111-124), `OBJECT_TYPE_LABELS.layout = 'Layout'` (:253-266), `AuditTargetKind += 'layout'` (:285-286), `TARGET_KINDS` (:294-302) and `TARGET_LABELS` (:304-312) gain it (label "Layout"), and `auditTargetPath` (:400-422) gives `/layouts/:id`, `RELATED_KEYS += { key: 'layoutId', kind: 'layout' }, { key: 'assignedLayoutId', kind: 'layout' }, { key: 'mainPlaylistId', kind: 'playlist' }` (:319-329; the last so the main playlist of a `layout.create` or `layout.update` shows with its name and a link), `AuditNames.layout` and `NO_AUDIT_NAMES.layout = null` (:425-445). `OBJECT_TYPE_LABELS` and `RELATED_KEYS` are plain lists TypeScript does not force, so they are named here and tested.
  - features/audit/useAuditNames.ts and features/dashboard/useActivityNames.ts read `listLayouts`; features/dashboard/ActivityCard.tsx:30 gains `layout: 'Layout'`.
  - lib/activity.ts: `ACTIVITY_OBJECT_KINDS += 'layout'` (:24-31); `WORDING` (:80-147) "Layout created / updated / deleted" (attempts "Layout creation / update / deletion", icon `other`); `REMOVALS += 'layout.delete'` (:150-156); `CATEGORY_LABELS.layout = 'Layout'`, `OBJECT_KIND_OF_TYPE.layout = 'layout'` (:172-194); `activityHref` gives `/layouts/:id` (:421-436); `ASSIGNMENT_FIELDS` (:272) is imported from contracts `ASSIGNMENT_KEYS`.
  - The `display.update` wording (:315-348) becomes a loop over `ASSIGNMENT_KEYS` with the same results for the two old keys. When `fields` holds assignment keys only: the first key (in `ASSIGNMENT_KEYS` order) whose recorded value is a string, or else the only named key when its value was not recorded (a failed attempt), reads "{Kind} assigned to screen" (attempt "{Kind} assignment", related: that object, label the kind); otherwise two or more named keys read "Content removed from screen" (attempt "Removing the content from a screen"), and one named key reads "{Kind} removed from screen" (attempt "Removing the {kind} from a screen"). `{ assignedPlaylistId: P, assignedLayoutId: null }` reads "Playlist assigned to screen".
  - `publication.create` (:379-392) names the layout first: `ref('layout', detail.layoutId) ?? (objectType === 'layout' ? ref('layout', objectId) : null)` with the label "Layout", then the schedule, then the playlist.
- Accessibility e2e (WP5): tests/e2e/11-accessibility.spec.ts `PAGES` (:83-99) gains `['layouts', () => '/layouts', 'Layouts']` and `` ['layout editor', () => `/layouts/${layoutId}`, `ZZ a11y layout ${runId}`] ``; its setup (:17-69) gains `let layoutId = ''` and creates the layout on the a11y playlist with `` operator.api.createLayout(bandLayout(`ZZ a11y layout ${runId}`, playlistId, playlistId)) ``.

### 8. Tests

Every list that pins schema version 5 as "unsupported" moves to 6, and every strict fixture gains the new required field. Both are listed per package below, with their lines.

- **contracts** (contracts.test.ts, portal-v2.test.ts):
  - contracts.test.ts:179-182: `parseManifest(manifest({ schemaVersion: 6 }))` gives `unsupported_version` with "manifest schemaVersion 6 is not supported (expected 1, 2, 3, 4 or 5)".
  - v5 manifest: accepted (two zones, a band at the bottom); counts that do not add up refused (path `zones`); `zones[0]` transition or shuffle differing from the top level refused; a rect outside the content rectangle refused, and outside the canvas when there is none; two overlapping rects refused, two that touch accepted; one zone and five zones refused; an extra key refused; **a v5 document with a `schedule` key refused**; a v4 document with `zones` refused.
  - `manifestZones`: v1 to v4 return `[m]` (`toBe` the same object); v5 returns one view per zone, each `ManifestV3Schema.parse`s, with `schemaVersion` 3, the zone's rect as `contentRect`, the zone's run of assets (running offsets), the zone's transition and shuffle, and `publicationId`, `displayId`, `createdAt`, `canvas`, `rotation`, `timeZone` and `workingHours` copied.
  - `manifestPlaylists`: one slice per zone for v5, with running `from`.
  - `rectsOverlap`: overlapping, touching on an edge, touching at a corner, one inside the other, disjoint; in pixels and in basis points.
  - `LayoutInputSchema`: two zones accepted; one and five refused; `x + width` over 10 000 refused with path `['zones', 1, 'width']`, `y + height` with `['zones', 1, 'height']`; an overlap with `['zones', 1]` and "zone 2 overlaps zone 1"; width 0 and a negative x refused; an extra key refused; a blank description parses to null.
  - `DisplayPatchSchema`: a layout and a playlist refused with path `['assignedLayoutId']` and "assign one of a playlist, a schedule or a layout"; a schedule and a layout the same; all three null accepted; one id with the other two null accepted. **portal-v2.test.ts:737 moves to the new message** (the path stays `assignedScheduleId`).
  - `DisplayDtoSchema`: the fixture (portal-v2.test.ts:99-117) gains `assignedLayout: null`; the required-field loop (:651) gains `'assignedLayout'`; an assigned layout with its main playlist is accepted, malformed ones refused.
  - `PushPlanRowSchema`: the fixture (:767-775) gains `layout: null`; a layout without a playlist refused; a schedule and a layout together refused.
  - Routes `layouts`, `layoutPattern`, `layout(id)` with `'../x'` encoded (as :1193-1196); the audit categories still equal the derived set (:1103-1110); `layout.*` actions present; `PUBLISH_REJECTION_CODES` contains `zone_too_small`.
- **domain** (new layout.test.ts; geometry.test.ts; push.test.ts; playlist.test.ts; fixtures.test-support.ts):
  - fixtures.test-support.ts: `route(maxItems = 200, maxRegions = 1)` (:163-182) gains the second parameter; the default keeps the refusal pin. A `planLayout(playlists, zones, options)` helper beside `planSchedule` (:201-233), planning each playlist as the API does.
  - geometry.test.ts `zoneRect`: 1920 × 1080 with a 15 % band gives a main zone 1920 × 918 and a band at y 918, 1920 × 162; neighbours share an edge; a content rectangle at (100, 50) offsets both; three zones of 3333, 3333 and 3334 basis points on 1000 px give edges at 333 and 667 that sum to 1000; 16 384 px is exact; a 96 px tall area gives a 10 px band at 10 % and 19 px at 20 %.
  - layout.test.ts `planLayoutPublication` with `route(200, 4)`: two zones give `zones` with rects, counts, transitions and shuffles and items main first; `manifestVersionFor` is 5 and `buildManifest` parses; **the same playlist in both zones is planned twice and sent twice** (the items appear twice, counts are equal); a zone under 16 px gives `zone_too_small` at `zones[1]` with the message and plans nothing (assert `plan` was not called); a missing zone playlist gives `playlist_empty` at `zones[1].playlist` with "A playlist of this layout no longer exists. Open the layout and choose another."; an item problem keeps its per-playlist index (`zones[1].items[0]`) and the "In playlist" prefix; the total of two playlists of 150 items with `maxItems` 200 gives one `too_many_items` at `layout` with "The playlists of this layout hold 300 items in total; …"; with `route(200, 1)` the combined draft gives `multiple_regions_unsupported` at path `layout` ("… can show 1 content region(s); this publication needs 2.").
  - schedule.test.ts: **no change**; it is the pin of the `planSources` extraction.
  - playlist.test.ts (`checkCapabilities`, :581-694): a draft with two zones against `maxRegions: 1` gives `multiple_regions_unsupported`; the `too_many_items` message for a layout draft names "this layout"; a draft without zones still says "The playlist has …".
  - push.test.ts: a band-height change gives `zones`; a zone's transition or shuffle changed gives `zones`; a changed item in zone 1 gives `item` at its flat index; a canvas change gives `canvas`; jsonb key order does not matter; a v5 manifest against a playlist draft gives `schemaVersion`; `buildManifest` throws for a draft with both `schedule` and `zones`.
- **delivery** (packages/delivery/test/delivery.test.ts, fake-route.ts): the browser profile pin (delivery.test.ts:163-176) moves to `profileVersion: 2` and `maxRegions: 4`. fake-route.ts keeps `maxRegions: 1` and gains one case: the test-only route refuses a two-zone draft with `multiple_regions_unsupported`.
- **db** (new `packages/db/test/stage-b-layouts.integration.test.ts`, template stage-b-schedules):
  - layout CHECKs: name length and trimming, description length; layout_zone CHECKs: position 4 refused, negative x, width 0, `x_bp + width_bp` 10 001 and `y_bp + height_bp` 10 001 refused (23514 with the constraint names).
  - Grants exactly as listed: on `layout` SELECT, INSERT, DELETE and UPDATE on `name` and `description` only; on `layout_zone` SELECT, INSERT, DELETE and no UPDATE at all; UPDATE on `display.assigned_layout_id`.
  - Cross-organisation foreign keys (23503): a zone on another organisation's playlist; a zone in another organisation's layout; a display with another organisation's layout.
  - `display_one_assignment`: a playlist and a layout, and a schedule and a layout, refused (23514, `display_one_assignment`).
  - Guards: a deleted playlist put in a zone refused (23001, `layout_zone_playlist_guard`); soft-deleting a playlist that a zone uses refused (23001, `playlist_delete_guard`); **regression**: soft-deleting a playlist that a display has assigned, or that a schedule uses, is still refused, and an unused playlist can still be deleted.
  - Deleting an assigned layout gives 23503 `display_assigned_layout_fk`; deleting an unassigned one removes its zones.
  - A v5 publication with `publication_asset` rows for media positions of both zones is accepted by the 0004 guard.
  - The manifest version: one line pointing at the two pins below (no third copy, as slice 3 as-built did).
  - rls.integration.test.ts: `TENANT_TABLES` (:12-33) gains `layout` and `layout_zone`; `ROWS_PER_ORG.layout_zone = 2` (:38-42); the read probes (:263-289), the update and delete list (:323-340), the insert attempts (:382-430), the org-move list (:438-466) and the cross-organisation attach list (:469-545) each gain the layout rows, as they hold schedule rows; **:927 moves from 5 to 6**.
  - stage-b.integration.test.ts: the display grant list (:139-166) gains `assigned_layout_id` with the comment `// 0011` and the test name says so; the version test (:170-199) is renamed "accepts schema versions 1 to 5 and refuses 6", `insert(5)` gives `'no error'` and **`insert(6)` gives `PG.check`** (was 5 at :197).
  - migration-0005.integration.test.ts: `upgrade.applied` (:545-552) also contains `'0011_stage_b_layouts.sql'`; the definition check (:574-584) also expects `"'5'"`; the table list (:595-622) gains `layout` and `layout_zone` under "// 0011, applied with the rest."
  - support.ts: `createOrg` (:69-223) seeds an unassigned layout with two zones on the organisation's playlist (positions 0 and 1; 0/0/10000/8500 and 0/8500/10000/1500) and `TestOrg.layoutId`; its doc comment says `layout_zone` gets two rows.
- **api** (new `apps/api/test/layouts.integration.test.ts`; additions elsewhere; `apps/api/test/support.ts` gains `layoutZones(mainPlaylistId, bandPlaylistId, bandPercent = 15): LayoutZoneInput[]`, `createLayout(operator, name, zones): Promise<LayoutDto>` and `assignLayout(operator, displayId, layoutId | null)`, beside `createSchedule` and `assignSchedule` (:538-578)). A case goes into layouts.integration.test.ts unless the helpers it needs live in another file (`planRow`, `pushAgainstHeldEdit` and the publish helpers in push.integration.test.ts), as slice 3 as-built did (stage-b.md:1634):
  - CRUD with audit events (`layout.create` and `layout.update` with `{ mainPlaylistId, zoneCount }`, `layout.delete` with `{ zoneCount }`); PUT replaces the zones and keeps their order; `updated_at` moves on a zone-only change; GET of the list and of one layout.
  - **The path form of a refusal:** unknown, deleted and other-organisation playlists give 400 at `zones.1.playlistId`; one zone, five zones, an overlap (`zones.1`) and `x + width` over 10 000 (`zones.1.width`) give 400 with those paths.
  - **Upper-case ids:** a POST and a PUT with upper-case `playlistId`s succeed; the DTO and the audit detail carry them in lower case (the schedule block of audit-trail.integration.test.ts, :399-513, gets a layout twin before the whole-trail check at :514).
  - `layout_in_use` with screen names; the 23503 race answer is not tested (it needs two interleaved transactions), as for schedules.
  - Displays: assigning a layout clears a playlist and a schedule, and assigning either clears a layout; a layout and a playlist in one patch refused (400, `assignedLayoutId`); all three null clears; unknown and foreign layouts 404; the DTO carries `assignedLayout` with the main playlist; **a name-only PATCH on a screen still works** (pins the `display` grant). Audit: `{ assignedPlaylistId: P }` on a layout screen records `fields: ['assignedPlaylistId']`, `assignedPlaylistId: P` and `assignedLayoutId: null`.
  - **schedules.integration.test.ts:577** moves to the new refinement message, and the strict plan-row `toEqual` at :615-622 gains `layout: null` (as push.integration.test.ts:173-180; `toEqual` does not ignore a key whose value is null).
  - Push (push.integration.test.ts): a layout gives `never_pushed`, then a v5 publication whose `publication_asset` rows cover media of both zones, `publication.playlist_id` is the main zone's playlist, the audit detail has `layoutId`; then `up_to_date`; a band-height PUT gives `changes`; **one layout on a 1920 × 1080 screen and a 192 × 96 screen with a 10 % band: the small screen is `blocked` with `zone_too_small` at `zones[1]`, the large one pushes**; a blocked push is audited with `objectType: 'layout'`; over the total gives `too_many_items` at `layout` (its own app with `LIMIT_MAX_PLAYLIST_ITEMS=3` and two playlists of two app items, as slice 3 as-built); the plan row at :173-180 gains `layout: null`.
  - **Push against a concurrent PUT** with `pushAgainstHeldEdit` (push.integration.test.ts:1074): replace the zones (a new band height) and the name with SQL in the held transaction; the push answers `published` and the stored manifest's `zones` are the new ones.
  - Publish (push.integration.test.ts, beside the schedule case): publishing a playlist to a layout screen clears the layout and the `publication.create` detail has `assignedLayoutId: null`; a repeated key whose stored manifest has `zones` answers 409 `idempotency_conflict`.
  - Playlists (playlists.integration.test.ts): DELETE of a playlist used by a layout, as the main zone and as the band, gives 409 `playlist_in_use` with `{ path: 'layout', message: name }`.
  - Player (player.integration.test.ts): `/player/manifest` serves v5; media URLs are issued for an asset that is only in zone 1.
  - dashboard.integration.test.ts: the setup creates a layout, and the category sets (:376-392) gain `layout`.
- **tests/integration** (cross-org.test.ts, session-csrf.test.ts):
  - cross-org.test.ts: `world()` (:60-112) creates a layout on its published playlist in both zones and returns `layoutId`; the unknown-id reads (:140-180) gain `/api/layouts/${layoutId}`; the list checks (:182-253) gain `/api/layouts` (not leaking `a.layoutId`, and holding one item); the snapshot (:256-271) gains the layout and the list; the refused mutations (:276-399) gain `PUT layout`, `DELETE layout` and `assign A layout to own display` (all 404); **naming A's playlist in B's own layout, through POST and through PUT, as the main zone or as the band, answers 400 with 'The playlist was not found.'**, exactly as an unknown id (as :421-434 does for schedules); Bob's own display (:445-452) still has `assignedLayout: null`; `TABLES` (:572-592) gains `layout` and `layout_zone`.
  - session-csrf.test.ts: `OPERATOR_ROUTE_PATTERNS` (:66-70 holds the schedule ones) gains all five: `['GET', '/api/layouts']`, `['POST', '/api/layouts']`, `['GET', '/api/layouts/:id']`, `['PUT', '/api/layouts/:id']`, `['DELETE', '/api/layouts/:id']`. "lists every /api route the application serves" (:105-125) then covers them.
- **player** (core/zones.test.ts, new; `makeManifestV5(zones, overrides)` in core/fakes.test-support.ts beside `makeManifestV4` (:161-182), where `zones` are `{ rect, items, transition?, shuffle? }`):
  - `ZoneSet` with fake presenters and fake loops that record calls in one shared log:
    - v1 to v4: `adopt` returns the manifest itself and creates no zone;
    - v5 with two zones: returns view 0 (`schemaVersion` 3, zone 0's rect and run); creates zone 1's presenter and loop and starts it; zone 1's `loadActive` gives view 1;
    - the same publication again: the cached view 0, no new presenter, no wake;
    - a new publication with the same zone count: zone 1 kept, its `loadActive` gives the new view, `wake` called once;
    - **from three zones to two, and from v5 to v1: the gone zones' signals are aborted and `remove()` is called before any new presenter is created** (assert the order in the log);
    - from two zones to three: a presenter for zone 2;
    - `adopt(null)` stops every secondary zone; aborting the session's signal aborts every zone's signal; `stopAll`;
    - `inUse` is the union of the secondary presenters.
  - sync.test.ts: the unsupported version moves from 5 to 6 at **:226, :235, :255-257 and :360**; a v5 manifest activates and stages the media of both zones.
  - No other playback or time-rules test changes: the loop and the rules are untouched.
- **portal** (unit unless marked):
  - new lib/layouts.test.ts: `bandZones` and `bandPercentOf` round trip for 5, 15 and 50; `bandPercentOf` gives null for three zones, a band at the top, 4 % and 51 %, and a non-whole percent; draft from DTO; dirty; validate (missing name, bad description, band "4", "51", "12.5" and "" refused; a zone without a playlist; a custom layout keeps its geometry); `layoutErrorsFromApi` with `name`, `description`, `zones.1.playlistId`, `zones.1.width`, `zones` and an unknown path (the last three to `form`); `zoneSizes` and `zoneSizeSentence` for 1080 × 1920 and a 3840 × 480 shape with a content rectangle; `tooSmall` on a 192 × 96 shape at 10 %; labels; filter and sort.
  - new lib/assignedContent.test.ts: each kind for `assignedContent` and `planRowContent` (a layout row also carries its main playlist and reads as a layout); `contentHref`; `anyHasOtherContent`; the `CONTENT_REPLACED_NOTE` text.
  - nav.test.ts (section 7); endpoints.test.ts: the five calls, and the display and plan-row fixtures gain `assignedLayout: null` and `layout: null`.
  - **Every strict display fixture gains `assignedLayout: null` and every plan-row fixture `layout: null`**: lib/{screenDetail, screensList, screenDetailCanvas, dashboard, pushDialog, playlistEditor, lib}.test.ts (WP6), api/endpoints.test.ts (WP5), the `row()` helper of lib/playlistsListActions.test.ts (:51-68, typed `PushPlanRow`; WP5), and the component tests features/displays/detail/ContentCard.test.tsx and features/displays/list/ScreensList.test.tsx (WP6).
  - screensList.test.ts: the marker for a layout screen; no marker for a playlist screen whose plan row carries a layout; the content label and link; the cases of the removed helpers (:571-586) are deleted here, because assignedContent.test.ts (WP5) covers them.
  - pushDialog.test.ts: search by layout name; :199 and :732 reworded. dashboard.test.ts: :477 and :482 reworded. playlistEditor.test.ts: `rowsForPlaylist` leaves out a layout row whose main zone is this playlist; :903 reworded. screenDetail.test.ts: the layout caption; :365 reworded. screenStatus.test.ts: :241 reworded.
  - playlistsListActions.test.ts (WP5): a layout refusal (one and two names); `refusalNames` with `'layout'`; :158 reworded; `assignPushView` does not take a layout row for caught up.
  - auditView.test.ts (WP5): `layoutId`, `assignedLayoutId` and `mainPlaylistId` of a detail are related objects; the layout kind's label and path. activity.test.ts (WP5): the `layout.*` wordings; the `display.update` table with three keys (each kind assigned, each removed, all removed, `{ assignedPlaylistId: P, assignedLayoutId: null }` reads "Playlist assigned to screen", a failed attempt); a layout push names the layout; the names fixture (:49) gains `layout`.
  - ContentCard.test.tsx (component, WP6): a layout screen shows "Layout", "Main zone: {name}" and "Open layout"; "Remove content" sends the three nulls; the third button on a screen with nothing assigned.
- **e2e portal (`tests/e2e/12-layouts-portal.spec.ts`, written, not run by agents).** Playlists, the Ticker app and the screens through `OperatorApi`.
  1. Create a layout through the dialog by keyboard (name, main zone playlist, band playlist); the editor opens with "Band height (%)" at 15.
  2. Choose "Choose a playlist" for the band and save: focus lands on the error summary; its link focuses the band's Playlist select; choose the playlist again ("Open playlist" appears beside it).
  3. Raise the band to 20 with Arrow Up; the preview on "Landscape 1920 × 1080" says "main zone 1920 × 864 px, band 1920 × 216 px"; on "Portrait 1080 × 1920", "main zone 1080 × 1536 px, band 1080 × 384 px"; save; toast "Layout saved".
  4. Preview on a 192 × 96 screen at 5 %: the warning names the band and its size.
  5. Assign the layout on a screen's page with "Assign layout"; the push dialog row says "Layout: {name}"; push; the row reads Up to date.
  6. Deleting the layout is refused with the screen's name; deleting a playlist the layout uses is refused with "Used by the layout {name}." and a "Go to Layouts" button.
  7. Assigning a playlist to that screen through the Change menu replaces the layout, and the picker said "A screen that has a schedule or a layout gets this playlist instead."
  8. Phone width does not scroll sideways (`scrollsSideways`); no CSP violations; no web storage.
- **e2e player (`tests/e2e/13-layouts-player.spec.ts`):** section 6.
- **e2e, other files:** tests/e2e/11-accessibility.spec.ts (section 7); tests/e2e/09-schedules-portal.spec.ts: the note at :312-314 becomes `CONTENT_REPLACED_NOTE`, and the two `assignedContent()` checks (:53-56 type, :253-256 and :320-323) also expect `assignedLayout: null`.
- **e2e support:** tests/e2e/support/operator.ts (WP4, written first): `export interface LayoutInput { readonly name: string; readonly zones: readonly { readonly playlistId: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }[] }`, `export function bandLayout(name: string, mainPlaylistId: string, bandPlaylistId: string, percent = 15): LayoutInput`, and `OperatorApi.createLayout(input): Promise<{ id: string }>`, `replaceLayout(id, input): Promise<void>`, `assignLayout(displayId, layoutId): Promise<void>` (as :240-258). tests/e2e/support/player.ts (WP4): `zoneBox(page, zone)` (the `zone-{n}` box's client rectangle). tests/e2e/support/portal.ts (WP5): `createLayoutInPortal(page, name, mainName, bandName): Promise<string>`, `saveLayout(page)`, `assignLayoutOnScreenPage(page, screenId, layoutName)`.

### 9. Docs (WP7)

- docs/portal-v2/stage-b.md: the Date line (:3) names slice 4; after the build, the as-built table of this slice. The slice 3 as-built table is history and is not edited.
- docs/portal-v2/README.md row B (:26): "multi-zone layouts with a canvas editor" becomes "layouts: a main zone and a band along the bottom, each with its own playlist (a free canvas editor is deferred)"; slice 4 built, with manifest v5 and `player-web/0.5.0`; "Layouts are the slice that remains." goes.
- docs/player-protocol-v1.md: section 5 "Manifest v5 (stage B, slice 4: layouts)" (after :195-241): the fields, the flat list, the zone views, the main zone's role, gaps are black, no overlap; section 9 (:341-357): profile version 2 with up to four regions, the version sentence (v5 exactly when a layout is assigned), the old-player bullet for 0.5.0, the version rule (v4 frozen; v5 frozen when 0.5.0 is released; next is v6), the item total applies to all zones together and a playlist in two zones counts twice, and `zone_too_small`.
- docs/security/threat-model.md: a new section "13. Stage B, slice 4: layouts" (section 12 is the round 3 fixes) with one row (T2, T5): layouts add no outside data; layout names are operator text shown as text nodes only and are not in the manifest; two new tenant tables under forced RLS. docs/security/control-matrix.md row B4: "(20; …" becomes "(22; …" and a layouts passage after the schedules one.
- docs/dev-handoff.md:190: the publish replay is also refused when the stored manifest has `zones`.
- apps/player-web/README.md: Renderer (:272-321): `DomStage`, one presenter and one loop per zone, zone views, the main zone speaks for the screen, the shortcuts of section 6; the version paragraph (:213) accepts v1 to v5 and refuses 6; the build in the diagnostics overlay (:421) is `player-web/0.5.0`.
- apps/portal/README.md (:35-40, :65), apps/portal/src/ui/README.md (route table: `/layouts` and `/layouts/:id` added after :1025, and `/layouts` removed from the PlannedPage row at :1026; Layouts notes after :1034; the Content card note :1038), features/shared/README.md (`LibraryPickerDialog`, `LayoutPickerDialog`, `PlaylistSelect`; :322 `CONTENT_REPLACED_NOTE` and `anyHasOtherContent`; :383 the "Assigned: layout" label), features/push/README.md (:52 row wording), tests/README.md (the two new spec files).

### 10. Work packages (file ownership does not overlap between packages)

- **Wave 1 / WP1 Contracts, domain and delivery** (sections 3 and 4).
  - packages/contracts/src/{layout (new), ids, refs, limits, canvas, display, push, manifest, playlist, audit, errors, routes, index}.ts, contracts.test.ts, portal-v2.test.ts.
  - packages/domain/src/{layout (new), layout.test (new), sources (new), schedule, types, playlist, capability, geometry, manifest, push, index}.ts, geometry.test.ts, playlist.test.ts, push.test.ts, fixtures.test-support.ts. schedule.test.ts is read, never edited.
  - packages/delivery/src/browser/browser-route.ts, packages/delivery/test/{delivery.test, fake-route}.ts.
  - Publish contracts `layout.ts`, `manifest.ts`, `display.ts` (`ASSIGNMENT_KEYS`) and domain `types.ts` first, with the exact names above.
- **Wave 1 / WP2 Migration 0011 and DB tests** (section 2).
  - db/migrations/0011_stage_b_layouts.sql; packages/db/src/constraints.ts.
  - packages/db/test/{stage-b-layouts.integration.test.ts (new), rls.integration.test.ts, stage-b.integration.test.ts, migration-0005.integration.test.ts, support.ts}, and any other packages/db/test file that pins the table list, the display grants or the accepted manifest versions.
- **Wave 2 / WP3 API** (section 5).
  - apps/api/src/{app.ts, publishing.ts, routes/layouts.ts (new), routes/displays.ts, routes/playlists.ts, routes/push.ts}.
  - apps/api/test/{layouts.integration.test.ts (new), push, publish, playlists, player, audit-trail, dashboard, schedules}.integration.test.ts, apps/api/test/support.ts.
  - tests/integration/{cross-org, session-csrf}.test.ts.
- **Wave 2 / WP4 Player 0.5.0** (section 6).
  - apps/player-web/src/{config.ts, app.ts}; ui/{stage.ts (new), presenter.ts}; core/{zones.ts (new), zones.test.ts (new), playback.ts (the :222 shortcut text only), errors.ts (the shortcut only), fakes.test-support.ts, sync.test.ts}.
  - tests/e2e/13-layouts-player.spec.ts (new), tests/e2e/support/{operator, player}.ts. **Writes `OperatorApi.createLayout`, `replaceLayout`, `assignLayout` and `bandLayout` first**: WP5's e2e files call them.
- **Wave 2 / WP5 Portal: layouts** (section 7: shell, endpoints, lib/assignedContent.ts, the layouts pages, the pickers, audit and activity, the playlist-delete refusal).
  - apps/portal/src/{App.tsx, shell/nav.ts, shell/nav.test.ts, api/endpoints.ts, api/endpoints.test.ts}.
  - features/layouts/** (new); features/planned/PlannedPage.tsx; features/styleguide/SurfaceSections.tsx; features/schedules/{ScheduleEventRow.tsx, ScheduleEditor.tsx (the import only), schedules.css (the moved rule only)}; features/audit/**; features/shared/{LibraryPickerDialog.tsx (new), LayoutPickerDialog.tsx (new), PlaylistSelect.tsx (new), SchedulePickerDialog.tsx, index.ts, shared.css}; features/dashboard/{ActivityCard.tsx, useActivityNames.ts}; features/playlists/list/DeletePlaylistsDialog.tsx.
  - lib/{assignedContent (new), layouts (new), auditView, activity, playlistsListActions}.ts and their tests. In playlistsListActions.ts WP5 also makes the `assignPushView` change (section 7), although the flow it serves is WP6's.
  - tests/e2e/{12-layouts-portal.spec.ts (new), 11-accessibility.spec.ts, 09-schedules-portal.spec.ts}, tests/e2e/support/portal.ts.
  - **Writes `lib/assignedContent.ts`, `api/endpoints.ts` and `LayoutPickerDialog` first**: WP6 codes against the names in section 7.
- **Wave 2 / WP6 Portal: screens and push** (section 7, "Screen page" and "Other places", except audit, activity and the delete refusal).
  - features/displays/** (ContentCard and its test, useAssignedPlaylist, AssignedPreview, ScreenTabs, OverviewTab, ScreensList and its test, ScreenRowMenu, wizard/ContentStep); features/push/{PushDialog.tsx, push.css (only if a rule is needed)}; features/dashboard/PushCard.tsx; features/shared/ScreenPickerDialog.tsx; features/playlists/{list/AssignToScreens.tsx, editor/PushCard.tsx}.
  - lib/{screensList, screenDetail, screenStatusPush, pushDialog, dashboard, playlistEditor}.ts and the tests lib/{screenDetail, screensList, screenStatus, pushDialog, screenDetailCanvas, dashboard, playlistEditor, lib}.test.ts.
- **Wave 3 / WP7 Docs** (section 9): every file listed there, nothing else.

**Checks per package are scoped to what the package owns** (as slice 3, stage-b.md:1523-1531, with its as-built correction at :1653). WP1 makes `DisplayDto.assignedLayout`, `PushPlanRow.layout` and `PublicationDraft.zones` required and removes `PublicationDraft.regions`, so after Wave 1 the root typecheck and the unit run are red in apps/api and apps/portal until WP3, WP5 and WP6 have all landed. No package can make the root commands green alone, so no package runs them as its gate:
- Typecheck, own workspaces only: WP1 `npm run typecheck -w @tinnox/contracts -w @tinnox/domain -w @tinnox/delivery`; WP2 `-w @tinnox/db`; WP3 `-w @tinnox/api`; WP4 `-w @tinnox/player-web`; WP5 and WP6 `-w @tinnox/portal`. Files under tests/ are the `@tinnox/tests` workspace: WP3, WP4 and WP5 also run `npm run typecheck -w @tinnox/tests` and answer for the errors in their own files.
- Unit tests by path: `npx vitest run --project unit <own files or folders>`. WP6 also runs its two component tests by path: `npx vitest run --project component apps/portal/src/features/displays/detail/ContentCard.test.tsx apps/portal/src/features/displays/list/ScreensList.test.tsx` (headless Chromium; if it is not installed, say so in the hand-back).
- Lint by path: `npx eslint --max-warnings=0 <own files or folders>`.
- WP2 and WP3 also run their own integration files (`npx vitest run --project integration <file>`), one agent at a time.
- **A failure in a file the package does not own is expected. Report it (file, line, message) in the hand-back; do not fix it.** For WP5 and WP6 the portal typecheck stays red on the other package's files until both have landed: each reports the errors left in its own files as zero and lists the rest.

**Integration step (the orchestrator, after Wave 2 and before WP7):** run the root `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:component`, then the integration files of WP2 and WP3 once more, and `npm run format:check`. The orchestrator owns every failure in a file that no package listed, and hands a failure in an owned file back to that package.

Nobody runs the e2e suite, starts or stops the dev stack, commits, pushes or switches branches.

### 11. Deferred (recorded, not dropped)

| Source | What it asks | Status after this slice |
|---|---|---|
| README row B (docs/portal-v2/README.md:26) | "multi-zone layouts with a canvas editor" | One preset: a main zone and a bottom band, 5 to 50 %. The data, the API, v5 and the player take two to four free rectangles, so a free editor is portal-only work (client question 1). |
| mvp-spec:60, :88 | "Full-canvas single region" template | Assign a playlist instead (client question 11). |
| mvp-spec:127 | Text band "with font size and colour"; a playlist or media per region | The band is a playlist; a Ticker or Text app gives the text and its colours, and its size follows the band (client question 3). |
| mvp-spec:127 | Preview "at the exact canvas pixel dimensions … with a 1:1 zoom option" | Zone outlines with pixel sizes in the accessible description; no live content, no 1:1 zoom. |
| mvp-spec:151 | Canvas change needs confirmation because layouts depend on it | Not needed: zones are relative to each screen's content area. A screen whose zone would be under 16 px is blocked with `zone_too_small`. |
| PL-04 (docs/acceptance-tests.md:77) | "ticker text wraps correctly on portrait and custom canvases" | The moving ticker stays on one line by design (render.ts:234) and wraps only with reduced motion (render.ts:220); 13-layouts-player checks the band box, the font size and the reduced-motion wrap. |

Also deferred:
- **Editor:** numeric x, y, width and height fields per zone (the keyboard equivalent of a free editor), then drag; top and side presets; a template gallery; duplicating a layout.
- **Zone content:** a media item or an app placed directly in a zone; fit per zone; stretch and none.
- **Text band:** an explicit font size.
- **Nesting:** layouts as schedule events, schedules in zones, dated events (all v6 once 0.5.0 is released).
- **Player:** an atomic relayout (drain and swap); heartbeat v2 with per-zone state; `CapabilityProfile.maxVideoRegions`; the error log deduplicated by code and asset.
- **Visual:** a background colour; z-order, overlap and transparency.
- **Portal:** live content and 1:1 zoom in the preview; layouts in the Add-screen wizard and in bulk assign; the zones drawn on the screen page; a pre-push warning for old players (needs the player version on the server).
- **Delivery:** one run of `assets` shared by two zones that use the same playlist; Huidu area compilation.

Every `// shortcut:` this slice adds: one preset (lib/layouts.ts or LayoutEditor.tsx); a playlist in two zones is sent twice (domain layout.ts); one item total for a schedule or a layout and the repeated display-level refusal (domain sources.ts, moved); video in every zone (domain capability.ts); zones adopt at their own next item, and removing a zone cuts its video (player core/zones.ts); heartbeat v1 reports the main zone (player app.ts); the error log dedupes against the newest entry only (player core/errors.ts); the v1-to-v3 boundary rule, extended to zone views (player core/playback.ts:222); zone outlines only in the preview (LayoutPreview.tsx); the screen page previews the main zone's playlist only (useAssignedPlaylist.ts); no pagination of the list (API routes/layouts.ts); no grid or bulk actions (LayoutsPage.tsx); content cannot be removed in the Screens list from a screen with a schedule or a layout (ScreensList.tsx:924, reworded).

### 12. Risks

1. **Concurrent decoders and tickers on Pi-class hardware.** Up to 8 `<video>` elements at the ceiling, 4 with the preset; more than one moving zone lags on a Pi 5 (AV4:56). No limit is enforced (shortcut). Unverified pending runtime.
2. **Rollout and rollback.** Every running player is 0.4.0 until its page is reloaded and refuses v5 (it keeps its content and retries on its backoff). Taking the player below 0.5.0 with a v5 version stored shows the waiting slate (`getActive` returns null when the stored manifest no longer parses, apps/player-web/src/platform/idb-store.ts:148-150). Taking the API below this slice after a v5 row exists makes `GET /player/manifest` throw (routes/player.ts:431-432), and `assessDisplays` reads `changes` for ever (apps/api/src/publishing.ts:518). Mitigation: the release note.
3. **The non-atomic relayout and zone removal** (section 6 shortcuts): for up to one video the old and new geometry share the screen; removing a zone cuts a video in it. On-screen behaviour is unverified pending runtime.
4. **Migration 0011** holds ACCESS EXCLUSIVE on `display` and `publication` until commit and re-reads every publication: quiet window. A missing `display` grant or a missing `assigned_layout_id = NULL` in the publish UPDATE would turn every display PATCH or every publish into a 500 (42501 or 23514); integration tests cover both (a name-only PATCH; publishing to a layout screen).
5. **Strict fixtures and stale tabs.** The required `assignedLayout`, `PushPlanRow.layout` and `PublicationDraft.zones` keep the root checks red until WP3, WP5 and WP6 land (section 10). A portal tab left open on the previous build parses responses strictly (apps/portal/src/api/endpoints.ts:81-84): the new `assignedLayout` and `layout` keys, and any blocked row that carries `zone_too_small`, give `invalid_response` until the tab is reloaded (release note; unverified pending runtime). The `planSources` extraction touches shipped schedule code; the unchanged schedule tests are its only guard.

Also: the replaced `playlist_delete_guard` is shared with stage A and slice 3 behaviour (the regression tests in section 8 guard it); one shortcut of slice 2 (`maxRegions` refusals in route profiles) now has a real consumer, pinned by the domain and delivery tests.

### 13. Client questions (the build uses the default shown)

| # | Question | Default built |
|---|---|---|
| 1 | A canvas editor or templates? README row B says "canvas editor". | One preset, a main zone and a band at the bottom, 5 to 50 %. The data allows free zones, so an editor is portal-only work. |
| 2 | Band at the top or the side? | Bottom only. |
| 3 | Font size of the text band | Auto-fit to the band; colours come from the Ticker or Text app. |
| 4 | A layout as a schedule event, or a schedule in a zone? **Decide before 0.5.0 ships.** | Neither. A yes after 0.5.0 is a v6. |
| 5 | Dated events in this v5? **Decide before 0.5.0 ships.** | No. If yes, they go into the same v5 now, so one version is cut. |
| 6 | Maximum zones; video in more than one zone | 4 on the wire, 2 from the editor; video is allowed in every zone (untested on hardware). |
| 7 | What the screen's status reports | The main zone. |
| 8 | The main zone fails or has nothing to show | The fault slate or "Waiting" over the whole screen; a failing band only goes black and is tried again after 30 s. |
| 9 | Gaps and background | Black. |
| 10 | Item limit | One total for all zones: 200 by default, configurable up to 500. A playlist in two zones counts twice. |
| 11 | The "full canvas" template | Assign a playlist instead. |
| 12 | A band too thin for a small LED screen | That screen is blocked with `zone_too_small` and the reason; other screens with the layout are pushed. |
| 13 | Moving players to 0.5.0 | Manual page reload of each screen, while it can reach the player host. |

### Self-check against the requested list

- **The task:** a screen split into zones, each with its own content: sections 2 to 7. Nothing else is built.
- **Forced RLS and tenant isolation:** both tables are forced, have the policy and organisation-scoped foreign keys, are in the RLS lists, are seeded per organisation, and have cross-organisation cases (`TABLES`, the routes, a display patch naming another organisation's layout, and another organisation's playlist in one's own layout).
- **Organisation only from the session:** every query uses `app_org_id()` inside `withOrg(session.orgId)`; the routes sit in the operator scope; no `sec.*` change.
- **Audit in the same transaction:** `layout.create`, `layout.update` and `layout.delete` are written with `auditScoped` on the same `Tx` as the change; details hold ids and counts only.
- **Immutable publications and idempotent push:** the layout is copied into the manifest; no publication column changes; a publish does not replay a stored manifest with zones.
- **A failed update never interrupts playback:** old players keep their content; all media of all zones is staged before activation; gone zones are stopped before new ones start.
- **v1 to v4 and released players:** screens without a layout keep v1 to v4 byte for byte; the player hands v1 to v4 to the main loop as the same object and the v1 to v4 DOM is unchanged.
- **Validation, security, accessibility not cut:** DB CHECKs twin the contract; the API refuses overlap and bounds; every control is native and has a unique accessible name; errors are tied to fields and the summary takes focus; the preview's sizes are in text; no inline style attribute.
- **Judges' points:** zone views are version 3, so the slice-0 fallbacks are each zone's own (sections 3, 6); the zone origin is in the rounding (4); no hidden pending generation and gone zones stop first (6); one source for the region count (4); `ordinal - 1` (5); the release note for `zone_too_small` and stale tabs (release note); `DomStage` owns every canvas-visibility site and the one resize listener (6); `planSources` takes a list and its doc says `plan` may run twice (4); a new code, not `multiple_regions_unsupported` (3, 4); `loadLayoutDrafts` is two statements with the reason in its doc (5); the cross-organisation smuggle case (8); locks held until commit, quiet window, the CHECK last, and the version pins (2, 8).
- **Architect's overrides:** the CHECK is replaced as 0009 did, with no `NOT VALID` and no `NOT VALID` test (2, 8); the browser route's `maxRegions` is `ABSOLUTE.maxLayoutZones` and its `profileVersion` 2 (4); the stale "0010" in "After this slice: layouts" carries a parenthesis, and the slice 3 as-built table is left as history.
- **Over-building avoided:** one preset, one new rejection code, one new error code, no zone ids, no layout id or name in the manifest, no heartbeat change, no status-contract change, no diagnostics row, no drain-and-swap, no new limit beyond the wire ceiling.

#### Critical files for implementation
- packages/contracts/src/manifest.ts
- packages/domain/src/layout.ts (new) and packages/domain/src/sources.ts (new)
- db/migrations/0011_stage_b_layouts.sql (new)
- apps/api/src/publishing.ts
- apps/player-web/src/core/zones.ts (new) and apps/player-web/src/ui/stage.ts (new)
- apps/portal/src/features/layouts/LayoutEditor.tsx (new)

### Slice 4: release note and rollback

- Release note: **reload screens after upgrading the player to `player-web/0.5.0`, before assigning a layout to them.** A running player is never reloaded by the server. Until its page is reloaded, a 0.4.0 or older player that is sent a v5 manifest reports `manifest_unsupported_version` and keeps playing its last content, or its waiting slate when it has none; the screen's Overview tab tells the operator to reload the player page. A 0.4.0 player retries the refused publication on its update backoff, not every 2 seconds. **Reload while the screen can reach the player host; if the Overview error stays, reload again** (a reload that gets no answer within 4 seconds shows the old build from the cache, apps/player-web/sw/sw.ts:22). The diagnostics overlay shows the build (`player-web/0.5.0`). Screens with a playlist or a schedule keep getting v1 to v4. **Reload open portal tabs after the API and portal deploy:** a tab on the previous build cannot read screens and push plans that mention layouts, or a push plan with a screen blocked by `zone_too_small`, and says `invalid_response` until it is reloaded.
- Operations, in this order: rebuild (`npm run build`); apply 0011 (`npm run db:migrate`) in a quiet window, because it takes ACCESS EXCLUSIVE locks on `display` and `publication` until commit and re-reads every publication; deploy the API and the portal together; deploy the player 0.5.0 build; reload each screen; then make the first layout push. Contracts, API and migration go out together, so no v5 row can exist before the API can read it. An API started without 0011 answers 500 on the layout routes.
- Rollback: taking a player below 0.5.0 while a v5 version is stored on it is unsupported and shows the waiting slate. First, on the server: assign a playlist (or a schedule) to every screen that has a layout and push; the push builds v1 to v4; wait until each screen reports it; then roll the player back. Taking the API below this slice after a v5 publication exists is unsupported for the same reason (`GET /player/manifest` would fail on it, and the push plan would read `changes` for ever): push v1 to v4 to every layout screen first. Rolling the migration back is not supported. Read from the code, not run: the earlier API keeps working on the migrated database only once no screen has a layout assigned (its display PATCH and its publish UPDATE do not clear `assigned_layout_id`, so the three-column CHECK would refuse them with 23514) and no screen's desired publication is v5; the push of v1 to v4 above gives both.

### Slice 4: as built (2026-11-18)

Built as specified above, except for the rows below. Checked at integration on 2026-11-18, with nothing committed: `npm run typecheck`, `npm run lint`, `npm test` (80 files, 1751 tests after the review fixes), `npm run format:check`, `npm run test:component` (2 files, 7 tests), `npm run test:integration` (30 files, 359 tests, the `_test` database rebuilt from 0001 to 0011), `npm run build` and `npm run scan:secrets` all pass.

**Not verified yet:** real hardware (several zones with video or a ticker on a Pi-class player); the hairline at a shared zone edge at a fractional scale; a screen-reader pass of the layout editor.

**Verified in the browser.** The full end-to-end suite passes (131 tests, run before and again after the review fixes), including 12-layouts-portal and 13-layouts-player (PL-04: a main zone and a Ticker band on landscape, portrait, a turned screen and a strip with a content rectangle), the layouts pages in 11-accessibility in light and dark, and 09 and 10 with their slice 4 changes.

| Topic | Spec | As built, and why |
|---|---|---|
| Fake-route refusal test (section 8, delivery) | fake-route.ts gains one case | fake-route.ts holds no tests and is unchanged. The case is in delivery.test.ts: a layout is refused on the test-only route (path `layout`) and accepted on the browser route. |
| `manifestPlaylists` for v5 (section 3) | An explicit v5 branch | One shared branch for v4 and v5 that reads the runs from `schedule.playlists` or `zones`; same result, no second copy of the loop. |
| `SchedulePlanInput.planPlaylist` doc (section 4) | The doc comment moves to `PlanPlaylist` | It moved; the field keeps one line, "Called once per distinct playlist", because that rule belongs to the schedule only. |
| Domain test helpers (section 8, domain) | `route(maxItems, maxRegions)` and `planLayout` | Also `bandZones` and a shared `planPlaylistOf`; `planLayout` defaults to `route(200, ABSOLUTE.maxLayoutZones)`. |
| Message numbers (section 3) | Literals "10000" and "16 px" | Built from `LAYOUT_UNITS` and `ABSOLUTE.minCanvasSidePx`; the text is the same and the tests pin it. |
| DB test extras (section 8, db) | The listed cases | Also position -1 and 3, a repeated position (23505), `updated_at` on a layout update, a hard delete of a zone's playlist, and a zone updated to a deleted playlist. The migration-0005 test is renamed "through 0006 to 0011". |
| `ZoneSet.adopt` after the session stops (section 6) | No rule | Once the session signal is aborted, `adopt` treats the manifest as null: a read that was in flight at revocation cannot start a zone after `stopAll`. Unit-tested. |
| `DomStage.place` for a removed zone (section 6) | Not listed | Does nothing: an aborted zone whose item was being prepared cannot bring its box back. |
| Layout passes in `DomStage` (section 6) | A secondary zone moves only its own box | Every `place` runs one pass over the canvas and every showing box; since the canvas follows zone 0 once zone 0 has placed a view, the result is the same with one code path. |
| Ticker and wrap checks in 13-layouts-player (section 6) | Font is min(0.6·h, 0.25·w) of the band box; wrap with reduced motion | The formula is applied to the renderer's measured box (the band less its 4 % padding), and the root is checked to fill the band. The wrap is checked once, on the portrait screen. |
| Error summary entries (section 7) | "Enter a name.", … | Each entry carries its field label ("Name: Enter a name.", "Band: Choose a playlist.", "Layout: …" for a form message), as the schedule and app editors do. |
| Extra exports of lib/layouts.ts (section 7) | The listed names | Also `bandPercentValue`, `draftZones` (the preview's zones, null while the band height is invalid), `withoutLayoutError` and `layoutSearchTexts` (one source for the list filter and the picker search). |
| `LibraryPickerDialog` props (section 7) | Today's props plus five | `LibraryPickerProps<T>` is the one props type; the two wrappers alias it and supply their defaults. It is not exported from shared/index.ts. |
| Band height text (section 7) | A whole number from 5 to 50 | Read with the Stepper's own parser, so " 15 " and "15.0" count as 15. |
| Screens for "Preview on" (section 7) | The editor page loads the screens | `LayoutPreview` loads them itself, as AppEditor does, so a failed screens list leaves only Landscape and Portrait and never stops the editor opening. |
| `DeleteFailureText.inUse` (section 7) | `bySchedule` becomes `refusedBy` | As specified; the existing `inUse` boolean stays (always `refusedBy !== null`). |
| Zone fieldset markup (section 7) | One fieldset per zone | The inset background is on a wrapping div, as ScheduleEventRow does, so the legend does not sit across the fieldset's own background. |
| "Open" links (section 7) | "Open layout" beside the playlist and schedule links | One link built from `assignedContent` or `planRowContent` and `contentHref` ("Open {kind}", test id `screen-detail-open-{kind}`); the playlist and schedule texts, ids and links are unchanged. |
| Extra tests (section 8, portal and e2e) | The listed cases | A ScreensList component case for the "kept" toast with a layout, a `screensToAssign` case for a layout screen, and in 12-layouts-portal a final case that deletes the unassigned layout from its editor. |
| Files owned by no package (section 10) | Not listed | tests/e2e/10-schedules-player.spec.ts:194 expects build `player-web/0.5.0`; the comments at apps/player-web/src/styles.css:42 (now ui/stage.ts) and apps/portal/src/features/push/push.css:222 (layout names). |

**Review round (2026-11-18).** Five lenses (security, contracts/domain/API, player, portal and accessibility, spec conformance), each finding checked by a second reviewer told to refute it. No Critical or High finding. Fixed:

| Severity | Finding | Fix |
|---|---|---|
| Medium | Right after a new publication is activated, garbage collection kept only what each band zone had on screen. Until the main zone adopted the publication (up to one video), a band kept picking items of the old publication whose files were gone, and reported `storage_error` for each. | `ZoneSet.inUse()` also returns every media item of the adopted views of zones 1 and up (core/zones.ts). Unit-tested. |
| Low | The canvas kept the previous publication's size and rotation while only a band was showing (a main zone with nothing available now, after a rotation or canvas change). | `DomStage.place`: a secondary zone sets the canvas whenever zone 0 shows nothing, not only before zone 0's first item (ui/stage.ts). |
| Low | A removed zone's presenter that was still preparing an item could release or place the box of a new zone with the same number. | `DomPresenter` sets `#removed` in `remove()` and never touches the stage after it (ui/presenter.ts). |
| Low | A layout DELETE that waited for a concurrent PUT wrote the zone count from before the PUT into its audit event. | The DELETE locks the row first, then deletes the zones itself and records that row count (routes/layouts.ts). |
| Low | The preview drew a cropped slice of a zone's label when the zone was only a few pixels tall in the frame. | The label is hidden in a box under 16 px (a container query in layouts.css); the outline and the frame's description stay. |
| Low | apps/portal/src/ui/README.md had no Layouts notes, and its Content card note described two kinds of content. | Both written. |

Recorded, not changed: the `layout.create` and `layout.update` audit detail names the main zone's playlist and the zone count only, as the spec asks and as schedules do (add `playlistIds` if the trail must show every zone's playlist); in forced-colours mode the focused error summary has no focus ring, a pattern shared with the app and schedule editors; 0011 holds its locks until commit (documented above). `DomStage` and `DomPresenter` have no unit test (the unit project has no DOM); 13-layouts-player is their check.
