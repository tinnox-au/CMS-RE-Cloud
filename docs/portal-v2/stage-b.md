# Portal v2, stage B: build spec

Date: 2026-11-16. Stage B is built in slices. Slice 1 is specified below; later slices (built-in apps, layouts, schedules) get their own sections when they start. Read `README.md` in this folder first. The build follows the "ponytail" rule: the least new code that fully solves the task; every known limit is marked in code with a `shortcut:` comment.

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
