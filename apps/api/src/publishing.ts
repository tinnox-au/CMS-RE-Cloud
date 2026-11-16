/**
 * Publishing, shared by `POST /api/playlists/:id/publish`, the push plan
 * (`GET /api/push`), `POST /api/push` and the dashboard numbers.
 *
 * There is one way to build a publication: load the display, the playlist's
 * items and their media and apps, run `planPublication` against the display's delivery
 * route, and hand the resulting draft to `createPublication`. Deciding whether
 * a display has changes waiting (portal v2 decision P2-05: assign, then push)
 * runs the same plan and compares its draft with the manifest of the display's
 * current publication, so "what a push would do" and "what a push does" cannot
 * drift apart.
 */
import { randomUUID } from 'node:crypto';
import {
  AppContentSchema,
  HEADERS,
  IdempotencyKeySchema,
  ManifestSchema,
  MediaMimeTypeSchema,
  type FitMode,
  type Manifest,
  type PlaylistRef,
  type PushIssue,
  type PushState,
  type Rotation,
  type Transition,
  type WorkingHours,
  isMediaItem,
} from '@tinnox/contracts';
import { auditScoped, type Tx } from '@tinnox/db';
import {
  buildManifest,
  decidePushState,
  isAppDraftItem,
  planPublication,
  type AppRecord,
  type DraftItem,
  type MediaRecord,
  type PlanPublicationResult,
  type PublicationDraft,
  type PublishIssue,
} from '@tinnox/domain';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from './context.ts';
import { bigintToNumber } from './db-helpers.ts';
import { HttpError, parseInput } from './errors.ts';
import { contentRectOf } from './routes/displays.ts';
import { MEDIA_WINDOW_COLUMNS } from './routes/media.ts';

/** The columns of `display` that planning a publication needs. */
export interface DisplayPlanRow {
  id: string;
  name: string;
  canvas_width: number;
  canvas_height: number;
  content_x: number | null;
  content_y: number | null;
  content_width: number | null;
  content_height: number | null;
  default_fit: FitMode;
  route: 'browser';
  assigned_playlist_id: string | null;
  rotation: Rotation;
  working_hours: WorkingHours | null;
  site_timezone: string;
}

/** Select list for `display d` that yields a `DisplayPlanRow`. */
export const DISPLAY_PLAN_COLUMNS = `d.id, d.name, d.canvas_width, d.canvas_height,
  d.content_x, d.content_y, d.content_width, d.content_height,
  d.default_fit, d.route, d.assigned_playlist_id, d.rotation, d.working_hours,
  (SELECT s.timezone FROM site s WHERE s.id = d.site_id AND s.org_id = d.org_id) AS site_timezone`;

export interface PublicationRow {
  id: string;
  display_id: string;
  playlist_id: string;
  manifest: unknown;
  created_at: Date;
}

const PUBLICATION_COLUMNS = 'id, display_id, playlist_id, manifest, created_at';

/** A live playlist as publishing sees it: its items in play order. */
export interface PlaylistDraft {
  readonly id: string;
  readonly name: string;
  readonly transition: Transition;
  readonly shuffle: boolean;
  readonly items: readonly DraftItem[];
}

/** The publication a display was last given (`display_delivery.desired_publication_id`). */
export interface CurrentPublication {
  readonly publicationId: string;
  readonly createdAt: Date;
}

/** A current publication with its stored document, while the two are being compared. */
interface LoadedPublication extends CurrentPublication {
  /** Null when it was not loaded, or when the stored document no longer parses. */
  readonly manifest: Manifest | null;
}

/** Where one display stands between its assigned playlist and its current publication. */
export interface DisplayAssessment {
  readonly display: DisplayPlanRow;
  /** The assigned playlist; null exactly when `state` is `nothing_assigned`. */
  readonly playlist: PlaylistRef | null;
  readonly state: PushState;
  /**
   * What a push would publish now, for `never_pushed`, `changes` and `up_to_date`.
   * Always null when the caller did not ask to keep drafts (`keepDraft`).
   */
  readonly draft: PublicationDraft | null;
  /**
   * Why the playlist cannot be published. Non-empty exactly when `state` is `blocked`.
   * Complete when the caller keeps drafts; otherwise the first `MAX_ISSUE_DETAILS`.
   */
  readonly issues: readonly PublishIssue[];
  readonly current: CurrentPublication | null;
}

/** How many issues an answer carries for one playlist; the same ceiling as `error.details`. */
export const MAX_ISSUE_DETAILS = 100;

/**
 * Displays whose current manifests are in memory at the same time while many
 * displays are assessed. A manifest may be 1 MiB; without this bound the push
 * plan of an organisation with thousands of displays would hold all of them at once.
 */
export const MANIFEST_BATCH_SIZE = 100;

/**
 * Publish issues in the shape of `error.details` of a `publication_rejected`
 * answer and of `PushIssue`: `path` is `playlist` or `items[n]`.
 */
export function issueDetails(issues: readonly PublishIssue[]): PushIssue[] {
  return issues.slice(0, MAX_ISSUE_DETAILS).map((issue) => ({
    path: issue.index === null ? 'playlist' : `items[${issue.index}]`,
    message: issue.message.slice(0, 500),
    code: issue.code,
  }));
}

/** The 422 answer for a playlist that cannot be published. */
export function publicationRejected(issues: readonly PublishIssue[]): HttpError {
  const first = issues[0];
  return new HttpError(
    422,
    'publication_rejected',
    issues.length === 1 && first !== undefined
      ? first.message
      : `The playlist cannot be published: ${issues.length} problems were found.`,
    { details: issueDetails(issues) },
  );
}

/** Reads and validates the `Idempotency-Key` header; `action` completes "is required to ...". */
export function idempotencyKeyOf(request: FastifyRequest, action: string): string {
  const raw = request.headers[HEADERS.idempotencyKey];
  if (typeof raw !== 'string') {
    throw new HttpError(400, 'bad_request', `The Idempotency-Key header is required to ${action}.`);
  }
  return parseInput(IdempotencyKeySchema, raw, 'Idempotency-Key header');
}

/**
 * Serialises every attempt to publish to one display under one Idempotency-Key
 * until the transaction ends, so exactly one of them creates the publication.
 */
export async function lockPublishKey(tx: Tx, displayId: string, key: string): Promise<void> {
  await tx.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('tinnox.publish:' || $1 || ':' || $2, 0))",
    [displayId.toLowerCase(), key],
  );
}

/** The publication already made for this display under this key, if any. */
export async function findPublicationByKey(
  tx: Tx,
  displayId: string,
  key: string,
): Promise<PublicationRow | null> {
  const { rows } = await tx.query<PublicationRow>(
    `SELECT ${PUBLICATION_COLUMNS} FROM publication
     WHERE org_id = app_org_id() AND display_id = $1 AND idempotency_key = $2`,
    [displayId, key],
  );
  return rows[0] ?? null;
}

/**
 * Loads a display for publishing and holds it until commit: two publications to
 * one display are made one after the other, and the canvas cannot change under
 * the plan. `FOR NO KEY UPDATE` is what a later UPDATE of the row needs, so
 * recording the assignment never has to upgrade the lock, and it does not hold
 * up rows that merely reference the display (heartbeats, registrations).
 */
export async function lockDisplayForPublish(
  tx: Tx,
  displayId: string,
): Promise<DisplayPlanRow | null> {
  const { rows } = await tx.query<DisplayPlanRow>(
    `SELECT ${DISPLAY_PLAN_COLUMNS} FROM display d
     WHERE d.id = $1 AND d.org_id = app_org_id() FOR NO KEY UPDATE`,
    [displayId],
  );
  return rows[0] ?? null;
}

/**
 * Live (not deleted) playlists with their items, keyed by id. Two round trips
 * for any number of playlists. With `lock`, the playlists cannot be edited or
 * deleted until the transaction ends.
 */
export async function loadPlaylistDrafts(
  tx: Tx,
  playlistIds: readonly string[],
  lock: boolean,
): Promise<Map<string, PlaylistDraft>> {
  const drafts = new Map<string, PlaylistDraft>();
  const ids = [...new Set(playlistIds.map((id) => id.toLowerCase()))];
  if (ids.length === 0) return drafts;
  const playlists = await tx.query<{
    id: string;
    name: string;
    transition: Transition;
    shuffle: boolean;
  }>(
    `SELECT id, name, transition, shuffle FROM playlist
     WHERE org_id = app_org_id() AND deleted_at IS NULL AND id = ANY($1::uuid[])
     ${lock ? 'FOR SHARE' : ''}`,
    [ids],
  );
  const itemsByPlaylist = new Map<string, DraftItem[]>();
  for (const row of playlists.rows) itemsByPlaylist.set(row.id, []);
  const items = await tx.query<{
    playlist_id: string;
    media_id: string | null;
    app_id: string | null;
    duration_ms: number | null;
    fit: FitMode | null;
  }>(
    `SELECT playlist_id, media_id, app_id, duration_ms, fit FROM playlist_item
     WHERE org_id = app_org_id() AND playlist_id = ANY($1::uuid[])
     ORDER BY playlist_id, position`,
    [[...itemsByPlaylist.keys()]],
  );
  for (const row of items.rows) {
    // The database guarantees exactly one source, and a duration for an app (migration 0007).
    itemsByPlaylist
      .get(row.playlist_id)
      ?.push(
        row.app_id !== null
          ? { appId: row.app_id, durationMs: row.duration_ms ?? 0 }
          : { mediaId: row.media_id ?? '', durationMs: row.duration_ms, fit: row.fit },
      );
  }
  for (const row of playlists.rows) {
    drafts.set(row.id, {
      id: row.id,
      name: row.name,
      transition: row.transition,
      shuffle: row.shuffle,
      items: itemsByPlaylist.get(row.id) ?? [],
    });
  }
  return drafts;
}

interface MediaRecordRow {
  id: string;
  kind: 'image' | 'video';
  status: 'processing' | 'ready' | 'failed';
  mime_type: string | null;
  bytes: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  codec: string | null;
  available_from: string | null;
  available_until: string | null;
}

/**
 * The facts about media that the playlist and publishing rules need, keyed by
 * id. Deleted media is left out, so the rules report it as missing. With
 * `lock`, the rows cannot be deleted until the transaction ends.
 */
export async function loadMediaRecords(
  tx: Tx,
  ids: readonly string[],
  lock: boolean,
): Promise<Map<string, MediaRecord>> {
  const byId = new Map<string, MediaRecord>();
  if (ids.length === 0) return byId;
  const { rows } = await tx.query<MediaRecordRow>(
    `SELECT m.id, m.kind, m.status, m.mime_type, m.bytes, m.sha256, m.width, m.height,
            m.duration_ms, m.codec, ${MEDIA_WINDOW_COLUMNS}
     FROM media m
     WHERE m.org_id = app_org_id() AND m.deleted_at IS NULL AND m.id = ANY($1::uuid[])
     ${lock ? 'FOR KEY SHARE' : ''}`,
    [[...new Set(ids)]],
  );
  for (const row of rows) {
    const mime = MediaMimeTypeSchema.safeParse(row.mime_type);
    byId.set(row.id, {
      id: row.id,
      kind: row.kind,
      status: row.status,
      mimeType: mime.success ? mime.data : null,
      bytes: row.bytes === null ? null : bigintToNumber(row.bytes),
      sha256: row.sha256,
      width: row.width,
      height: row.height,
      durationMs: row.duration_ms,
      codec: row.codec,
      availableFrom: row.available_from,
      availableUntil: row.available_until,
    });
  }
  return byId;
}

/** The media ids and the app ids of draft items, each list for its loader. */
export function itemRefs(items: readonly DraftItem[]): { mediaIds: string[]; appIds: string[] } {
  const mediaIds: string[] = [];
  const appIds: string[] = [];
  for (const item of items) {
    if (isAppDraftItem(item)) appIds.push(item.appId);
    else mediaIds.push(item.mediaId);
  }
  return { mediaIds, appIds };
}

/**
 * The apps the playlist rules need, keyed by id. A row whose stored settings no
 * longer parse is left out, so it surfaces as `app_missing` on that playlist
 * rather than failing the whole push plan. With `lock`, the rows cannot be
 * deleted until the transaction ends.
 */
export async function loadAppRecords(
  tx: Tx,
  ids: readonly string[],
  lock: boolean,
): Promise<Map<string, AppRecord>> {
  const byId = new Map<string, AppRecord>();
  if (ids.length === 0) return byId;
  const { rows } = await tx.query<{ id: string; type: string; settings: unknown }>(
    `SELECT id, type, settings FROM app
     WHERE org_id = app_org_id() AND id = ANY($1::uuid[])
     ${lock ? 'FOR KEY SHARE' : ''}`,
    [[...new Set(ids)]],
  );
  for (const row of rows) {
    const content = AppContentSchema.safeParse({ type: row.type, settings: row.settings });
    if (content.success) byId.set(row.id, { id: row.id, content: content.data });
  }
  return byId;
}

/** The publishing rule (D12, D15): the domain rule plus the target route's capability profile. */
export function planDraft(
  ctx: AppContext,
  display: DisplayPlanRow,
  playlist: PlaylistDraft,
  mediaById: ReadonlyMap<string, MediaRecord>,
  appsById: ReadonlyMap<string, AppRecord>,
): PlanPublicationResult {
  return planPublication({
    display: {
      id: display.id,
      canvas: { width: display.canvas_width, height: display.canvas_height },
      contentRect: contentRectOf(display),
      defaultFit: display.default_fit,
      route: display.route,
      rotation: display.rotation,
      workingHours: display.working_hours,
      timeZone: display.site_timezone,
    },
    items: playlist.items,
    mediaById,
    appsById,
    limits: ctx.config.limits,
    playback: { transition: playlist.transition, shuffle: playlist.shuffle },
    route: ctx.delivery.get(display.route),
  });
}

/**
 * The current publication of each display that has one, keyed by display id.
 * The manifest (up to 1 MiB each) is fetched only for `manifestFor`.
 */
async function loadCurrentPublications(
  tx: Tx,
  displayIds: readonly string[],
  manifestFor: readonly string[],
): Promise<Map<string, LoadedPublication>> {
  const current = new Map<string, LoadedPublication>();
  if (displayIds.length === 0) return current;
  const { rows } = await tx.query<{
    display_id: string;
    id: string;
    created_at: Date;
    manifest: unknown;
  }>(
    `SELECT dd.display_id, p.id, p.created_at,
            CASE WHEN dd.display_id = ANY($2::uuid[]) THEN p.manifest END AS manifest
     FROM display_delivery dd
     JOIN publication p
       ON p.id = dd.desired_publication_id AND p.org_id = dd.org_id
      AND p.display_id = dd.display_id
     WHERE dd.org_id = app_org_id() AND dd.display_id = ANY($1::uuid[])`,
    [displayIds, manifestFor],
  );
  for (const row of rows) {
    const manifest = ManifestSchema.safeParse(row.manifest);
    current.set(row.display_id, {
      publicationId: row.id,
      createdAt: row.created_at,
      manifest: manifest.success ? manifest.data : null,
    });
  }
  return current;
}

/**
 * Decides, for each display, what a push would do now: nothing is assigned, the
 * assigned playlist cannot be published (blocked), the display has no
 * publication yet, the publication that would be built differs from the current
 * one, or equals it. Two round trips for the playlists, one for their media and
 * one for their apps, whatever the number of displays, then one for every `MANIFEST_BATCH_SIZE`
 * displays to compare with what they were last given.
 *
 * - `lock` (inside a push): the playlist and its media are held until the
 *   transaction ends, as publishing holds them.
 * - `keepDraft` (inside a push): the answer carries the draft to publish and
 *   every issue. Without it (the push plan) neither a draft nor a manifest
 *   outlives its comparison, so memory does not grow with displays times items.
 */
export async function assessDisplays(
  tx: Tx,
  ctx: AppContext,
  displays: readonly DisplayPlanRow[],
  options: { readonly lock: boolean; readonly keepDraft: boolean },
): Promise<DisplayAssessment[]> {
  const drafts = await loadPlaylistDrafts(
    tx,
    displays.flatMap((d) => (d.assigned_playlist_id === null ? [] : [d.assigned_playlist_id])),
    options.lock,
  );
  const draftOf = (display: DisplayPlanRow): PlaylistDraft | undefined =>
    display.assigned_playlist_id === null ? undefined : drafts.get(display.assigned_playlist_id);
  const refs = itemRefs([...drafts.values()].flatMap((draft) => draft.items));
  const mediaById = await loadMediaRecords(tx, refs.mediaIds, options.lock);
  const appsById = await loadAppRecords(tx, refs.appIds, options.lock);

  const assess = (display: DisplayPlanRow, loaded: LoadedPublication | null): DisplayAssessment => {
    const playlist = draftOf(display);
    const current =
      loaded === null ? null : { publicationId: loaded.publicationId, createdAt: loaded.createdAt };
    if (playlist === undefined) {
      return {
        display,
        playlist: null,
        state: 'nothing_assigned',
        draft: null,
        issues: [],
        current,
      };
    }
    const plan = planDraft(ctx, display, playlist, mediaById, appsById);
    const decided = decidePushState({ plan, currentManifest: loaded?.manifest ?? null });
    // A stored manifest that no longer parses cannot be compared with anything;
    // the display has a publication, and a push would replace it.
    const state = decided === 'never_pushed' && loaded !== null ? 'changes' : decided;
    return {
      display,
      playlist: { id: playlist.id, name: playlist.name },
      state,
      draft: plan.ok && options.keepDraft ? plan.draft : null,
      issues: plan.ok
        ? []
        : options.keepDraft
          ? plan.issues
          : plan.issues.slice(0, MAX_ISSUE_DETAILS),
      current,
    };
  };

  const assessments: DisplayAssessment[] = [];
  for (let start = 0; start < displays.length; start += MANIFEST_BATCH_SIZE) {
    const batch = displays.slice(start, start + MANIFEST_BATCH_SIZE);
    const loaded = await loadCurrentPublications(
      tx,
      batch.map((d) => d.id),
      batch.filter((d) => draftOf(d) !== undefined).map((d) => d.id),
    );
    for (const display of batch) assessments.push(assess(display, loaded.get(display.id) ?? null));
  }
  return assessments;
}

export interface NewPublication {
  readonly display: DisplayPlanRow;
  readonly playlistId: string;
  /** The accepted plan (`planDraft(...).draft`). */
  readonly draft: PublicationDraft;
  readonly idempotencyKey: string;
  readonly membershipId: string;
  /** Which route asked: recorded in the audit event. */
  readonly via: 'publish' | 'push';
}

/**
 * Creates the immutable publication for an accepted plan and makes it the
 * display's desired one, with its audit event, in the caller's transaction.
 * The caller holds the publish key lock and the display (see above).
 */
export async function createPublication(
  tx: Tx,
  ctx: AppContext,
  input: NewPublication,
): Promise<PublicationRow> {
  const { display, playlistId } = input;
  const publicationId = randomUUID();
  const createdAt = ctx.now();
  const manifest = buildManifest(input.draft, { publicationId, createdAt });
  // The browser route is pull-based: preparing has no side effect. A later
  // push route would hand `prepared` to its target after the commit.
  ctx.delivery.get(display.route).prepare(manifest);

  const inserted = await tx.query<PublicationRow>(
    `INSERT INTO publication (id, org_id, display_id, playlist_id, manifest, idempotency_key, created_by, created_at)
     VALUES ($1, app_org_id(), $2, $3, $4::jsonb, $5, $6, $7)
     RETURNING ${PUBLICATION_COLUMNS}`,
    [
      publicationId,
      display.id,
      playlistId,
      JSON.stringify(manifest),
      input.idempotencyKey,
      input.membershipId,
      createdAt,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('publication insert returned no row');
  // Media positions only: an app item has no file (the 0004 guard checks each row's assetId).
  const media = manifest.assets.flatMap((asset, i) =>
    isMediaItem(asset) ? [{ position: i, mediaId: asset.assetId }] : [],
  );
  await tx.query(
    `INSERT INTO publication_asset (publication_id, position, org_id, media_id)
     SELECT $1, t.position, app_org_id(), t.media_id
     FROM unnest($2::int[], $3::uuid[]) AS t(position, media_id)`,
    [publicationId, media.map((m) => m.position), media.map((m) => m.mediaId)],
  );
  await tx.query(
    `INSERT INTO display_delivery (display_id, org_id, desired_publication_id, desired_at)
     VALUES ($1, app_org_id(), $2, $3)
     ON CONFLICT (display_id) DO UPDATE
       SET desired_publication_id = EXCLUDED.desired_publication_id,
           desired_at = EXCLUDED.desired_at`,
    [display.id, publicationId, createdAt],
  );
  await auditScoped(tx, {
    actorType: 'operator',
    actorId: input.membershipId,
    action: 'publication.create',
    objectType: 'publication',
    objectId: publicationId,
    result: 'success',
    detail: {
      displayId: display.id,
      playlistId,
      items: manifest.assets.length,
      route: display.route,
      via: input.via,
    },
  });
  return row;
}

/** Records that a playlist was refused for a display. Commits with the caller's transaction. */
export async function auditRejectedPublication(
  tx: Tx,
  input: {
    readonly membershipId: string;
    readonly playlistId: string;
    readonly displayId: string;
    readonly issues: readonly PublishIssue[];
    readonly via: 'publish' | 'push';
  },
): Promise<void> {
  await auditScoped(tx, {
    actorType: 'operator',
    actorId: input.membershipId,
    action: 'publication.create',
    objectType: 'playlist',
    objectId: input.playlistId,
    result: 'failure',
    detail: {
      displayId: input.displayId,
      reasons: [...new Set(input.issues.map((issue) => issue.code))].slice(0, 20),
      via: input.via,
    },
  });
}
