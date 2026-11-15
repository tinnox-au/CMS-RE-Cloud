import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isValidObjectKey,
  keyBelongsToOrg,
  newObjectKey,
  parseObjectKey,
  StorageError,
} from './keys.ts';
import { LocalObjectStorage } from './local.ts';
import { contentRangeHeader, parseRangeHeader, unsatisfiableContentRangeHeader } from './range.ts';

const ORG_A = '0a000000-0000-4000-8000-00000000000a';
const ORG_B = '0b000000-0000-4000-8000-00000000000b';

let base: string;
let root: string;
let storage: LocalObjectStorage;

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
async function listAll(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => !e.isDirectory())
    .map((e) => join(e.parentPath, e.name));
}
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy((e) => e instanceof StorageError && e.code === code);
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'tinnox-storage-'));
  root = join(base, 'media');
  storage = await LocalObjectStorage.create({ root });
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('object keys', () => {
  it('generates <org>/<uuid> keys that never contain user input', () => {
    const key = newObjectKey(ORG_A);
    expect(isValidObjectKey(key)).toBe(true);
    expect(parseObjectKey(key).orgId).toBe(ORG_A);
    expect(keyBelongsToOrg(key, ORG_A)).toBe(true);
    expect(keyBelongsToOrg(key, ORG_B)).toBe(false);
    expect(newObjectKey(ORG_A)).not.toBe(key);
  });

  it('refuses to build a key from anything but a UUID', () => {
    for (const bad of [
      '',
      '..',
      '../etc',
      'ORG',
      ORG_A.toUpperCase(),
      `${ORG_A}/x`,
      `${ORG_A}\u0000`,
    ]) {
      expect(() => newObjectKey(bad)).toThrow(StorageError);
    }
  });
});

describe('path traversal resistance', () => {
  const object = '0c000000-0000-4000-8000-00000000000c';
  const hostile = [
    '../secret',
    '../../etc/passwd',
    `${ORG_A}/../${ORG_B}/${object}`,
    `${ORG_A}/../../outside`,
    `/${ORG_A}/${object}`,
    `/etc/passwd`,
    `${ORG_A}/${object}/..`,
    `${ORG_A}/${object}/extra`,
    `${ORG_A}//${object}`,
    `${ORG_A}\\${object}`,
    `${ORG_A}/${object}\u0000.jpg`,
    `${ORG_A}/${object} `,
    `${ORG_A.toUpperCase()}/${object}`,
    `${ORG_A}/%2e%2e%2f${object}`,
    `${ORG_A}/..%2f..%2f${object.slice(0, 24)}`,
    `${ORG_A}/${'.'.repeat(36)}`,
    `${ORG_A}/${object}\n`,
    '',
    ORG_A,
  ];

  it('rejects every hostile key on every operation without touching the filesystem', async () => {
    await writeFile(join(base, 'secret'), 'outside the root');
    for (const key of hostile) {
      expect(isValidObjectKey(key), JSON.stringify(key)).toBe(false);
      await expectCode(storage.put(key, Buffer.from('x')), 'invalid_key');
      await expectCode(storage.putFile(key, join(base, 'secret')), 'invalid_key');
      await expectCode(storage.stat(key), 'invalid_key');
      await expectCode(storage.openRead(key), 'invalid_key');
      await expectCode(storage.delete(key), 'invalid_key');
    }
    const notStrings: unknown[] = [null, undefined, 42, {}, [`${ORG_A}/${object}`]];
    for (const notString of notStrings) {
      await expectCode(storage.stat(notString as string), 'invalid_key');
    }
    expect(await listAll(root)).toEqual([]);
    expect(await readFile(join(base, 'secret'), 'utf8')).toBe('outside the root');
  });

  it('does not follow a symlink planted in place of an object', async () => {
    await writeFile(join(base, 'secret'), 'outside the root');
    const key = newObjectKey(ORG_A);
    const { orgId, objectId } = parseObjectKey(key);
    await mkdir(join(root, 'objects', orgId), { recursive: true });
    await symlink(join(base, 'secret'), join(root, 'objects', orgId, objectId));
    await expectCode(storage.openRead(key), 'not_a_regular_file');
    await expectCode(storage.stat(key), 'not_a_regular_file');
    await expectCode(storage.put(key, Buffer.from('overwrite attempt')), 'already_exists');
    expect(await readFile(join(base, 'secret'), 'utf8')).toBe('outside the root');
  });

  it('does not operate through an organisation directory replaced by a symlink', async () => {
    const outside = join(base, 'outside');
    await mkdir(outside);
    const key = newObjectKey(ORG_B);
    const { orgId, objectId } = parseObjectKey(key);
    await writeFile(join(outside, objectId), 'outside the root');
    await symlink(outside, join(root, 'objects', orgId));
    await expectCode(storage.openRead(key), 'not_a_regular_file');
    await expectCode(storage.put(newObjectKey(ORG_B), Buffer.from('x')), 'not_a_regular_file');
    expect((await readdir(outside)).sort()).toEqual([objectId]);
  });
});

describe('atomic writes', () => {
  it('stores bytes and reports size and SHA-256', async () => {
    const data = Buffer.from('hello signage');
    const key = newObjectKey(ORG_A);
    const info = await storage.put(key, data);
    expect(info).toEqual({
      key,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
    expect(await storage.stat(key)).toEqual({ bytes: data.length });
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('stores a multi-chunk stream', async () => {
    const chunks = Array.from({ length: 50 }, (_, i) => Buffer.alloc(64 * 1024, i));
    const key = newObjectKey(ORG_A);
    const info = await storage.put(key, Readable.from(chunks));
    const whole = Buffer.concat(chunks);
    expect(info.bytes).toBe(whole.length);
    expect(info.sha256).toBe(createHash('sha256').update(whole).digest('hex'));
    const read = await storage.openRead(key);
    expect((await collect(read.stream)).equals(whole)).toBe(true);
  });

  it('shows nothing while a write is in progress and the whole object afterwards', async () => {
    const key = newObjectKey(ORG_A);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    async function* slow(): AsyncGenerator<Buffer> {
      yield Buffer.from('first half,');
      await gate;
      yield Buffer.from('second half');
    }
    const pending = storage.put(key, Readable.from(slow()));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await storage.stat(key)).toBeNull();
    await expectCode(storage.openRead(key), 'not_found');
    expect(await readdir(join(root, '.tmp'))).toHaveLength(1);
    release();
    await pending;
    expect(await storage.stat(key)).toEqual({ bytes: 22 });
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('leaves no object and no temp file when the source fails midway', async () => {
    const key = newObjectKey(ORG_A);
    async function* failing(): AsyncGenerator<Buffer> {
      yield Buffer.alloc(1024, 1);
      throw new Error('connection reset');
    }
    await expectCode(storage.put(key, Readable.from(failing())), 'io_error');
    expect(await storage.stat(key)).toBeNull();
    expect(await listAll(root)).toEqual([]);
  });

  it('enforces maxBytes while receiving and stores nothing', async () => {
    const key = newObjectKey(ORG_A);
    let produced = 0;
    async function* endless(): AsyncGenerator<Buffer> {
      for (;;) {
        produced += 1;
        yield Buffer.alloc(1024, 7);
      }
    }
    await expectCode(
      storage.put(key, Readable.from(endless()), { maxBytes: 10 * 1024 }),
      'too_large',
    );
    expect(produced).toBeLessThan(200);
    expect(await listAll(root)).toEqual([]);
    const exact = newObjectKey(ORG_A);
    expect((await storage.put(exact, Buffer.alloc(10 * 1024), { maxBytes: 10 * 1024 })).bytes).toBe(
      10 * 1024,
    );
  });

  it('never replaces an existing object', async () => {
    const key = newObjectKey(ORG_A);
    await storage.put(key, Buffer.from('original'));
    await expectCode(storage.put(key, Buffer.from('replacement')), 'already_exists');
    expect((await collect((await storage.openRead(key)).stream)).toString()).toBe('original');
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('copies from a server-chosen file and refuses a symlink source', async () => {
    const source = join(base, 'inbox-job');
    await writeFile(source, 'validated bytes');
    const key = newObjectKey(ORG_A);
    const info = await storage.putFile(key, source);
    expect(info.bytes).toBe(15);
    expect(await readFile(source, 'utf8')).toBe('validated bytes');
    const linkPath = join(base, 'link');
    await symlink(source, linkPath);
    await expectCode(storage.putFile(newObjectKey(ORG_A), linkPath), 'not_a_regular_file');
    await expectCode(storage.putFile(newObjectKey(ORG_A), join(base, 'missing')), 'not_found');
  });

  it('removes stale temp files but keeps recent ones', async () => {
    await writeFile(join(root, '.tmp', randomUUID()), 'leftover');
    expect(await storage.removeStaleTempFiles(60_000)).toBe(0);
    expect(await storage.removeStaleTempFiles(-1000)).toBe(1);
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });
});

describe('reading, ranges and delete', () => {
  const data = Buffer.from('0123456789abcdefghij');

  it('streams the whole object', async () => {
    const key = newObjectKey(ORG_A);
    await storage.put(key, data);
    const handle = await storage.openRead(key);
    expect(handle).toMatchObject({ length: 20, totalBytes: 20, range: null });
    expect((await collect(handle.stream)).equals(data)).toBe(true);
  });

  it('streams exact byte ranges', async () => {
    const key = newObjectKey(ORG_A);
    await storage.put(key, data);
    for (const [start, end, expected] of [
      [0, 0, '0'],
      [5, 9, '56789'],
      [10, 19, 'abcdefghij'],
      [19, 19, 'j'],
    ] as const) {
      const handle = await storage.openRead(key, { start, end });
      expect(handle.length).toBe(end - start + 1);
      expect(handle.totalBytes).toBe(20);
      expect((await collect(handle.stream)).toString()).toBe(expected);
    }
  });

  it('rejects ranges outside the object', async () => {
    const key = newObjectKey(ORG_A);
    await storage.put(key, data);
    for (const range of [
      { start: 0, end: 20 },
      { start: 20, end: 25 },
      { start: 5, end: 4 },
      { start: -1, end: 3 },
      { start: 0.5, end: 3 },
    ]) {
      await expectCode(storage.openRead(key, range), 'invalid_range');
    }
  });

  it('handles an empty object', async () => {
    const key = newObjectKey(ORG_A);
    expect((await storage.put(key, Buffer.alloc(0))).bytes).toBe(0);
    const handle = await storage.openRead(key);
    expect(handle.length).toBe(0);
    expect((await collect(handle.stream)).length).toBe(0);
  });

  it('deletes an object once and reports a missing one', async () => {
    const key = newObjectKey(ORG_A);
    await storage.put(key, data);
    expect(await storage.delete(key)).toBe(true);
    expect(await storage.stat(key)).toBeNull();
    await expectCode(storage.openRead(key), 'not_found');
    expect(await storage.delete(key)).toBe(false);
    expect(await storage.delete(newObjectKey(ORG_B))).toBe(false);
  });

  it('keeps organisations in separate directories and survives re-opening the store', async () => {
    const a = newObjectKey(ORG_A);
    const b = newObjectKey(ORG_B);
    await storage.put(a, Buffer.from('A'));
    await storage.put(b, Buffer.from('B'));
    expect((await readdir(join(root, 'objects'))).sort()).toEqual([ORG_A, ORG_B]);
    const reopened = await LocalObjectStorage.create({ root });
    expect((await collect((await reopened.openRead(a)).stream)).toString()).toBe('A');
    await reopened.check();
  });
});

describe('parseRangeHeader', () => {
  it('returns full for absent, malformed, multi-range or non-byte headers', () => {
    for (const h of [
      undefined,
      null,
      '',
      'bytes',
      'bytes=',
      'bytes=-',
      'items=0-1',
      'bytes=0-1,5-6',
      'bytes=a-b',
      'bytes=5-2',
      `bytes=0-${'9'.repeat(200)}`,
    ]) {
      expect(parseRangeHeader(h, 100), String(h)).toEqual({ kind: 'full' });
    }
  });
  it('parses closed, open and suffix ranges and clamps the end', () => {
    expect(parseRangeHeader('bytes=0-49', 100)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 49 },
    });
    expect(parseRangeHeader('bytes=50-', 100)).toEqual({
      kind: 'partial',
      range: { start: 50, end: 99 },
    });
    expect(parseRangeHeader('bytes=-10', 100)).toEqual({
      kind: 'partial',
      range: { start: 90, end: 99 },
    });
    expect(parseRangeHeader('bytes=-500', 100)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 99 },
    });
    expect(parseRangeHeader('bytes=90-500', 100)).toEqual({
      kind: 'partial',
      range: { start: 90, end: 99 },
    });
    expect(parseRangeHeader(' bytes=0-0 ', 100)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 0 },
    });
  });
  it('reports unsatisfiable ranges', () => {
    expect(parseRangeHeader('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=100-200', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=-5', 0)).toEqual({ kind: 'unsatisfiable' });
  });
  it('formats Content-Range values', () => {
    expect(contentRangeHeader({ start: 0, end: 49 }, 100)).toBe('bytes 0-49/100');
    expect(unsatisfiableContentRangeHeader(100)).toBe('bytes */100');
    expect(() => parseRangeHeader('bytes=0-1', -1)).toThrow(RangeError);
  });
});
