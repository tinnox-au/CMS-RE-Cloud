import type { Limits } from '@tinnox/contracts';
import { formatBytes } from './format.ts';

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled' | 'rejected';

export interface UploadEntry {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly status: UploadStatus;
  readonly loaded: number;
  /** For `rejected`: why the portal did not send the file. */
  readonly localMessage: string | null;
  /** For `failed`: the error from the API or the network. */
  readonly error: unknown;
}

/**
 * Checks that can be made without reading the file. The file type is deliberately
 * not judged here: the server decides from the content, never from the name.
 */
export function preflightMessage(
  file: { readonly size: number },
  limits: Pick<Limits, 'maxUploadBytes'>,
): string | null {
  if (file.size === 0) return 'The file is empty.';
  if (file.size > limits.maxUploadBytes) {
    return `The file is ${formatBytes(file.size)}; the upload limit is ${formatBytes(limits.maxUploadBytes)}.`;
  }
  return null;
}

export function newEntry(
  id: string,
  file: { readonly name: string; readonly size: number },
  limits: Pick<Limits, 'maxUploadBytes'>,
): UploadEntry {
  const localMessage = preflightMessage(file, limits);
  return {
    id,
    name: file.name,
    size: file.size,
    status: localMessage === null ? 'queued' : 'rejected',
    loaded: 0,
    localMessage,
    error: null,
  };
}

/** The next entry to send: the first queued one, and only when nothing is in flight. */
export function nextToStart(entries: readonly UploadEntry[]): UploadEntry | null {
  if (entries.some((entry) => entry.status === 'uploading')) return null;
  return entries.find((entry) => entry.status === 'queued') ?? null;
}

export function patchEntry(
  entries: readonly UploadEntry[],
  id: string,
  change: Partial<Omit<UploadEntry, 'id'>>,
): UploadEntry[] {
  return entries.map((entry) => (entry.id === id ? { ...entry, ...change } : entry));
}

export function isFinished(entry: UploadEntry): boolean {
  return entry.status !== 'queued' && entry.status !== 'uploading';
}
