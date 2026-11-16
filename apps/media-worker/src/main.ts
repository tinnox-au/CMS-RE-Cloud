/**
 * Media validation worker (prototype-m0.md D11).
 *
 * Runs in a container with no network, a read-only root filesystem, a non-root
 * user and no secrets. Its whole interface is one directory:
 *
 *   <jobs>/inbox/<jobId>        bytes to inspect           (written by the API)
 *   <jobs>/inbox/<jobId>.json   limits for this job        (written by the API, last)
 *   <jobs>/outbox/<jobId>.json  verdict                    (written here, atomically)
 *   <jobs>/outbox/<jobId>.started  marker: inspection began (crash detection)
 *   <jobs>/outbox/.worker-alive    touched while the loop runs
 *
 * The worker never deletes inbox files and never trusts its own earlier state:
 * a job with a "started" marker but no verdict means a previous run died while
 * inspecting it. That may be the file's fault (a decoder that exhausts memory) or
 * not (a restart or deploy), so the job is tried once more; a file that kills the
 * worker twice is rejected instead of being tried again in a loop (attempts.ts).
 */
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readdir, rename, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { MediaJobSpecSchema, type MediaJobResult } from '@tinnox/contracts';
import { decideAttempt } from './attempts.ts';
import { inspectFile, type Inspection } from './inspect.ts';

const JOB_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const MAX_SPEC_BYTES = 16 * 1024;
const MAX_MARKER_BYTES = 16;
const POLL_INTERVAL_MS = 500;
const ALIVE_INTERVAL_MS = 5_000;
/** Ceiling on a job's own timeout, whatever the job file says. */
const MAX_TIMEOUT_MS = 120_000;

const jobsDir = process.env['MEDIA_JOBS_DIR'] ?? '/jobs';
const inbox = join(jobsDir, 'inbox');
const outbox = join(jobsDir, 'outbox');

function log(event: string, fields: Record<string, unknown> = {}): void {
  // One JSON object per line. Never file contents; there are no file names to leak.
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

/** Temp file plus rename: the API sees either no verdict or a complete one. */
async function writeResult(result: MediaJobResult): Promise<void> {
  const finalPath = join(outbox, `${result.jobId}.json`);
  const tempPath = join(outbox, `.${result.jobId}.tmp`);
  await writeFile(tempPath, JSON.stringify(result), { mode: 0o644, flag: 'w' });
  await rename(tempPath, finalPath);
}

/** Best effort: a missing thumbnail never fails the media; the API serves the original. */
async function writeThumbnail(jobId: string, thumbnail: Buffer): Promise<boolean> {
  const tempPath = join(outbox, `${jobId}.thumb.tmp`);
  try {
    await writeFile(tempPath, thumbnail, { mode: 0o644, flag: 'w' });
    await rename(tempPath, join(outbox, `${jobId}.thumb.jpg`));
    return true;
  } catch (error) {
    log('thumbnail_write_failed', {
      jobId,
      error: error instanceof Error ? error.name : 'unknown',
    });
    return false;
  }
}

function toResult(jobId: string, inspection: Inspection): MediaJobResult {
  if (inspection.outcome === 'accepted') {
    return {
      schemaVersion: 1,
      jobId,
      outcome: 'accepted',
      kind: inspection.kind,
      mimeType: inspection.mimeType,
      width: inspection.width,
      height: inspection.height,
      durationMs: inspection.durationMs,
      codec: inspection.codec,
    };
  }
  return {
    schemaVersion: 1,
    jobId,
    outcome: 'rejected',
    errorCode: inspection.errorCode,
    errorDetail: inspection.errorDetail === null ? null : inspection.errorDetail.slice(0, 500),
  };
}

async function readSpec(jobId: string): Promise<ReturnType<typeof MediaJobSpecSchema.safeParse>> {
  const handle = await open(
    join(inbox, `${jobId}.json`),
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size === 0 || info.size > MAX_SPEC_BYTES) {
      return MediaJobSpecSchema.safeParse(null);
    }
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
    let json: unknown = null;
    try {
      json = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    } catch {
      json = null;
    }
    return MediaJobSpecSchema.safeParse(json);
  } finally {
    await handle.close();
  }
}

/** Content of the crash marker, or null when there is none. Never follows a link. */
async function readMarker(path: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return 'unreadable';
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_MARKER_BYTES) return 'unreadable';
    const buffer = Buffer.alloc(MAX_MARKER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_MARKER_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function processJob(jobId: string): Promise<void> {
  const started = Date.now();
  const marker = join(outbox, `${jobId}.started`);

  const decision = decideAttempt(await readMarker(marker));
  if (decision.action === 'reject') {
    await writeResult(
      toResult(jobId, {
        outcome: 'rejected',
        errorCode: 'inspection_failed',
        errorDetail: 'Inspection stopped unexpectedly twice and was not repeated.',
      }),
    );
    log('job_rejected', {
      jobId,
      errorCode: 'inspection_failed',
      reason: 'previous_attempts_died',
    });
    return;
  }
  if (decision.attempt > 1) log('job_retry', { jobId, attempt: decision.attempt });

  let spec;
  try {
    spec = await readSpec(jobId);
  } catch {
    spec = MediaJobSpecSchema.safeParse(null);
  }
  if (!spec.success || spec.data.jobId !== jobId) {
    await writeResult(
      toResult(jobId, {
        outcome: 'rejected',
        errorCode: 'inspection_failed',
        errorDetail: 'The job description is not valid.',
      }),
    );
    log('job_rejected', { jobId, errorCode: 'inspection_failed', reason: 'bad_spec' });
    return;
  }
  const limits = spec.data.limits;
  const timeoutMs = Math.min(limits.timeoutMs, MAX_TIMEOUT_MS);

  await writeFile(marker, String(decision.attempt), { mode: 0o644, flag: 'w' });

  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  let outcome: Inspection | 'timeout';
  try {
    outcome = await Promise.race([inspectFile(join(inbox, jobId), limits, timeoutMs), timedOut]);
  } catch (error) {
    log('inspection_error', { jobId, error: error instanceof Error ? error.name : 'unknown' });
    outcome = { outcome: 'rejected', errorCode: 'inspection_failed', errorDetail: null };
  } finally {
    clearTimeout(timer);
  }

  if (outcome === 'timeout') {
    await writeResult(
      toResult(jobId, { outcome: 'rejected', errorCode: 'inspection_timeout', errorDetail: null }),
    );
    log('job_rejected', { jobId, errorCode: 'inspection_timeout', ms: Date.now() - started });
    // An image decode cannot be cancelled from JavaScript. Exit so the stuck work
    // is gone; the container's restart policy starts a fresh worker.
    process.exit(3);
  }

  // The thumbnail lands before the verdict, so the API finds it when it reads the verdict.
  const thumbBytes =
    outcome.outcome === 'accepted' &&
    outcome.thumbnail !== null &&
    (await writeThumbnail(jobId, outcome.thumbnail))
      ? outcome.thumbnail.length
      : 0;
  await writeResult(toResult(jobId, outcome));
  if (outcome.outcome === 'accepted') {
    log('job_accepted', {
      jobId,
      kind: outcome.kind,
      mimeType: outcome.mimeType,
      width: outcome.width,
      height: outcome.height,
      durationMs: outcome.durationMs,
      codec: outcome.codec,
      hasAudio: outcome.hasAudio,
      thumbBytes,
      ms: Date.now() - started,
    });
  } else {
    log('job_rejected', { jobId, errorCode: outcome.errorCode, ms: Date.now() - started });
  }
}

async function pendingJobs(done: Set<string>): Promise<string[]> {
  const names = await readdir(inbox);
  const present = new Set<string>();
  const candidates: { jobId: string; mtimeMs: number }[] = [];
  for (const name of names) {
    const jobId = JOB_FILE.exec(name)?.[1];
    if (jobId === undefined) continue;
    present.add(jobId);
    if (done.has(jobId)) continue;
    if (await isFile(join(outbox, `${jobId}.json`))) {
      done.add(jobId);
      continue;
    }
    try {
      candidates.push({ jobId, mtimeMs: (await lstat(join(inbox, name))).mtimeMs });
    } catch {
      /* removed meanwhile */
    }
  }
  // Forget jobs the API has cleaned up, so the set stays small.
  for (const jobId of done) if (!present.has(jobId)) done.delete(jobId);
  // Oldest first: the API's timeout accounting assumes queue order.
  return candidates.sort((a, b) => a.mtimeMs - b.mtimeMs).map((c) => c.jobId);
}

async function touchAlive(): Promise<void> {
  const path = join(outbox, '.worker-alive');
  const now = new Date();
  try {
    await utimes(path, now, now);
  } catch {
    await writeFile(path, '', { mode: 0o644, flag: 'w' });
  }
}

async function main(): Promise<void> {
  let stopping = false;
  const stop = (): void => {
    stopping = true;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  log('worker_started', { node: process.version });
  const done = new Set<string>();
  let lastAlive = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastAlive >= ALIVE_INTERVAL_MS) {
        await touchAlive();
        lastAlive = Date.now();
      }
      for (const jobId of await pendingJobs(done)) {
        if (stopping) break;
        await processJob(jobId);
        done.add(jobId);
      }
    } catch (error) {
      // For example the exchange directory does not exist yet. Keep running.
      log('loop_error', {
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
      await sleep(2_000);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  log('worker_stopped');
}

void main().catch((error: unknown) => {
  log('worker_crashed', {
    error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
  });
  process.exit(1);
});
