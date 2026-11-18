/**
 * Upload quarantine and the exchange with the isolated validation worker (D11).
 *
 *   <jobs>/inbox/<id>.part   bytes being received by the API
 *   <jobs>/inbox/<id>        complete bytes, waiting for the worker
 *   <jobs>/inbox/<id>.json   job specification (limits); written last, atomically
 *   <jobs>/outbox/<id>.json  the worker's verdict
 *   <jobs>/outbox/<id>.thumb.jpg  an image's JPEG thumbnail, written before the verdict
 *
 * The job id is the media id. The database is the source of truth: a media row
 * in status "processing" is a pending job. `tick()` lists those rows (through
 * sec.media_processing_jobs, because no organisation is known yet), ingests
 * finished verdicts and fails jobs that are malformed, stuck or timed out.
 * Because nothing is kept only in memory, a restart of the API or the worker
 * loses no job.
 *
 * The worker is untrusted. It can write anything into the shared directory, so:
 *   - a verdict is size-capped, opened without following links, and re-validated;
 *   - the bytes are copied into private storage by the API, which recomputes the
 *     size and SHA-256 and compares them with the values recorded at upload;
 *   - accepted metadata is checked against the configured limits again;
 *   - a thumbnail is size-capped, opened without following links, must belong to the
 *     verdict's owner and look like a JPEG; it is never decoded here, and any problem
 *     with it only leaves the media without a thumbnail.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, createWriteStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  MEDIA_KIND_BY_MIME,
  MediaJobResultSchema,
  SUPPORTED_VIDEO_CODECS,
  type Limits,
  type MediaErrorCode,
  type MediaJobResult,
  type MediaJobSpec,
} from '@tinnox/contracts';
import { auditScoped, CommitOutcomeUnknownError, poolAsTx, withOrg, type Pool } from '@tinnox/db';
import { newObjectKey, type ObjectStorage } from '@tinnox/storage';
import { SNIFF_BYTES, sniffMediaType } from './sniff.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_RESULT_BYTES = 16 * 1024;
const MAX_THUMB_BYTES = 524_288;
const TICK_INTERVAL_MS = 750;
/** A processing row with no job file for this long is re-queued or failed. */
const ENQUEUE_GRACE_MS = 30_000;
/**
 * A file in the exchange directories that belongs to no pending job and no upload in
 * progress is removed once it is this old (the gap between receiving and queueing an
 * upload is far shorter). Swept at start-up and by the hourly housekeeping.
 */
const ORPHAN_GRACE_MS = 2 * 60 * 1000;
/** An upload still marked "in progress" after this long is treated as abandoned. */
const IN_FLIGHT_MAX_MS = 60 * 60 * 1000;
/** Pending jobs looked at by one scan, oldest first. */
const SCAN_BATCH = 500;
/** sec.media_processing_jobs never returns more rows than this (migration 0003). */
const PENDING_LIST_CAP = 5000;
/** Name of the file the worker touches to show it is running (informational only). */
export const WORKER_ALIVE_FILE = '.worker-alive';

export interface PipelineLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ReceivedUpload {
  readonly jobId: string;
  readonly bytes: number;
  readonly sha256: string;
  /** First bytes of the content, for the API's magic-byte check. */
  readonly head: Buffer;
  /** True when the source hit the byte limit and was cut off; nothing is kept in that case. */
  readonly truncated: boolean;
}

export interface MediaPipelineOptions {
  readonly jobsDir: string;
  readonly pool: Pool;
  readonly storage: ObjectStorage;
  readonly limits: Limits;
  readonly logger: PipelineLogger;
  readonly now?: () => Date;
  /** Extra time allowed per queued job on top of the inspection timeout. */
  readonly perJobGraceMs?: number;
  readonly baseGraceMs?: number;
}

interface PendingJob {
  readonly mediaId: string;
  readonly orgId: string;
  readonly createdAt: Date;
}

type ResultRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed'; readonly reason: string }
  | { readonly kind: 'ok'; readonly result: MediaJobResult; readonly uid: number };

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile();
  } catch (error) {
    if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
    throw error;
  }
}

/** Worker-supplied text is shown to operators: keep printable ASCII only and bound the length. */
function cleanDetail(text: string | null): string | null {
  if (text === null) return null;
  const cleaned = text
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? null : cleaned.slice(0, 300);
}

export class MediaPipeline {
  readonly #inbox: string;
  readonly #outbox: string;
  readonly #pool: Pool;
  readonly #storage: ObjectStorage;
  readonly #limits: Limits;
  readonly #log: PipelineLogger;
  readonly #now: () => Date;
  readonly #perJobGraceMs: number;
  readonly #baseGraceMs: number;
  readonly #busy = new Set<string>();
  /** Uploads received or being received by this process and not yet queued or discarded. */
  readonly #inFlight = new Map<string, number>();
  #startedAt = new Date(0);
  #timer: NodeJS.Timeout | null = null;
  #ticking: Promise<void> | null = null;
  #stopped = true;

  constructor(options: MediaPipelineOptions) {
    this.#inbox = join(options.jobsDir, 'inbox');
    this.#outbox = join(options.jobsDir, 'outbox');
    this.#pool = options.pool;
    this.#storage = options.storage;
    this.#limits = options.limits;
    this.#log = options.logger;
    this.#now = options.now ?? (() => new Date());
    this.#perJobGraceMs = options.perJobGraceMs ?? 5_000;
    this.#baseGraceMs = options.baseGraceMs ?? 10_000;
  }

  #path(dir: string, jobId: string, suffix = ''): string {
    if (!UUID.test(jobId)) throw new Error('job id is not a lower-case UUID');
    return join(dir, `${jobId}${suffix}`);
  }

  /** Creates the exchange directories. The worker (another uid) reads inbox and writes outbox. */
  async prepare(): Promise<void> {
    await mkdir(this.#inbox, { recursive: true, mode: 0o755 });
    await mkdir(this.#outbox, { recursive: true, mode: 0o1777 });
    // mkdir's mode is reduced by the umask; set the intended modes explicitly.
    await chmod(this.#inbox, 0o755);
    await chmod(this.#outbox, 0o1777);
    this.#startedAt = this.#now();
  }

  /** Starts the periodic scan. Pending jobs from before a restart are picked up by the first tick. */
  async start(): Promise<void> {
    await this.prepare();
    this.#stopped = false;
    await this.sweep().catch((error: unknown) => {
      this.#log.warn({ err: error }, 'could not clean the media job directories');
      return 0;
    });
    const loop = (): void => {
      if (this.#stopped) return;
      this.#timer = setTimeout(() => {
        void this.tick()
          .catch((error: unknown) => this.#log.error({ err: error }, 'media job scan failed'))
          .finally(loop);
      }, TICK_INTERVAL_MS);
      this.#timer.unref();
    };
    loop();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#ticking !== null) await this.#ticking.catch(() => undefined);
  }

  /**
   * Streams an upload into the quarantine area, counting and hashing as it goes.
   * `source` must stop at the byte limit and expose `truncated` (the multipart
   * parser does); a truncated or failed upload leaves nothing behind.
   */
  async receive(
    source: Readable & { truncated?: boolean },
    maxBytes: number,
  ): Promise<ReceivedUpload> {
    const jobId = randomUUID();
    const partPath = this.#path(this.#inbox, jobId, '.part');
    this.#inFlight.set(jobId, this.#now().getTime());
    const hash = createHash('sha256');
    const headChunks: Buffer[] = [];
    let headLength = 0;
    let bytes = 0;
    let overflow = false;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          // Second line of defence behind the parser's own limit.
          overflow = true;
          callback(new Error('upload exceeds the byte limit'));
          return;
        }
        hash.update(chunk);
        if (headLength < SNIFF_BYTES) {
          const piece = chunk.subarray(0, SNIFF_BYTES - headLength);
          headChunks.push(piece);
          headLength += piece.length;
        }
        callback(null, chunk);
      },
    });
    // The multipart parser emits "limit" the moment the file exceeds the byte limit.
    // Stop at once instead of reading (and discarding) the rest of the part.
    source.once('limit', () => {
      overflow = true;
      meter.destroy(new Error('upload exceeds the byte limit'));
    });
    try {
      await pipeline(source, meter, createWriteStream(partPath, { flags: 'wx', mode: 0o644 }));
    } catch (error) {
      await removeIfPresent(partPath).catch(() => undefined);
      this.#inFlight.delete(jobId);
      if (overflow) {
        source.resume();
        return { jobId, bytes, sha256: '', head: Buffer.alloc(0), truncated: true };
      }
      throw error;
    }
    if (source.truncated === true) {
      await removeIfPresent(partPath);
      this.#inFlight.delete(jobId);
      return { jobId, bytes, sha256: '', head: Buffer.alloc(0), truncated: true };
    }
    return {
      jobId,
      bytes,
      sha256: hash.digest('hex'),
      head: Buffer.concat(headChunks),
      truncated: false,
    };
  }

  /** Drops a received upload that will not be queued. */
  async discard(jobId: string): Promise<void> {
    try {
      await removeIfPresent(this.#path(this.#inbox, jobId, '.part'));
    } finally {
      this.#inFlight.delete(jobId);
    }
  }

  /** Hands a received upload to the worker. Call after the media row is committed. */
  async enqueue(jobId: string): Promise<void> {
    const bytesPath = this.#path(this.#inbox, jobId);
    const partPath = this.#path(this.#inbox, jobId, '.part');
    if (await exists(partPath)) await rename(partPath, bytesPath);
    await chmod(bytesPath, 0o644);
    const spec: MediaJobSpec = {
      schemaVersion: 1,
      jobId,
      limits: {
        maxBytes: this.#limits.maxUploadBytes,
        maxImageSidePx: this.#limits.maxImageSidePx,
        maxImagePixels: this.#limits.maxImagePixels,
        maxVideoWidthPx: this.#limits.maxVideoWidthPx,
        maxVideoHeightPx: this.#limits.maxVideoHeightPx,
        maxVideoDurationMs: this.#limits.maxVideoDurationMs,
        timeoutMs: this.#limits.mediaInspectionTimeoutMs,
      },
    };
    const specPath = this.#path(this.#inbox, jobId, '.json');
    const tempPath = `${specPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(spec), { mode: 0o644, flag: 'w' });
    // writeFile's mode is reduced by the umask; the worker (another uid) must be able to read it.
    await chmod(tempPath, 0o644);
    await rename(tempPath, specPath);
    this.#inFlight.delete(jobId);
  }

  /** Milliseconds since the worker last showed it is running, or null when it never has. */
  async workerLastSeenMs(): Promise<number | null> {
    try {
      const info = await lstat(join(this.#outbox, WORKER_ALIVE_FILE));
      return Math.max(0, this.#now().getTime() - info.mtimeMs);
    } catch {
      return null;
    }
  }

  /** Verifies the exchange directories are usable (for /readyz). */
  async check(): Promise<void> {
    const probe = join(this.#inbox, `.probe-${randomUUID()}`);
    await writeFile(probe, '', { flag: 'wx', mode: 0o600 });
    await unlink(probe);
    const info = await lstat(this.#outbox);
    if (!info.isDirectory()) throw new Error('outbox is not a directory');
  }

  /** One scan over all pending jobs. Serialised: a second call waits for the first. */
  async tick(): Promise<void> {
    if (this.#ticking !== null) {
      await this.#ticking;
      return;
    }
    this.#ticking = this.#scan().finally(() => {
      this.#ticking = null;
    });
    await this.#ticking;
  }

  /** The oldest `limit` jobs still waiting for validation, in every organisation. */
  async #pending(limit: number): Promise<PendingJob[]> {
    const { rows } = await poolAsTx(this.#pool).query<{
      media_id: string;
      org_id: string;
      created_at: Date;
    }>('SELECT media_id, org_id, created_at FROM sec.media_processing_jobs($1)', [limit]);
    return rows.map((r) => ({ mediaId: r.media_id, orgId: r.org_id, createdAt: r.created_at }));
  }

  async #scan(): Promise<void> {
    const jobs = await this.#pending(SCAN_BATCH);
    const now = this.#now().getTime();
    const perJob = this.#limits.mediaInspectionTimeoutMs + this.#perJobGraceMs;
    for (const [index, job] of jobs.entries()) {
      if (this.#busy.has(job.mediaId)) continue;
      this.#busy.add(job.mediaId);
      try {
        const read = await this.#readResult(job.mediaId);
        if (read.kind === 'ok') {
          await this.#ingest(job, read.result, read.uid);
          continue;
        }
        if (read.kind === 'malformed') {
          this.#log.warn({ mediaId: job.mediaId, reason: read.reason }, 'malformed worker result');
          await this.#fail(job, 'inspection_failed', 'The validation result could not be read.');
          continue;
        }
        const age = now - job.createdAt.getTime();
        if (
          age > ENQUEUE_GRACE_MS &&
          !(await exists(this.#path(this.#inbox, job.mediaId, '.json')))
        ) {
          // The API stopped between committing the row and queueing the job.
          const havePart = await exists(this.#path(this.#inbox, job.mediaId, '.part'));
          const haveBytes = await exists(this.#path(this.#inbox, job.mediaId));
          if (havePart || haveBytes) {
            await this.enqueue(job.mediaId);
            this.#log.info({ mediaId: job.mediaId }, 're-queued media job after restart');
          } else {
            await this.#fail(
              job,
              'inspection_failed',
              'The uploaded bytes were lost before validation. Upload the file again.',
            );
          }
          continue;
        }
        // Jobs are inspected one at a time, oldest first, so each job is allowed the
        // inspection timeout once for itself and once for every job ahead of it. The
        // clock starts at API start-up for jobs that predate it.
        const waitingSince = Math.max(job.createdAt.getTime(), this.#startedAt.getTime());
        const deadline = waitingSince + (index + 1) * perJob + this.#baseGraceMs;
        if (now > deadline) {
          await this.#fail(
            job,
            'inspection_timeout',
            'Validation did not finish in time. Check that the media worker is running, then upload the file again.',
          );
        }
      } catch (error) {
        this.#log.error({ err: error, mediaId: job.mediaId }, 'media job handling failed');
      } finally {
        this.#busy.delete(job.mediaId);
      }
    }
  }

  async #readResult(jobId: string): Promise<ResultRead> {
    const path = this.#path(this.#outbox, jobId, '.json');
    let handle;
    try {
      // O_NONBLOCK: a planted FIFO opens at once and is refused below, instead of blocking.
      handle = await open(
        path,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
      );
    } catch (error) {
      if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return { kind: 'missing' };
      }
      return { kind: 'malformed', reason: 'result could not be opened as a regular file' };
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) return { kind: 'malformed', reason: 'result is not a regular file' };
      if (info.size === 0 || info.size > MAX_RESULT_BYTES) {
        return { kind: 'malformed', reason: 'result size is out of bounds' };
      }
      const buffer = Buffer.alloc(info.size);
      const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
      let json: unknown;
      try {
        json = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      } catch {
        return { kind: 'malformed', reason: 'result is not JSON' };
      }
      const parsed = MediaJobResultSchema.safeParse(json);
      if (!parsed.success) return { kind: 'malformed', reason: 'result does not match the schema' };
      if (parsed.data.jobId !== jobId) {
        return { kind: 'malformed', reason: 'result names another job' };
      }
      return { kind: 'ok', result: parsed.data, uid: info.uid };
    } finally {
      await handle.close();
    }
  }

  /** Re-checks an "accepted" verdict against the configured limits. Returns a rejection or null. */
  #distrust(
    result: Extract<MediaJobResult, { outcome: 'accepted' }>,
    sniffed: string | null,
  ): { code: MediaErrorCode; detail: string } | null {
    const limits = this.#limits;
    if (MEDIA_KIND_BY_MIME[result.mimeType] !== result.kind) {
      return { code: 'inspection_failed', detail: 'The validation result is inconsistent.' };
    }
    if (sniffed !== null && sniffed !== result.mimeType) {
      return { code: 'type_mismatch', detail: 'The content type changed during validation.' };
    }
    if (result.kind === 'image') {
      if (result.durationMs !== null || result.codec !== null) {
        return { code: 'inspection_failed', detail: 'The validation result is inconsistent.' };
      }
      if (
        result.width > limits.maxImageSidePx ||
        result.height > limits.maxImageSidePx ||
        result.width * result.height > limits.maxImagePixels
      ) {
        return { code: 'image_too_large', detail: `${result.width}x${result.height} pixels` };
      }
      return null;
    }
    if (
      result.codec === null ||
      !(SUPPORTED_VIDEO_CODECS as readonly string[]).includes(result.codec)
    ) {
      return { code: 'unsupported_codec', detail: `codec ${result.codec ?? 'unknown'}` };
    }
    if (result.durationMs === null) {
      return { code: 'inspection_failed', detail: 'The video duration is unknown.' };
    }
    if (result.durationMs > limits.maxVideoDurationMs) {
      return { code: 'video_too_long', detail: `${Math.round(result.durationMs / 1000)} s` };
    }
    if (result.width > limits.maxVideoWidthPx || result.height > limits.maxVideoHeightPx) {
      return {
        code: 'video_resolution_too_large',
        detail: `${result.width}x${result.height} pixels`,
      };
    }
    return null;
  }

  /**
   * The worker's thumbnail for an image, or null. Any problem is logged and leaves the
   * media without a thumbnail; it never fails the media.
   */
  async #readThumbnail(jobId: string, verdictUid: number): Promise<Buffer | null> {
    const path = this.#path(this.#outbox, jobId, '.thumb.jpg');
    let handle;
    try {
      // O_NONBLOCK: a planted FIFO opens at once and is refused below, instead of blocking.
      handle = await open(
        path,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
      );
    } catch (error) {
      const reason =
        isNodeError(error) && error.code === 'ENOENT'
          ? 'thumbnail is missing'
          : 'thumbnail could not be opened as a regular file';
      this.#log.warn({ mediaId: jobId, reason }, 'thumbnail ignored');
      return null;
    }
    try {
      const info = await handle.stat();
      let reason: string;
      if (!info.isFile()) reason = 'thumbnail is not a regular file';
      // A thumbnail must come from the verdict's writer. That stops a local process from adding
      // one to the worker's verdict, not one that forged the verdict too (threat model T1).
      else if (info.uid !== verdictUid) reason = 'thumbnail owner differs from the verdict owner';
      else if (info.size < 1 || info.size > MAX_THUMB_BYTES)
        reason = 'thumbnail size is out of bounds';
      else {
        const buffer = Buffer.alloc(info.size);
        const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
        const bytes = buffer.subarray(0, bytesRead);
        if (bytesRead > 0 && sniffMediaType(bytes.subarray(0, SNIFF_BYTES)) === 'image/jpeg') {
          return bytes;
        }
        reason = 'thumbnail is not a JPEG';
      }
      this.#log.warn({ mediaId: jobId, reason }, 'thumbnail ignored');
      return null;
    } finally {
      await handle.close();
    }
  }

  async #ingest(job: PendingJob, result: MediaJobResult, verdictUid: number): Promise<void> {
    if (result.outcome === 'rejected') {
      await this.#fail(job, result.errorCode, cleanDetail(result.errorDetail));
      return;
    }
    const row = await withOrg(this.#pool, job.orgId, async (tx) => {
      const { rows } = await tx.query<{
        status: string;
        bytes: string | null;
        sha256: string | null;
        mime_type: string | null;
      }>(
        'SELECT status, bytes, sha256, mime_type FROM media WHERE id = $1 AND org_id = app_org_id()',
        [job.mediaId],
      );
      return rows[0] ?? null;
    });
    if (row === null || row.status !== 'processing') {
      await this.#cleanup(job.mediaId);
      return;
    }
    const problem = this.#distrust(result, row.mime_type);
    if (problem !== null) {
      await this.#fail(job, problem.code, problem.detail);
      return;
    }
    const expectedBytes = Number(row.bytes);
    if (row.sha256 === null || !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
      await this.#fail(job, 'inspection_failed', 'The upload record is incomplete.');
      return;
    }

    // Copy into private storage. Size and SHA-256 are computed here, by the API, and must
    // equal what was recorded while the upload was received: the worker could have
    // changed the quarantined file.
    const key = newObjectKey(job.orgId);
    let stored;
    try {
      stored = await this.#storage.putFile(key, this.#path(this.#inbox, job.mediaId), {
        maxBytes: expectedBytes,
      });
    } catch (error) {
      this.#log.error({ err: error, mediaId: job.mediaId }, 'could not store validated media');
      await this.#fail(
        job,
        'inspection_failed',
        'The file could not be stored after validation. Upload it again.',
      );
      return;
    }
    if (stored.bytes !== expectedBytes || stored.sha256 !== row.sha256) {
      await this.#storage.delete(key).catch(() => undefined);
      this.#log.error({ mediaId: job.mediaId }, 'quarantined bytes changed during validation');
      await this.#fail(
        job,
        'inspection_failed',
        'The file changed during validation and was discarded. Upload it again.',
      );
      return;
    }

    // shortcut: thumbnail content is worker-trusted and not tied to the source bytes; a compromised worker can inject or copy up to 512 KiB of image bytes between organisations. Upgrade by running a per-job worker that sees only one job's files.
    let thumbKey: string | null = null;
    const thumb =
      result.kind === 'image' ? await this.#readThumbnail(job.mediaId, verdictUid) : null;
    if (thumb !== null) {
      const candidate = newObjectKey(job.orgId);
      try {
        await this.#storage.put(candidate, thumb, { maxBytes: MAX_THUMB_BYTES });
        thumbKey = candidate;
      } catch (error) {
        this.#log.warn({ err: error, mediaId: job.mediaId }, 'could not store thumbnail');
      }
    }

    // The stored copies are removed unless the ready row that references them committed,
    // or may have: when COMMIT did not confirm, deleting could leave a ready row without
    // its bytes. At worst an unreferenced object stays (review round 3, SCX-03).
    let keep = false;
    try {
      keep = await withOrg(this.#pool, job.orgId, async (tx) => {
        const done = await tx.query(
          `UPDATE media
           SET status = 'ready', kind = $2, mime_type = $3, bytes = $4, sha256 = $5,
               width = $6, height = $7, duration_ms = $8, codec = $9, storage_key = $10,
               thumb_storage_key = $11, error_code = NULL, error_detail = NULL
           WHERE id = $1 AND org_id = app_org_id() AND status = 'processing'`,
          [
            job.mediaId,
            result.kind,
            result.mimeType,
            stored.bytes,
            stored.sha256,
            result.width,
            result.height,
            result.durationMs,
            result.codec,
            key,
            thumbKey,
          ],
        );
        if (done.rowCount !== 1) return false;
        await auditScoped(tx, {
          actorType: 'system',
          actorId: null,
          action: 'media.validate',
          objectType: 'media',
          objectId: job.mediaId,
          result: 'success',
          detail: {
            mimeType: result.mimeType,
            bytes: stored.bytes,
            width: result.width,
            height: result.height,
            durationMs: result.durationMs,
            codec: result.codec,
          },
        });
        return true;
      });
    } catch (error) {
      keep = error instanceof CommitOutcomeUnknownError;
      throw error;
    } finally {
      if (!keep) {
        await this.#storage.delete(key).catch(() => undefined);
        if (thumbKey !== null) await this.#storage.delete(thumbKey).catch(() => undefined);
      }
    }
    await this.#cleanup(job.mediaId);
  }

  async #fail(job: PendingJob, code: MediaErrorCode, detail: string | null): Promise<void> {
    await withOrg(this.#pool, job.orgId, async (tx) => {
      const done = await tx.query(
        `UPDATE media SET status = 'failed', error_code = $2, error_detail = $3
         WHERE id = $1 AND org_id = app_org_id() AND status = 'processing'`,
        [job.mediaId, code, detail],
      );
      if (done.rowCount !== 1) return;
      await auditScoped(tx, {
        actorType: 'system',
        actorId: null,
        action: 'media.validate',
        objectType: 'media',
        objectId: job.mediaId,
        result: 'failure',
        detail: { errorCode: code },
      });
    });
    await this.#cleanup(job.mediaId);
  }

  async #cleanup(jobId: string): Promise<void> {
    const paths = [
      this.#path(this.#inbox, jobId, '.json'),
      this.#path(this.#inbox, jobId, '.json.tmp'),
      this.#path(this.#inbox, jobId),
      this.#path(this.#inbox, jobId, '.part'),
      this.#path(this.#outbox, jobId, '.json'),
      this.#path(this.#outbox, jobId, '.started'),
      this.#path(this.#outbox, jobId, '.thumb.jpg'),
      this.#path(this.#outbox, jobId, '.thumb.tmp'),
    ];
    for (const path of paths) {
      // `rm` rather than `unlink`: a misbehaving worker may have left a directory or a
      // link under one of these names. A link is removed, never followed.
      await rm(path, { force: true, recursive: true }).catch((error: unknown) => {
        this.#log.warn({ err: error }, 'could not remove a media job file');
      });
    }
  }

  /**
   * Removes leftovers that belong to no pending job and no upload in progress
   * (interrupted uploads after a crash, files of finished jobs). Returns the count.
   *
   * A file is removed only when the complete list of pending jobs shows it has no owner.
   * When the list may be cut off (as many pending jobs as one lookup returns), nothing
   * is removed and the sweep waits for the backlog to drain (review round 3, SCX-02).
   */
  async sweep(): Promise<number> {
    const now = this.#now().getTime();
    for (const [jobId, since] of this.#inFlight) {
      if (now - since > IN_FLIGHT_MAX_MS) this.#inFlight.delete(jobId);
    }
    // Noted before the pending jobs are read. An upload that is committed and queued while
    // this sweep runs is in neither the pending list (read too early) nor #inFlight (cleared
    // by then), and its bytes may be older than the grace period: without this note the
    // sweep would remove them. An upload that starts later has files newer than the cutoff.
    const inFlightAtStart = new Set(this.#inFlight.keys());
    const jobs = await this.#pending(PENDING_LIST_CAP);
    if (jobs.length >= PENDING_LIST_CAP) {
      this.#log.warn(
        { pending: jobs.length },
        'media job sweep skipped: too many pending jobs to tell which files are orphaned',
      );
      return 0;
    }
    const pending = new Set(jobs.map((job) => job.mediaId));
    const cutoff = now - ORPHAN_GRACE_MS;
    let removed = 0;
    for (const dir of [this.#inbox, this.#outbox]) {
      for (const name of await readdir(dir)) {
        const id = name.slice(0, 36);
        if (!UUID.test(id) || pending.has(id)) continue;
        if (inFlightAtStart.has(id) || this.#inFlight.has(id)) continue;
        const path = join(dir, name);
        try {
          const info = await lstat(path);
          if (info.mtimeMs >= cutoff) continue;
          // `rm`: a misbehaving worker may have left a directory or a link; never followed.
          await rm(path, { force: true, recursive: true });
          removed += 1;
        } catch (error) {
          if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
        }
      }
    }
    return removed;
  }
}
