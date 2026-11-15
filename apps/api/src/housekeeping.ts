/**
 * Periodic clean-up, run hourly by main.ts and directly by tests. Every step is a
 * narrow sec.* function or a local-file sweep; none depends on anything a client sends.
 */
import type { Limits } from '@tinnox/contracts';
import {
  heartbeatLogPurge,
  pairingPurge,
  poolAsTx,
  sessionPurgeExpired,
  type Pool,
} from '@tinnox/db';
import type { ObjectStorage } from '@tinnox/storage';
import type { MediaPipeline } from './media/pipeline.ts';

export interface HousekeepingDeps {
  readonly pool: Pool;
  readonly storage: ObjectStorage;
  readonly media: MediaPipeline;
  readonly limits: Limits;
}

export interface HousekeepingResult {
  readonly sessions: number;
  readonly pairings: number;
  readonly temp: number;
  readonly heartbeats: number;
  readonly jobFiles: number;
}

export async function runHousekeeping(deps: HousekeepingDeps): Promise<HousekeepingResult> {
  const tx = poolAsTx(deps.pool);
  const sessions = await sessionPurgeExpired(tx);
  const pairings = await pairingPurge(tx, 24 * 60 * 60);
  // The local storage implementation leaves temp files behind on a crash; others may not.
  const storage = deps.storage as ObjectStorage & {
    removeStaleTempFiles?: (olderThanMs: number) => Promise<number>;
  };
  const temp =
    typeof storage.removeStaleTempFiles === 'function'
      ? await storage.removeStaleTempFiles(60 * 60 * 1000)
      : 0;
  const heartbeats = await heartbeatLogPurge(tx, deps.limits.heartbeatLogRetentionHours * 3600);
  const jobFiles = await deps.media.sweep();
  return { sessions, pairings, temp, heartbeats, jobFiles };
}
