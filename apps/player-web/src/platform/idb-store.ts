import type { Manifest, PlayerError } from '@tinnox/contracts';
import { deleteDB, openDB, type IDBPDatabase, type OpenDBCallbacks } from 'idb';
import type { z } from 'zod';
import {
  ActiveVersionSchema,
  PairingRecordSchema,
  RegistrationRecordSchema,
  StagingRecordSchema,
  StoredErrorsSchema,
  type ActiveVersion,
  type PairingRecord,
  type RegistrationRecord,
  type StagingRecord,
  type StateStore,
} from '../core/types.ts';

export const PLAYER_DB_NAME = 'tinnox-player';
const DB_VERSION = 1;
const KV = 'kv';

const KEYS = {
  registration: 'registration',
  active: 'activeVersion',
  staging: 'stagingVersion',
  seq: 'heartbeatSeq',
  errors: 'errors',
  pairing: 'pairing',
} as const;

/** Why the open connection stopped being usable. */
export type ConnectionLoss = 'blocking' | 'terminated';

export interface OpenOptions {
  /**
   * Called when the connection is gone: another context needs a newer version or wants to
   * delete the database ("blocking"; the connection is closed so it can proceed), or the
   * browser closed it (storage cleared or evicted, "terminated"). Every later call on this
   * store fails, so the player must reopen or reload.
   */
  readonly onConnectionLost?: (reason: ConnectionLoss) => void;
}

function isVersionError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'VersionError';
}

function parseOrNull<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> | null {
  if (value === undefined || value === null) return null;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Player state in IndexedDB: one object store of named records. Every value is
 * validated when read; a record that does not match its schema is treated as absent.
 */
export class IdbStateStore implements StateStore {
  readonly #db: IDBPDatabase;

  private constructor(db: IDBPDatabase) {
    this.#db = db;
  }

  /**
   * Opens the database. Tolerates a newer version left by a later build (after a rollback):
   * every record is validated when read, so the existing database is opened as it is,
   * instead of failing with VersionError and leaving the player unable to start.
   */
  static async open(
    name: string = PLAYER_DB_NAME,
    options: OpenOptions = {},
  ): Promise<IdbStateStore> {
    const holder: { db: IDBPDatabase | null } = { db: null };
    const callbacks: OpenDBCallbacks<unknown> = {
      upgrade(database) {
        if (!database.objectStoreNames.contains(KV)) database.createObjectStore(KV);
      },
      blocking() {
        // Another context wants to delete or upgrade the database (local reset, newer
        // build): let it, and tell the player this connection is gone.
        holder.db?.close();
        options.onConnectionLost?.('blocking');
      },
      terminated() {
        options.onConnectionLost?.('terminated');
      },
    };
    try {
      holder.db = await openDB(name, DB_VERSION, callbacks);
    } catch (err) {
      if (!isVersionError(err)) throw err;
      holder.db = await openDB(name, undefined, callbacks);
      if (!holder.db.objectStoreNames.contains(KV)) {
        const next = holder.db.version + 1;
        holder.db.close();
        holder.db = await openDB(name, next, callbacks);
      }
    }
    return new IdbStateStore(holder.db);
  }

  close(): void {
    this.#db.close();
  }

  /** Removes every record (registration and credential included). */
  async wipe(): Promise<void> {
    await this.#db.clear(KV);
  }

  /** Closes and deletes the whole database. Resolves even when another tab delays the deletion. */
  static async destroy(store: IdbStateStore | null, name: string = PLAYER_DB_NAME): Promise<void> {
    store?.close();
    await deleteDB(name, { blocked: () => undefined });
  }

  async getRegistration(): Promise<RegistrationRecord | null> {
    return parseOrNull(RegistrationRecordSchema, await this.#db.get(KV, KEYS.registration));
  }

  async replaceRegistration(registration: RegistrationRecord): Promise<void> {
    const record = RegistrationRecordSchema.parse(registration);
    const tx = this.#db.transaction(KV, 'readwrite');
    await Promise.all([tx.store.clear(), tx.store.put(record, KEYS.registration), tx.done]);
  }

  async markRevoked(at: string): Promise<void> {
    const tx = this.#db.transaction(KV, 'readwrite');
    const current = parseOrNull(RegistrationRecordSchema, await tx.store.get(KEYS.registration));
    const writes: Promise<unknown>[] = [
      tx.store.delete(KEYS.active),
      tx.store.delete(KEYS.staging),
      tx.store.delete(KEYS.pairing),
    ];
    if (current !== null) {
      const revoked: RegistrationRecord = {
        ...current,
        deviceToken: null,
        revokedAt: current.revokedAt ?? at,
      };
      writes.push(tx.store.put(revoked, KEYS.registration));
    } else {
      writes.push(tx.store.delete(KEYS.registration));
    }
    await Promise.all([...writes, tx.done]);
  }

  async getActive(): Promise<ActiveVersion | null> {
    return parseOrNull(ActiveVersionSchema, await this.#db.get(KV, KEYS.active));
  }

  async getStaging(): Promise<StagingRecord | null> {
    return parseOrNull(StagingRecordSchema, await this.#db.get(KV, KEYS.staging));
  }

  async putStaging(record: StagingRecord): Promise<void> {
    await this.#db.put(KV, record, KEYS.staging);
  }

  async clearStaging(): Promise<void> {
    await this.#db.delete(KV, KEYS.staging);
  }

  async activate(registrationId: string, manifest: Manifest, at: string): Promise<boolean> {
    const tx = this.#db.transaction(KV, 'readwrite');
    const registration = parseOrNull(
      RegistrationRecordSchema,
      await tx.store.get(KEYS.registration),
    );
    if (
      registration === null ||
      registration.registrationId !== registrationId ||
      registration.revokedAt !== null ||
      registration.display.id !== manifest.displayId
    ) {
      await tx.done;
      return false;
    }
    const active: ActiveVersion = { manifest, activatedAt: at };
    // Both writes belong to one transaction: either the new version is active and the
    // staging record is gone, or nothing changed.
    await Promise.all([tx.store.put(active, KEYS.active), tx.store.delete(KEYS.staging), tx.done]);
    return true;
  }

  async nextHeartbeatSeq(nowMs: number): Promise<number> {
    const tx = this.#db.transaction(KV, 'readwrite');
    const stored: unknown = await tx.store.get(KEYS.seq);
    const last =
      typeof stored === 'number' && Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
    // Clock-based with a persisted floor: still increases if the clock steps back,
    // and still increases after a reload.
    const next = Math.min(Math.max(last + 1, Math.floor(nowMs)), Number.MAX_SAFE_INTEGER);
    await Promise.all([tx.store.put(next, KEYS.seq), tx.done]);
    return next;
  }

  async getErrors(): Promise<PlayerError[]> {
    return parseOrNull(StoredErrorsSchema, await this.#db.get(KV, KEYS.errors)) ?? [];
  }

  async putErrors(errors: readonly PlayerError[]): Promise<void> {
    await this.#db.put(KV, [...errors], KEYS.errors);
  }

  async getPairing(): Promise<PairingRecord | null> {
    return parseOrNull(PairingRecordSchema, await this.#db.get(KV, KEYS.pairing));
  }

  async putPairing(record: PairingRecord): Promise<void> {
    await this.#db.put(KV, record, KEYS.pairing);
  }

  async clearPairing(): Promise<void> {
    await this.#db.delete(KV, KEYS.pairing);
  }
}
