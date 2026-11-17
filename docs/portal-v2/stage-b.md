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
