import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { MediaJobResult } from '@tinnox/contracts';
import { withOrg } from '@tinnox/db';
import { LocalObjectStorage } from '@tinnox/storage';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaPipeline } from '../src/media/pipeline.ts';
import {
  actAsWorker,
  createDisplay,
  createOrg,
  listDir,
  losingCommitAnswers,
  pairPlayer,
  pngBytes,
  publishImages,
  readyImage,
  signIn,
  settleStrayMediaJobs,
  startTestApp,
  uploadBytes,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

interface Media {
  id: string;
  status: string;
  errorCode: string | null;
  bytes: number | null;
  sha256: string | null;
  originalName: string;
  mimeType: string | null;
  width: number | null;
}

const UPLOAD_LIMIT = 64 * 1024;
const QUOTA = 200 * 1024;

describe('upload limits and validation results', () => {
  let t: TestApp;
  let org: TestOrg;
  let operator: Operator;

  beforeAll(async () => {
    t = await startTestApp({
      LIMIT_MAX_UPLOAD_BYTES: String(UPLOAD_LIMIT),
      LIMIT_MAX_ORG_STORAGE_BYTES: String(QUOTA),
      LIMIT_MEDIA_INSPECTION_TIMEOUT_MS: '2000',
    });
    org = await createOrg('Upload A');
    operator = await signIn(t, org);
    // The timeout test below measures when a job is given up. That depends on how many
    // jobs are ahead of it in the one queue of the database, so rows left in
    // "processing" by a file that ran just before this one are cleared first.
    await settleStrayMediaJobs(t.pool);
  });
  afterAll(async () => {
    await t.close();
  });

  const get = async (id: string): Promise<Media> =>
    (await (await operator.fetch(`/api/media/${id}`)).json()) as Media;
  const mediaCount = async (o: TestOrg = org): Promise<number> =>
    withOrg(t.pool, o.orgId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>('SELECT count(*) AS n FROM media');
      return Number(rows[0]?.n ?? 0);
    });
  const accepted = (id: string): Extract<MediaJobResult, { outcome: 'accepted' }> => ({
    schemaVersion: 1,
    jobId: id,
    outcome: 'accepted',
    kind: 'image',
    mimeType: 'image/png',
    width: 32,
    height: 16,
    durationMs: null,
    codec: null,
  });
  async function uploadPng(): Promise<{ media: Media; bytes: Buffer }> {
    const bytes = await pngBytes();
    const response = await uploadBytes(operator, bytes);
    expect(response.status).toBe(201);
    return { media: ((await response.json()) as { media: Media }).media, bytes };
  }
  /** PNG signature followed by filler: passes the API's magic-byte check, any size. */
  function fakePng(size: number): Buffer {
    const buffer = Buffer.alloc(size, 0x20);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
    return buffer;
  }

  it('cuts an oversized upload off while receiving and leaves nothing behind', async () => {
    const before = await mediaCount();

    // 1. Declared size above the limit: refused before the body is read.
    const declared = await uploadBytes(operator, fakePng(4 * 1024 * 1024));
    expect(declared.status).toBe(413);
    expect(((await declared.json()) as { error: { code: string } }).error.code).toBe(
      'payload_too_large',
    );

    // 2. No declared size (chunked body): the limit is enforced on the bytes as they arrive.
    const boundary = '----tinnoxtest';
    const head = Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="big.png"\r\ncontent-type: image/png\r\n\r\n`,
    );
    let sent = 0;
    const chunk = fakePng(16 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(head);
      },
      pull(controller) {
        // Would send 8 MiB if the server kept reading.
        if (sent >= 8 * 1024 * 1024) {
          controller.enqueue(Buffer.from(`\r\n--${boundary}--\r\n`));
          controller.close();
          return;
        }
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const streamed = await fetch(`${t.url}/api/media`, {
      method: 'POST',
      headers: {
        cookie: operator.cookie,
        origin: 'http://localhost:5173',
        'x-csrf-token': operator.csrfToken,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      duplex: 'half',
    });
    expect(streamed.status).toBe(413);
    expect(((await streamed.json()) as { error: { code: string } }).error.code).toBe(
      'payload_too_large',
    );
    expect(streamed.headers.get('connection')).toBe('close');

    // 3. One byte over the limit, with a truthful length.
    const justOver = await uploadBytes(operator, fakePng(UPLOAD_LIMIT + 1));
    expect(justOver.status).toBe(413);

    // Nothing was kept: no quarantine file, no stored object, no media row.
    expect(await listDir(join(t.jobsDir, 'inbox'))).toEqual([]);
    expect(await mediaCount()).toBe(before);

    // Exactly at the limit is accepted for validation.
    const atLimit = await uploadBytes(operator, fakePng(UPLOAD_LIMIT));
    expect(atLimit.status).toBe(201);
    const media = ((await atLimit.json()) as { media: Media }).media;
    expect(media).toMatchObject({ status: 'processing', bytes: UPLOAD_LIMIT });
    await actAsWorker(t, {
      schemaVersion: 1,
      jobId: media.id,
      outcome: 'rejected',
      errorCode: 'corrupt',
      errorDetail: null,
    });
    await t.ctx.media.tick();
    expect(await get(media.id)).toMatchObject({ status: 'failed', errorCode: 'corrupt' });
    expect(await listDir(join(t.jobsDir, 'inbox'))).toEqual([]);
    expect(await listDir(join(t.jobsDir, 'outbox'))).toEqual([]);
  });

  it('refuses content that is not JPEG, PNG or MP4 whatever it is called', async () => {
    const before = await mediaCount();
    const cases: [string, Buffer][] = [
      ['photo.jpg', Buffer.from('just text pretending to be a photo')],
      ['page.png', Buffer.from('<!doctype html><script>alert(1)</script>')],
      ['drawing.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      ['clip.mp4', Buffer.from('#!/bin/sh\necho no\n')],
      ['empty.png', Buffer.alloc(0)],
    ];
    for (const [name, bytes] of cases) {
      const response = await uploadBytes(operator, bytes, name);
      expect(response.status, name).toBe(bytes.length === 0 ? 400 : 415);
    }
    const notMultipart = await operator.fetch('/api/media', {
      method: 'POST',
      json: { file: 'x' },
    });
    expect(notMultipart.status).toBe(415);
    expect(await mediaCount()).toBe(before);
    expect(await listDir(join(t.jobsDir, 'inbox'))).toEqual([]);
  });

  it('never uses the uploaded file name as a path', async () => {
    const response = await uploadBytes(
      operator,
      await pngBytes(),
      '../../../../etc/cron.d/evil‮gnp.sh',
    );
    const { media } = (await response.json()) as { media: Media };
    expect(response.status).toBe(201);
    expect(media.originalName).toBe('evilgnp.sh');
    // The quarantine file is named by the server-generated id only.
    expect((await listDir(join(t.jobsDir, 'inbox'))).sort()).toEqual(
      [media.id, `${media.id}.json`].sort(),
    );
    await actAsWorker(t, accepted(media.id));
    await t.ctx.media.tick();
    const ready = await get(media.id);
    expect(ready.status).toBe('ready');
    const key = await withOrg(t.pool, org.orgId, async (tx) => {
      const { rows } = await tx.query<{ storage_key: string }>(
        'SELECT storage_key FROM media WHERE id = $1',
        [media.id],
      );
      return rows[0]?.storage_key ?? '';
    });
    expect(key).toMatch(new RegExp(`^${org.orgId}/[0-9a-f-]{36}$`));
  });

  it('stores accepted bytes with the size and SHA-256 computed by the API', async () => {
    const { media, bytes } = await uploadPng();
    expect(media).toMatchObject({
      status: 'processing',
      mimeType: 'image/png',
      bytes: bytes.length,
    });
    await actAsWorker(t, accepted(media.id));
    await t.ctx.media.tick();
    const ready = await get(media.id);
    expect(ready).toMatchObject({
      status: 'ready',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: 32,
    });
    const preview = await operator.fetch(`/api/media/${media.id}/preview`);
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(bytes);
  });

  it('hands a job to the worker in files it can read, whatever the process umask is', async () => {
    const previous = process.umask(0o077);
    let id: string;
    try {
      id = (await uploadPng()).media.id;
    } finally {
      process.umask(previous);
    }
    for (const name of [id, `${id}.json`]) {
      expect((await stat(join(t.jobsDir, 'inbox', name))).mode & 0o777, name).toBe(0o644);
    }
    await actAsWorker(t, accepted(id));
    await t.ctx.media.tick();
    expect(await get(id)).toMatchObject({ status: 'ready' });
  });

  it('serves an image thumbnail as JPEG, ignores a bad one and deletes both objects', async () => {
    const outbox = join(t.jobsDir, 'outbox');
    const storage = await LocalObjectStorage.create({ root: t.mediaRoot });
    const keysOf = async (id: string) =>
      withOrg(t.pool, org.orgId, async (tx) => {
        const { rows } = await tx.query<{
          storage_key: string | null;
          thumb_storage_key: string | null;
        }>('SELECT storage_key, thumb_storage_key FROM media WHERE id = $1', [id]);
        return rows[0];
      });
    const jpeg = await sharp(await pngBytes(8, 4))
      .jpeg()
      .toBuffer();
    const elsewhere = join(t.jobsDir, 'elsewhere.jpg');
    await writeFile(elsewhere, jpeg);

    const { media: good } = await uploadPng();
    await writeFile(join(outbox, `${good.id}.thumb.jpg`), jpeg);
    await actAsWorker(t, accepted(good.id));
    await t.ctx.media.tick();
    expect((await get(good.id)).status).toBe('ready');
    const thumb = await operator.fetch(`/api/media/${good.id}/thumbnail`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    expect(thumb.headers.get('cache-control')).toBe('private, max-age=300');
    expect(Buffer.from(await thumb.arrayBuffer())).toEqual(jpeg);
    const preview = await operator.fetch(`/api/media/${good.id}/preview`);
    expect(preview.headers.get('content-type')).toBe('image/png');
    expect(await listDir(outbox)).not.toContain(`${good.id}.thumb.jpg`);

    const bad: [string, (path: string) => Promise<void>][] = [
      ['not a JPEG', (path) => writeFile(path, Buffer.from('\x89PNG\r\n\x1a\nnot a jpeg'))],
      ['empty', (path) => writeFile(path, Buffer.alloc(0))],
      [
        'oversized',
        (path) => writeFile(path, Buffer.concat([jpeg.subarray(0, 3), Buffer.alloc(524_288)])),
      ],
      ['a symbolic link', (path) => symlink(elsewhere, path)],
      ['a directory', (path) => mkdir(path)],
      // A FIFO with no writer would block a blocking open, and with it the whole tick loop.
      [
        'a FIFO',
        (path) => {
          execFileSync('mkfifo', [path]);
          return Promise.resolve();
        },
      ],
    ];
    for (const [what, plant] of bad) {
      const { media, bytes } = await uploadPng();
      await plant(join(outbox, `${media.id}.thumb.jpg`));
      await actAsWorker(t, accepted(media.id));
      await t.ctx.media.tick();
      expect((await get(media.id)).status, what).toBe('ready');
      expect((await keysOf(media.id))?.thumb_storage_key, what).toBeNull();
      const fallback = await operator.fetch(`/api/media/${media.id}/thumbnail`);
      expect(fallback.headers.get('content-type'), what).toBe('image/png');
      expect(Buffer.from(await fallback.arrayBuffer()), what).toEqual(bytes);
      expect(await listDir(outbox), what).not.toContain(`${media.id}.thumb.jpg`);
    }

    // A video gets no thumbnail, even when one is lying in the outbox.
    const head = Buffer.from([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const upload = await uploadBytes(operator, Buffer.concat([head, Buffer.alloc(52)]), 'a.mp4');
    const video = ((await upload.json()) as { media: Media }).media;
    await writeFile(join(outbox, `${video.id}.thumb.jpg`), jpeg);
    await actAsWorker(t, {
      schemaVersion: 1,
      jobId: video.id,
      outcome: 'accepted',
      kind: 'video',
      mimeType: 'video/mp4',
      width: 1280,
      height: 720,
      durationMs: 8000,
      codec: 'h264',
    });
    await t.ctx.media.tick();
    expect((await get(video.id)).status).toBe('ready');
    expect((await keysOf(video.id))?.thumb_storage_key).toBeNull();
    const poster = await operator.fetch(`/api/media/${video.id}/thumbnail`);
    expect(poster.headers.get('content-type')).toBe('video/mp4');
    await poster.arrayBuffer();

    // Deleting the image removes the original and the thumbnail from storage.
    const keys = await keysOf(good.id);
    expect(keys?.thumb_storage_key).toMatch(new RegExp(`^${org.orgId}/[0-9a-f-]{36}$`));
    expect((await operator.fetch(`/api/media/${good.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await storage.stat(keys?.storage_key ?? '')).toBeNull();
    expect(await storage.stat(keys?.thumb_storage_key ?? '')).toBeNull();
    await operator.fetch(`/api/media/${video.id}`, { method: 'DELETE' });
  });

  it('fails media safely when the worker result is malformed, forged or inconsistent', async () => {
    const outbox = join(t.jobsDir, 'outbox');
    const cases: [string, (id: string) => Promise<void>, string][] = [
      ['not JSON', (id) => actAsWorker(t, '{"schemaVersion":1,', id), 'inspection_failed'],
      [
        'wrong shape',
        (id) => actAsWorker(t, JSON.stringify({ jobId: id, outcome: 'accepted' }), id),
        'inspection_failed',
      ],
      [
        'unknown field',
        (id) => actAsWorker(t, JSON.stringify({ ...accepted(id), storageKey: '../../x' }), id),
        'inspection_failed',
      ],
      [
        'names another job',
        (id) =>
          actAsWorker(t, JSON.stringify(accepted('00000000-0000-4000-8000-000000000000')), id),
        'inspection_failed',
      ],
      [
        'oversized',
        (id) => actAsWorker(t, JSON.stringify({ ...accepted(id), pad: 'x'.repeat(40_000) }), id),
        'inspection_failed',
      ],
      ['a directory', (id) => mkdir(join(outbox, `${id}.json`)), 'inspection_failed'],
      [
        'a symbolic link',
        (id) => symlink('/etc/hosts', join(outbox, `${id}.json`)),
        'inspection_failed',
      ],
      [
        'claims a different type than the bytes',
        (id) =>
          actAsWorker(t, {
            ...accepted(id),
            outcome: 'accepted',
            kind: 'image',
            mimeType: 'image/jpeg',
          } as never),
        'type_mismatch',
      ],
      [
        'kind and type disagree',
        (id) => actAsWorker(t, { ...accepted(id), kind: 'video' } as never),
        'inspection_failed',
      ],
      [
        'image above the pixel limits',
        (id) => actAsWorker(t, { ...accepted(id), width: 90_000, height: 90_000 }),
        'image_too_large',
      ],
    ];
    for (const [what, forge, expected] of cases) {
      const { media } = await uploadPng();
      await forge(media.id);
      await t.ctx.media.tick();
      const after = await get(media.id);
      expect(after, what).toMatchObject({ status: 'failed', errorCode: expected });
      expect((await operator.fetch(`/api/media/${media.id}/preview`)).status, what).toBe(409);
      await operator.fetch(`/api/media/${media.id}`, { method: 'DELETE' });
    }
    // The directory verdict cannot be unlinked as a file; everything else is cleaned up.
    expect((await listDir(join(t.jobsDir, 'inbox'))).length).toBe(0);
  });

  it('discards a file that was changed in quarantine after upload', async () => {
    const { media } = await uploadPng();
    // A compromised worker appends bytes, or swaps the file, then reports success.
    await appendFile(join(t.jobsDir, 'inbox', media.id), 'tampered');
    await actAsWorker(t, accepted(media.id));
    await t.ctx.media.tick();
    expect(await get(media.id)).toMatchObject({ status: 'failed', errorCode: 'inspection_failed' });

    const second = (await uploadPng()).media;
    await unlink(join(t.jobsDir, 'inbox', second.id));
    await symlink('/etc/hosts', join(t.jobsDir, 'inbox', second.id));
    await actAsWorker(t, accepted(second.id));
    await t.ctx.media.tick();
    expect(await get(second.id)).toMatchObject({
      status: 'failed',
      errorCode: 'inspection_failed',
    });
    // Nothing reached private storage for either file.
    const stored = await withOrg(t.pool, org.orgId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM media WHERE id = ANY($1::uuid[]) AND storage_key IS NOT NULL',
        [[media.id, second.id]],
      );
      return Number(rows[0]?.n ?? 0);
    });
    expect(stored).toBe(0);
  });

  it('sweeps orphaned quarantine files while running, not only at start-up after an hour', async () => {
    // Left behind by a crash mid-upload or mid-job: no media row and no upload in progress.
    const oldPart = join(t.jobsDir, 'inbox', `${randomUUID()}.part`);
    const oldVerdict = join(t.jobsDir, 'outbox', `${randomUUID()}.started`);
    const freshPart = join(t.jobsDir, 'inbox', `${randomUUID()}.part`);
    for (const path of [oldPart, oldVerdict, freshPart]) await writeFile(path, 'x');
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    await utimes(oldPart, fiveMinutesAgo, fiveMinutesAgo);
    await utimes(oldVerdict, fiveMinutesAgo, fiveMinutesAgo);
    // A real pending job is never touched, however old its files are.
    const { media } = await uploadPng();
    const pendingBytes = join(t.jobsDir, 'inbox', media.id);
    await utimes(pendingBytes, fiveMinutesAgo, fiveMinutesAgo);

    expect(await t.ctx.media.sweep()).toBe(2);
    const inbox = await listDir(join(t.jobsDir, 'inbox'));
    expect(inbox).toContain(media.id);
    expect(inbox).toContain(freshPart.slice(-41));
    expect(inbox).not.toContain(oldPart.slice(-41));
    expect(await listDir(join(t.jobsDir, 'outbox'))).not.toContain(oldVerdict.slice(-44));
    await unlink(freshPart);
    await actAsWorker(t, accepted(media.id));
    await t.ctx.media.tick();
    expect((await get(media.id)).status).toBe('ready');
  });

  it('never sweeps the files of a pending job, however long the queue is (round 3, SCX-02)', async () => {
    /** Adds rows waiting for validation, older than any upload of this test. */
    const queue = (count: number): Promise<void> =>
      withOrg(t.pool, org.orgId, async (tx) => {
        await tx.query(
          `INSERT INTO media (org_id, kind, status, original_name, created_at)
           SELECT app_org_id(), 'image', 'processing', 'queued', now() - interval '1 hour'
           FROM generate_series(1, $1::int)`,
          [count],
        );
      });
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const age = (path: string): Promise<void> => utimes(path, fiveMinutesAgo, fiveMinutesAgo);
    const inbox = join(t.jobsDir, 'inbox');
    try {
      // 500 jobs ahead of this one: more than one scan looks at.
      await queue(500);
      const { media } = await uploadPng();
      await age(join(inbox, media.id));
      await age(join(inbox, `${media.id}.json`));
      await t.ctx.media.sweep();
      expect(await listDir(inbox)).toEqual(expect.arrayContaining([media.id, `${media.id}.json`]));
      expect((await get(media.id)).status).toBe('processing');

      // As many pending jobs as one lookup returns: the list may be cut off, so the sweep
      // cannot tell an orphan from a pending job's file and removes nothing.
      await queue(4500);
      const orphan = join(inbox, `${randomUUID()}.part`);
      await writeFile(orphan, 'x');
      await age(orphan);
      expect(await t.ctx.media.sweep()).toBe(0);
      expect(await listDir(inbox)).toEqual(
        expect.arrayContaining([media.id, `${media.id}.json`, orphan.slice(-41)]),
      );
    } finally {
      // Fail the queued rows (and the upload), then let the sweep clear the old files.
      await settleStrayMediaJobs(t.pool);
      await t.ctx.media.sweep();
    }
    expect(await listDir(inbox)).toEqual([]);
  });

  it('keeps the bytes of an upload that is queued while the sweep runs', async () => {
    // A pool that runs `afterPendingRead` once, right after the sweep has read the pending
    // jobs: the moment an upload in progress can be committed and queued behind its back.
    let afterPendingRead: (() => Promise<void>) | null = null;
    const pool = new Proxy(t.pool, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        if (key !== 'query') {
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(target)
            : value;
        }
        return async (text: string, values?: unknown[]) => {
          const result = await target.query(text, values);
          if (text.includes('sec.media_processing_jobs') && afterPendingRead !== null) {
            const hook = afterPendingRead;
            afterPendingRead = null;
            await hook();
          }
          return result;
        };
      },
    });
    const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const pipeline = new MediaPipeline({
      jobsDir: t.jobsDir,
      pool,
      storage: await LocalObjectStorage.create({ root: t.mediaRoot }),
      limits: t.config.limits,
      logger: silent,
    });
    await pipeline.prepare();
    const inbox = join(t.jobsDir, 'inbox');
    const received = await pipeline.receive(Readable.from([await pngBytes()]), UPLOAD_LIMIT);
    try {
      // The last byte arrived five minutes ago: the upload has waited that long for its row.
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      await utimes(join(inbox, `${received.jobId}.part`), fiveMinutesAgo, fiveMinutesAgo);
      afterPendingRead = () => pipeline.enqueue(received.jobId);

      await pipeline.sweep();

      expect(afterPendingRead).toBeNull();
      expect(await listDir(inbox)).toEqual(
        expect.arrayContaining([received.jobId, `${received.jobId}.json`]),
      );
    } finally {
      // No media row was written for this job, so nothing else cleans up after it.
      for (const suffix of ['', '.json', '.part']) {
        await rm(join(inbox, `${received.jobId}${suffix}`), { force: true });
      }
    }
  });

  it('keeps validated media whose commit went through when the answer to COMMIT was lost (round 3, SCX-03)', async () => {
    const { media } = await uploadPng();
    await actAsWorker(t, accepted(media.id));
    const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const pipeline = new MediaPipeline({
      jobsDir: t.jobsDir,
      pool: losingCommitAnswers(t.pool, /SET status = 'ready'/),
      storage: await LocalObjectStorage.create({ root: t.mediaRoot }),
      limits: t.config.limits,
      logger: silent,
    });
    await pipeline.prepare();
    await pipeline.tick();

    // Read through a connection that did not lose anything: the row is ready...
    const row = await withOrg(t.pool, org.orgId, async (tx) => {
      const { rows } = await tx.query<{ status: string; storage_key: string | null }>(
        'SELECT status, storage_key FROM media WHERE id = $1',
        [media.id],
      );
      return rows[0];
    });
    expect(row?.status).toBe('ready');
    // ...and the object it names was kept, so the media can still be shown.
    const storage = await LocalObjectStorage.create({ root: t.mediaRoot });
    expect(await storage.stat(row?.storage_key ?? 'missing')).not.toBeNull();
    expect((await operator.fetch(`/api/media/${media.id}/preview`)).status).toBe(200);

    // The job's files stay behind (the row is ready, so no scan cleans them up); the sweep
    // removes them once they are old enough.
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    for (const dir of ['inbox', 'outbox']) {
      for (const name of await listDir(join(t.jobsDir, dir))) {
        if (name.startsWith(media.id)) {
          await utimes(join(t.jobsDir, dir, name), fiveMinutesAgo, fiveMinutesAgo);
        }
      }
    }
    expect(await t.ctx.media.sweep()).toBeGreaterThan(0);
    expect(await listDir(join(t.jobsDir, 'inbox'))).toEqual([]);
  });

  it('keeps the bytes of an upload whose row was committed when the answer to COMMIT was lost (round 3, SCX-03)', async () => {
    const lossy = await startTestApp(
      {
        LIMIT_MAX_UPLOAD_BYTES: String(UPLOAD_LIMIT),
        LIMIT_MAX_ORG_STORAGE_BYTES: String(QUOTA),
      },
      1000,
      { wrapPool: (pool) => losingCommitAnswers(pool, /INSERT INTO media AS m/) },
    );
    try {
      const owner = await signIn(lossy, org);
      const bytes = await pngBytes();
      expect((await uploadBytes(owner, bytes)).status).toBe(500);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const row = await withOrg(t.pool, org.orgId, async (tx) => {
        const { rows } = await tx.query<{ id: string; status: string }>(
          // Newest first: an earlier upload of this file may have drawn the same colour.
          'SELECT id, status FROM media WHERE sha256 = $1 ORDER BY created_at DESC LIMIT 1',
          [sha256],
        );
        return rows[0];
      });
      if (row === undefined) throw new Error('the upload row was not committed');
      expect(row.status).toBe('processing');
      // The received bytes were kept for the committed row...
      const inbox = join(lossy.jobsDir, 'inbox');
      expect(await listDir(inbox)).toContain(`${row.id}.part`);
      // ...so the scan queues them once the queueing grace has passed, and validation finishes.
      lossy.advanceClock(31_000);
      await lossy.ctx.media.tick();
      expect(await listDir(inbox)).toContain(`${row.id}.json`);
      await actAsWorker(lossy, accepted(row.id));
      await lossy.ctx.media.tick();
      const ready = await withOrg(t.pool, org.orgId, async (tx) => {
        const { rows } = await tx.query<{ status: string }>(
          'SELECT status FROM media WHERE id = $1',
          [row.id],
        );
        return rows[0]?.status;
      });
      expect(ready).toBe('ready');
    } finally {
      await lossy.close();
    }
  });

  it('times a job out when the worker never answers, and survives an API restart', async () => {
    // "Restart": a second pipeline over the same directories and database, as a new API process would create.
    const { media: beforeRestart } = await uploadPng();
    const storage = await LocalObjectStorage.create({ root: t.mediaRoot });
    const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
    let offset = 0;
    const restarted = new MediaPipeline({
      jobsDir: t.jobsDir,
      pool: t.pool,
      storage,
      limits: t.config.limits,
      logger: silent,
      now: () => new Date(Date.now() + offset),
    });
    await restarted.prepare();
    await restarted.tick();
    expect((await get(beforeRestart.id)).status).toBe('processing');

    // The worker finishes while the API was "down": the new instance ingests the result.
    await actAsWorker(t, accepted(beforeRestart.id));
    await restarted.tick();
    expect((await get(beforeRestart.id)).status).toBe('ready');

    // A job whose worker never answers fails with an actionable code after the deadline.
    const { media: stuck } = await uploadPng();
    await restarted.tick();
    expect((await get(stuck.id)).status).toBe('processing');
    offset = 60_000;
    await restarted.tick();
    expect(await get(stuck.id)).toMatchObject({
      status: 'failed',
      errorCode: 'inspection_timeout',
    });
    expect(await listDir(join(t.jobsDir, 'inbox'))).toEqual([]);

    // A row committed just before a crash, whose job file was never written, is re-queued.
    const { media: orphan } = await uploadPng();
    await unlink(join(t.jobsDir, 'inbox', `${orphan.id}.json`));
    offset = 0;
    const later = new MediaPipeline({
      jobsDir: t.jobsDir,
      pool: t.pool,
      storage,
      limits: t.config.limits,
      logger: silent,
      now: () => new Date(Date.now() + 31_000),
    });
    await later.prepare();
    await later.tick();
    expect(await listDir(join(t.jobsDir, 'inbox'))).toContain(`${orphan.id}.json`);
    expect((await get(orphan.id)).status).toBe('processing');
    await actAsWorker(t, accepted(orphan.id));
    await later.tick();
    expect((await get(orphan.id)).status).toBe('ready');
  });

  it('enforces the per-organisation storage quota, also under concurrent uploads', async () => {
    const quotaOrg = await createOrg('Upload quota');
    const quotaOperator = await signIn(t, quotaOrg);
    // Each file is 60 KiB; the quota is 200 KiB, so only three fit.
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => uploadBytes(quotaOperator, fakePng(60 * 1024))),
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 413, 413, 413]);
    for (const response of responses) {
      const body = (await response.json()) as { error?: { code: string } };
      if (response.status === 413) expect(body.error?.code).toBe('storage_quota_exceeded');
    }
    const list = (await (await quotaOperator.fetch('/api/media')).json()) as {
      storage: { usedBytes: number; limitBytes: number };
      items: Media[];
    };
    expect(list.storage).toEqual({ usedBytes: 180 * 1024, limitBytes: QUOTA });
    // With 20 KiB left, a 30 KiB file is cut off at the remaining space.
    const tooBigForRest = await uploadBytes(quotaOperator, fakePng(30 * 1024));
    expect(tooBigForRest.status).toBe(413);
    expect(((await tooBigForRest.json()) as { error: { code: string } }).error.code).toBe(
      'storage_quota_exceeded',
    );
    // Another organisation's quota is untouched.
    expect((await uploadBytes(operator, await pngBytes())).status).toBe(201);
    expect(await mediaCount(quotaOrg)).toBe(3);
  });

  it('keeps published bytes available after the media is deleted from the library', async () => {
    const fresh = await createOrg('Upload delete');
    const op = await signIn(t, fresh);
    const display = await createDisplay(op, fresh);
    const used = await readyImage(t, op);
    const unused = await readyImage(t, op);
    const { publicationId, playlistId } = await publishImages(op, display.id, [used.id]);
    const player = await pairPlayer(t, op, display.id);

    expect((await op.fetch(`/api/media/${used.id}`, { method: 'DELETE' })).status).toBe(409);
    await op.fetch(`/api/playlists/${playlistId}`, {
      method: 'PUT',
      json: { name: 'emptied', items: [] },
    });
    expect((await op.fetch(`/api/media/${used.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await op.fetch(`/api/media/${unused.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await op.fetch(`/api/media/${used.id}`)).status).toBe(404);
    expect((await op.fetch(`/api/media/${used.id}/preview`)).status).toBe(404);

    // The player can still download what was published.
    const urls = (await (
      await fetch(`${t.url}/player/media-urls`, {
        method: 'POST',
        headers: { ...player.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ publicationId, assetIds: [used.id] }),
      })
    ).json()) as { urls: { url: string }[] };
    const signed = new URL(urls.urls[0]?.url ?? '');
    const download = await fetch(`${t.url}${signed.pathname}${signed.search}`);
    expect(download.status).toBe(200);
    expect(
      createHash('sha256')
        .update(Buffer.from(await download.arrayBuffer()))
        .digest('hex'),
    ).toBe(used.sha256);

    // The unused file's bytes are gone from storage; the published one's remain.
    const storage = await LocalObjectStorage.create({ root: t.mediaRoot });
    const keys = await withOrg(t.pool, fresh.orgId, async (tx) => {
      const { rows } = await tx.query<{ id: string; storage_key: string }>(
        'SELECT id, storage_key FROM media',
      );
      return rows;
    });
    expect(keys.map((k) => k.id)).toEqual([used.id]);
    expect(await storage.stat(keys[0]?.storage_key ?? '')).not.toBeNull();
  });
});
