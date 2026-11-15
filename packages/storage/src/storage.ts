import type { Readable } from 'node:stream';
import type { ByteRange } from './range.ts';

export interface StoredObjectInfo {
  readonly key: string;
  readonly bytes: number;
  /** Lower-case hex SHA-256 of the stored bytes, computed while writing. */
  readonly sha256: string;
}

export interface PutOptions {
  /** Abort and store nothing when the source yields more than this many bytes. */
  readonly maxBytes?: number;
}

export interface ObjectReadHandle {
  /** Stream of exactly `length` bytes. The caller must consume or destroy it. */
  readonly stream: Readable;
  /** Number of bytes this stream yields. */
  readonly length: number;
  /** Size of the whole object. */
  readonly totalBytes: number;
  /** The range served; null when the whole object is served. */
  readonly range: ByteRange | null;
}

/**
 * Private object storage (prototype-m0.md D10). Implementations must:
 * - accept only keys produced by `newObjectKey`;
 * - make an object visible only when it is complete (no partial objects);
 * - never overwrite an existing object.
 * A later S3 implementation in an Australian region can satisfy the same interface.
 */
export interface ObjectStorage {
  /** Stores a new object. Rejects with `already_exists` if the key is taken, `too_large` if `maxBytes` is exceeded. */
  put(key: string, source: Readable | Uint8Array, options?: PutOptions): Promise<StoredObjectInfo>;
  /** Stores a new object from a local file path chosen by the server (never by a user). The source file is left in place. */
  putFile(key: string, sourcePath: string, options?: PutOptions): Promise<StoredObjectInfo>;
  /** Size of the object, or null when it does not exist. */
  stat(key: string): Promise<{ readonly bytes: number } | null>;
  /** Opens the object, optionally a byte range. Rejects with `not_found` or `invalid_range`. */
  openRead(key: string, range?: ByteRange): Promise<ObjectReadHandle>;
  /** Removes the object. Returns false when it did not exist. */
  delete(key: string): Promise<boolean>;
  /** Verifies the store is usable (for readiness checks). */
  check(): Promise<void>;
}
