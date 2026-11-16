import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rm,
  stat as fsStat,
  unlink,
} from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { parseObjectKey, StorageError } from './keys.ts';
import type { ByteRange } from './range.ts';
import type { ObjectReadHandle, ObjectStorage, PutOptions, StoredObjectInfo } from './storage.ts';

const OBJECTS_DIR = 'objects';
const TEMP_DIR = '.tmp';

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}

export interface LocalStorageOptions {
  /**
   * Directory that holds the objects. Must be outside any directory served as
   * static files or containing source code. Created if missing.
   */
  readonly root: string;
}

/**
 * Filesystem implementation. Layout:
 *   <root>/objects/<org uuid>/<object uuid>   complete objects only
 *   <root>/.tmp/<uuid>                        writes in progress
 * A write goes to .tmp, is flushed to disk, then hard-linked into place, so
 * a reader sees either nothing or the whole object, and an existing object is
 * never replaced.
 */
export class LocalObjectStorage implements ObjectStorage {
  readonly #root: string;
  readonly #objects: string;
  readonly #temp: string;

  private constructor(realRoot: string) {
    this.#root = realRoot;
    this.#objects = join(realRoot, OBJECTS_DIR);
    this.#temp = join(realRoot, TEMP_DIR);
  }

  static async create(options: LocalStorageOptions): Promise<LocalObjectStorage> {
    if (typeof options.root !== 'string' || options.root.trim() === '') {
      throw new StorageError('io_error', 'storage root is not configured');
    }
    const root = isAbsolute(options.root) ? options.root : resolve(options.root);
    await mkdir(join(root, OBJECTS_DIR), { recursive: true, mode: 0o700 });
    await mkdir(join(root, TEMP_DIR), { recursive: true, mode: 0o700 });
    const real = await realpath(root);
    return new LocalObjectStorage(real);
  }

  /** Absolute storage root after symlink resolution. For diagnostics and backup scripts. */
  get root(): string {
    return this.#root;
  }

  #pathFor(key: string): { dir: string; file: string } {
    const { orgId, objectId } = parseObjectKey(key);
    const dir = join(this.#objects, orgId);
    const file = join(dir, objectId);
    // parseObjectKey already guarantees two UUID segments; this is a second,
    // independent check that the result is inside the objects directory.
    if (!file.startsWith(this.#objects + sep) || resolve(file) !== file) {
      throw new StorageError('invalid_key', 'object key resolves outside the storage root');
    }
    return { dir, file };
  }

  async put(
    key: string,
    source: Readable | Uint8Array,
    options: PutOptions = {},
  ): Promise<StoredObjectInfo> {
    const { dir, file } = this.#pathFor(key);
    if (
      options.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
    ) {
      throw new StorageError('too_large', 'maxBytes must be a non-negative integer');
    }
    const input =
      source instanceof Uint8Array
        ? Readable.from([Buffer.from(source.buffer, source.byteOffset, source.byteLength)])
        : source;
    const tempPath = join(this.#temp, randomUUID());
    const hash = createHash('sha256');
    let bytes = 0;
    let linked = false;
    try {
      // 'wx': fail if the temp name exists; O_NOFOLLOW: never write through a symlink.
      const handle = await open(
        tempPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      );
      try {
        for await (const chunk of input as AsyncIterable<unknown>) {
          if (!(chunk instanceof Uint8Array)) {
            throw new StorageError('io_error', 'source stream must yield binary chunks');
          }
          bytes += chunk.byteLength;
          if (options.maxBytes !== undefined && bytes > options.maxBytes) {
            throw new StorageError(
              'too_large',
              `object exceeds the limit of ${options.maxBytes} bytes`,
            );
          }
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.byteLength) {
            const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
            offset += bytesWritten;
          }
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await this.#assertInsideObjects(dir);
      try {
        // link() fails with EEXIST instead of replacing, unlike rename().
        await link(tempPath, file);
        linked = true;
      } catch (error) {
        if (isNodeError(error) && error.code === 'EEXIST') {
          throw new StorageError('already_exists', 'an object with this key already exists');
        }
        throw error;
      }
      await this.#syncDirectory(dir);
      return { key, bytes, sha256: hash.digest('hex') };
    } catch (error) {
      if (linked) await unlink(file).catch(() => undefined);
      if (error instanceof StorageError) throw error;
      throw new StorageError('io_error', 'failed to store object', { cause: error });
    } finally {
      if (!input.destroyed) input.destroy();
      await unlink(tempPath).catch(() => undefined);
    }
  }

  async putFile(
    key: string,
    sourcePath: string,
    options: PutOptions = {},
  ): Promise<StoredObjectInfo> {
    this.#pathFor(key);
    let info;
    try {
      info = await lstat(sourcePath);
    } catch (error) {
      throw new StorageError('not_found', 'source file does not exist', { cause: error });
    }
    if (!info.isFile()) {
      throw new StorageError('not_a_regular_file', 'source is not a regular file');
    }
    let handle;
    try {
      handle = await open(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      throw new StorageError('io_error', 'failed to open source file', { cause: error });
    }
    return this.put(key, handle.createReadStream({ autoClose: true }), options);
  }

  async stat(key: string): Promise<{ readonly bytes: number } | null> {
    const { file } = this.#pathFor(key);
    try {
      const info = await lstat(file);
      if (!info.isFile()) {
        throw new StorageError('not_a_regular_file', 'stored object is not a regular file');
      }
      return { bytes: info.size };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
      throw new StorageError('io_error', 'failed to inspect object', { cause: error });
    }
  }

  async openRead(key: string, range?: ByteRange): Promise<ObjectReadHandle> {
    const { dir, file } = this.#pathFor(key);
    let handle;
    try {
      await this.#assertInsideObjects(dir);
      handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        throw new StorageError('not_found', 'object does not exist');
      }
      if (isNodeError(error) && (error.code === 'ELOOP' || error.code === 'EMLINK')) {
        throw new StorageError('not_a_regular_file', 'stored object is not a regular file');
      }
      throw new StorageError('io_error', 'failed to open object', { cause: error });
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) {
        throw new StorageError('not_a_regular_file', 'stored object is not a regular file');
      }
      const totalBytes = info.size;
      if (range !== undefined) {
        const valid =
          Number.isSafeInteger(range.start) &&
          Number.isSafeInteger(range.end) &&
          range.start >= 0 &&
          range.end >= range.start &&
          range.end < totalBytes;
        if (!valid)
          throw new StorageError('invalid_range', 'requested range is outside the object');
      }
      if (totalBytes === 0) {
        await handle.close();
        return { stream: Readable.from([]), length: 0, totalBytes: 0, range: null };
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? totalBytes - 1;
      const stream = handle.createReadStream({ start, end, autoClose: true });
      return { stream, length: end - start + 1, totalBytes, range: range ?? null };
    } catch (error) {
      await handle.close().catch(() => undefined);
      if (error instanceof StorageError) throw error;
      throw new StorageError('io_error', 'failed to read object', { cause: error });
    }
  }

  async delete(key: string): Promise<boolean> {
    const { dir, file } = this.#pathFor(key);
    try {
      await unlink(file);
    } catch (error) {
      if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
      throw new StorageError('io_error', 'failed to delete object', { cause: error });
    }
    await this.#syncDirectory(dir);
    return true;
  }

  async check(): Promise<void> {
    try {
      const info = await fsStat(this.#objects);
      if (!info.isDirectory()) throw new Error('objects path is not a directory');
      const probe = join(this.#temp, `probe-${randomUUID()}`);
      const handle = await open(
        probe,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
        0o600,
      );
      await handle.close();
      await unlink(probe);
    } catch (error) {
      throw new StorageError('io_error', 'storage root is not writable', { cause: error });
    }
  }

  /**
   * Removes leftovers of interrupted writes; `olderThanMs` protects writes that are
   * in progress.
   */
  async removeStaleTempFiles(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const name of await readdir(this.#temp)) {
      const path = join(this.#temp, name);
      try {
        const info = await lstat(path);
        if (info.mtimeMs < cutoff) {
          await rm(path, { force: true, recursive: false });
          removed += 1;
        }
      } catch (error) {
        if (!(isNodeError(error) && error.code === 'ENOENT')) throw error;
      }
    }
    return removed;
  }

  /** Refuses to operate through an organisation directory that was replaced by a symlink. */
  async #assertInsideObjects(dir: string): Promise<void> {
    let real: string;
    try {
      real = await realpath(dir);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new StorageError('not_found', 'object does not exist');
      }
      throw error;
    }
    if (real !== dir) {
      throw new StorageError(
        'not_a_regular_file',
        'storage directory is not a plain directory inside the storage root',
      );
    }
  }

  async #syncDirectory(dir: string): Promise<void> {
    // Makes the directory entry durable. Not supported on every platform; data safety
    // of the file itself does not depend on it, so failures are ignored.
    try {
      const handle = await open(dir, fsConstants.O_RDONLY);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      /* best effort */
    }
  }
}
