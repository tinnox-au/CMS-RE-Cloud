/**
 * Brief section 8 item 5 with the REAL validation worker: the container image from
 * apps/media-worker (no network, read-only, unprivileged) inspects real files that the
 * real API quarantined. Nothing here writes a verdict on the worker's behalf.
 *
 * Needs Docker and the image `tinnox-cms-media-worker:m0` (`npm run infra:up` builds it)
 * and the sample files (`npm run fixtures`).
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDisplay,
  createOrg,
  fixturesDir,
  repoRoot,
  signIn,
  startTestApp,
  startWorkerContainer,
  uploadBytes,
  waitForVerdict,
  WORKER_IMAGE,
  type Operator,
  type TestApp,
  type TestOrg,
} from './support.ts';

function fixture(name: string): Buffer {
  return readFileSync(join(fixturesDir, name));
}

describe('upload validation by the isolated worker', () => {
  let t: TestApp;
  let org: TestOrg;
  let operator: Operator;
  let stopWorker: () => void = () => undefined;

  beforeAll(async () => {
    try {
      execFileSync('docker', ['image', 'inspect', WORKER_IMAGE], { stdio: 'ignore' });
    } catch {
      throw new Error(`docker image ${WORKER_IMAGE} is missing; run "npm run infra:up" first`);
    }
    if (!existsSync(join(fixturesDir, 'h264.mp4'))) {
      execFileSync(
        process.execPath,
        [join(repoRoot, 'apps', 'api', 'test-fixtures', 'generate.mjs')],
        {
          stdio: 'ignore',
        },
      );
    }
    t = await startTestApp();
    org = await createOrg('Worker validation');
    operator = await signIn(t, org);
    stopWorker = startWorkerContainer(t);
  }, 180_000);
  afterAll(async () => {
    stopWorker();
    await t.close();
  });

  async function verdictFor(
    file: string,
    uploadName = file,
  ): Promise<{
    id: string;
    status: string;
    errorCode: string | null;
    codec: string | null;
    kind: string;
  }> {
    const upload = await uploadBytes(operator, fixture(file), uploadName);
    expect(upload.status, `${file}: ${upload.status}`).toBe(201);
    const { media } = (await upload.json()) as { media: { id: string; status: string } };
    expect(media.status).toBe('processing');
    return { id: media.id, ...(await waitForVerdict(t, operator, media.id)) };
  }

  it('accepts JPEG, PNG and H.264 MP4 and records what the files really are', async () => {
    const jpeg = await verdictFor('landscape.jpg');
    const png = await verdictFor('portrait.png');
    const mp4 = await verdictFor('h264.mp4');
    const withAudio = await verdictFor('h264-with-audio.mp4');
    for (const item of [jpeg, png, mp4, withAudio])
      expect(item.status, JSON.stringify(item)).toBe('ready');
    expect(jpeg.kind).toBe('image');
    expect(mp4.kind).toBe('video');
    expect(mp4.codec).toBe('h264');

    const detail = (await (await operator.fetch(`/api/media/${mp4.id}`)).json()) as {
      width: number;
      height: number;
      durationMs: number;
      bytes: number;
      sha256: string;
      mimeType: string;
    };
    expect(detail).toMatchObject({ width: 320, height: 240, mimeType: 'video/mp4' });
    expect(detail.durationMs).toBeGreaterThan(1500);
    expect(detail.durationMs).toBeLessThan(2500);
    // Size and digest are the API's own computation over the stored bytes.
    const bytes = fixture('h264.mp4');
    expect(detail.bytes).toBe(bytes.length);
    expect(detail.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    // The stored object is served back unchanged, only to the session.
    const preview = await operator.fetch(`/api/media/${mp4.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('video/mp4');
    expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await preview.arrayBuffer()).equals(bytes)).toBe(true);
    expect((await fetch(`${t.url}/api/media/${mp4.id}/preview`)).status).toBe(401);
  });

  it('rejects unsupported codecs and disguised or damaged files with a specific reason', async () => {
    const cases: [string, RegExp][] = [
      ['hevc.mp4', /codec/],
      ['vp9.mp4', /codec/],
      ['h264-yuv444.mp4', /codec|pixel|format|profile/],
      ['jpeg-signature-then-garbage.jpg', /corrupt|decode|invalid|unreadable|inspection/],
      ['too-wide.png', /large|dimension|size|pixel/],
    ];
    for (const [file, reason] of cases) {
      const verdict = await verdictFor(file);
      expect(verdict.status, file).toBe('failed');
      expect(verdict.errorCode ?? '', `${file}: ${verdict.errorCode}`).toMatch(reason);
      // A failed file has no stored object and no preview.
      expect((await operator.fetch(`/api/media/${verdict.id}/preview`)).status).toBe(409);
    }
    // A Matroska file named .mp4 never reaches the worker: the first bytes are not ISO-BMFF.
    const disguised = await uploadBytes(operator, fixture('matroska-renamed.mp4'), 'clip.mp4');
    expect(disguised.status).toBe(415);
  });

  it('refuses text, HTML and SVG whatever name and type the client claims', async () => {
    const before = ((await (await operator.fetch('/api/media')).json()) as { items: unknown[] })
      .items.length;
    for (const [file, name, type] of [
      ['text-renamed.jpg', 'photo.jpg', 'image/jpeg'],
      ['html-renamed.png', 'picture.png', 'image/png'],
      ['vector-renamed.png', 'logo.png', 'image/png'],
      ['vector-renamed.png', 'logo.svg', 'image/svg+xml'],
      ['html-renamed.png', 'page.html', 'text/html'],
    ] as const) {
      const body = new FormData();
      body.set('file', new Blob([Uint8Array.from(fixture(file))], { type }), name);
      const response = await operator.fetch('/api/media', { method: 'POST', body });
      expect(response.status, `${name} as ${type}`).toBe(415);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'unsupported_media_type',
      );
    }
    const after = ((await (await operator.fetch('/api/media')).json()) as { items: unknown[] })
      .items.length;
    expect(after).toBe(before);
    expect(await readdir(join(t.jobsDir, 'inbox'))).not.toContain('logo.svg');
  });

  it('treats a hostile file name as a label only', async () => {
    const names = [
      '../../../etc/passwd.png',
      '..\\..\\windows\\system32\\evil.png',
      '/absolute/path/image.png',
      'name with\nnewline.png',
      '$(touch pwned).png',
      '; rm -rf . ;.png',
      `${'a'.repeat(400)}.png`,
    ];
    for (const name of names) {
      const upload = await uploadBytes(operator, fixture('portrait.png'), name);
      expect(upload.status, JSON.stringify(name)).toBe(201);
      const { media } = (await upload.json()) as { media: { id: string; originalName: string } };
      expect(media.originalName).not.toMatch(/[\\/\n\r\0]/);
      expect(media.originalName.length).toBeLessThanOrEqual(255);
      const verdict = await waitForVerdict(t, operator, media.id);
      expect(verdict.status, JSON.stringify(name)).toBe('ready');
    }
    // Every stored object sits at <media root>/…/<org uuid>/<object uuid>; nothing else was created.
    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(path)));
        else out.push(path);
      }
      return out;
    };
    const stored = await walk(t.mediaRoot);
    expect(stored.length).toBeGreaterThanOrEqual(names.length);
    for (const path of stored) {
      expect(path.startsWith(t.mediaRoot)).toBe(true);
      expect(path).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(path).toContain(org.orgId);
    }
    expect(existsSync(join(repoRoot, 'apps', 'api', 'pwned'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'pwned'))).toBe(false);
  });

  it('retries a job once after the worker died mid-inspection, and rejects a file that killed it twice', async () => {
    // Pause the worker, queue two valid files, and leave the crash markers an earlier
    // worker would have left: one interrupted attempt (old empty marker) and two.
    stopWorker();
    const upload = async (name: string): Promise<string> => {
      const response = await uploadBytes(operator, fixture(name), name);
      expect(response.status).toBe(201);
      return ((await response.json()) as { media: { id: string } }).media.id;
    };
    const once = await upload('landscape.jpg');
    const twice = await upload('portrait.png');
    await writeFile(join(t.jobsDir, 'outbox', `${once}.started`), '', { mode: 0o644 });
    await writeFile(join(t.jobsDir, 'outbox', `${twice}.started`), '2', { mode: 0o644 });
    stopWorker = startWorkerContainer(t);

    const retried = await waitForVerdict(t, operator, once);
    expect(retried.status, JSON.stringify(retried)).toBe('ready');
    const rejected = await waitForVerdict(t, operator, twice);
    expect(rejected).toMatchObject({ status: 'failed', errorCode: 'inspection_failed' });
  });

  it('does not publish media that failed or is still being checked', async () => {
    const display = await createDisplay(operator, org);
    const ready = await verdictFor('landscape.jpg');
    const failed = await verdictFor('hevc.mp4');
    // Pause the worker so the next upload stays in "processing".
    stopWorker();
    stopWorker = () => undefined;
    const pendingUpload = await uploadBytes(operator, fixture('portrait.png'), 'pending.png');
    const pending = ((await pendingUpload.json()) as { media: { id: string; status: string } })
      .media;
    expect(pending.status).toBe('processing');

    const playlist = (await (
      await operator.fetch('/api/playlists', { method: 'POST', json: { name: 'Unready' } })
    ).json()) as { id: string };
    const publish = (): Promise<Response> =>
      operator.fetch(`/api/playlists/${playlist.id}/publish`, {
        method: 'POST',
        json: { displayId: display.id },
        headers: { 'idempotency-key': randomUUID() },
      });
    const save = (mediaIds: string[]): Promise<Response> =>
      operator.fetch(`/api/playlists/${playlist.id}`, {
        method: 'PUT',
        json: {
          name: 'Unready',
          items: mediaIds.map((mediaId) => ({
            mediaId,
            durationMs: mediaId === failed.id ? null : 5000,
            fit: null,
          })),
        },
      });

    for (const [what, ids, code] of [
      ['failed media', [ready.id, failed.id], 'media_failed'],
      ['media still being checked', [ready.id, pending.id], 'media_not_ready'],
    ] as const) {
      const saved = await save([...ids]);
      if (saved.status === 200) {
        const refused = await publish();
        expect(refused.status, what).toBe(422);
        const body = (await refused.json()) as {
          error: { code: string; details?: { code?: string }[] };
        };
        expect(body.error.code).toBe('publication_rejected');
        expect(JSON.stringify(body.error.details ?? [])).toContain(code);
      } else {
        // Refusing to put unready media into a draft at all is also a safe answer.
        expect(saved.status, what).toBeGreaterThanOrEqual(400);
        expect(saved.status).toBeLessThan(500);
      }
    }
    const status = (await (await operator.fetch(`/api/displays/${display.id}/status`)).json()) as {
      desired: unknown;
    };
    expect(status.desired).toBeNull();
    // With only ready media the same playlist publishes.
    expect((await save([ready.id])).status).toBe(200);
    expect((await publish()).status).toBe(201);
  });
});
