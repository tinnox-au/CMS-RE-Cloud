import type { MediaDto } from '@tinnox/contracts';
import { isFinished, type UploadEntry } from './uploadQueue.ts';

/**
 * How the Add media dialog reads the M0 upload queue (`uploadQueue.ts`): progress, counts,
 * the line for uploads that carry on after the dialog is closed, and what each uploaded
 * file's check has come to. Pure functions, no DOM.
 */

/** Whole per cent sent, 0 to 100. A file of unknown or zero size reads 0. */
export function uploadPercent(entry: Pick<UploadEntry, 'size' | 'loaded'>): number {
  if (!(entry.size > 0) || !(entry.loaded > 0)) return 0;
  return Math.min(100, Math.round((entry.loaded / entry.size) * 100));
}

/** The words beside the progress bar, as M0 words them. */
export function uploadProgressText(entry: Pick<UploadEntry, 'size' | 'loaded'>): string {
  const percent = uploadPercent(entry);
  return percent >= 100 ? 'Sent, waiting for the server…' : `${percent}%`;
}

export interface UploadSummary {
  readonly total: number;
  /** Waiting for their turn. */
  readonly queued: number;
  /** In flight: 0 or 1, the queue sends one file at a time. */
  readonly uploading: number;
  /** Accepted by the server (their check may still be running). */
  readonly done: number;
  /** Refused by the server, lost on the way, or never sent (empty, over the limit). */
  readonly problems: number;
  readonly cancelled: number;
  /** `queued + uploading`: what is still to happen. */
  readonly active: number;
}

export function summariseUploads(entries: readonly UploadEntry[]): UploadSummary {
  let queued = 0;
  let uploading = 0;
  let done = 0;
  let problems = 0;
  let cancelled = 0;
  for (const entry of entries) {
    if (entry.status === 'queued') queued += 1;
    else if (entry.status === 'uploading') uploading += 1;
    else if (entry.status === 'done') done += 1;
    else if (entry.status === 'cancelled') cancelled += 1;
    else problems += 1;
  }
  return {
    total: entries.length,
    queued,
    uploading,
    done,
    problems,
    cancelled,
    active: queued + uploading,
  };
}

/** "Uploading 2 of 5": the file in flight counted among all that were added. */
export function uploadingLabel(summary: UploadSummary): string {
  const position = Math.min(summary.total, summary.total - summary.active + 1);
  return `Uploading ${position} of ${summary.total}`;
}

/** What the server's check has come to for the accepted files of the queue. */
export interface UploadVerdictCounts {
  readonly ready: number;
  /** Accepted, no verdict yet. */
  readonly checking: number;
  readonly failed: number;
}

/**
 * The dialog's footer line. Null for an empty queue. Once nothing is waiting or in flight it
 * speaks about the server's check, not the sending: a file that was accepted and then failed
 * its check is not counted as ready.
 */
export function uploadFooterText(
  summary: UploadSummary,
  verdicts: UploadVerdictCounts,
): string | null {
  if (summary.total === 0) return null;
  if (summary.active > 0) return `${uploadingLabel(summary)}. Uploads carry on if you close this.`;
  const parts: string[] = [`${verdicts.ready} of ${summary.total} ready`];
  if (verdicts.checking > 0) parts.push(`${verdicts.checking} being checked`);
  if (verdicts.failed > 0) parts.push(`${verdicts.failed} failed the check`);
  if (summary.problems > 0) parts.push(`${summary.problems} not uploaded`);
  if (summary.cancelled > 0) parts.push(`${summary.cancelled} cancelled`);
  return parts.join(' · ');
}

export interface BackgroundUploads {
  readonly tone: 'busy' | 'warn';
  readonly label: string;
}

/**
 * What the page says about the queue while the dialog is closed: uploads still running, or
 * uploads that did not go through and have not been looked at. Null when there is nothing
 * to say (an empty queue, or only uploads that went through).
 */
export function backgroundUploads(summary: UploadSummary): BackgroundUploads | null {
  if (summary.active > 0) return { tone: 'busy', label: uploadingLabel(summary) };
  if (summary.problems > 0) {
    return {
      tone: 'warn',
      label:
        summary.problems === 1
          ? '1 upload did not complete'
          : `${summary.problems} uploads did not complete`,
    };
  }
  return null;
}

/**
 * The queue after the operator closed the dialog: what they have seen and what is finished
 * goes; what is waiting or in flight stays and carries on.
 */
export function withoutFinished(entries: readonly UploadEntry[]): UploadEntry[] {
  return entries.filter((entry) => !isFinished(entry));
}

/** The toast when uploads that carried on in the background have all ended. */
export function backgroundFinishedToast(summary: UploadSummary): {
  readonly tone: 'ok' | 'warn';
  readonly message: string;
} | null {
  if (summary.active > 0 || summary.total === 0) return null;
  if (summary.problems > 0) {
    return {
      tone: 'warn',
      message:
        summary.done === 0
          ? summary.problems === 1
            ? 'The upload did not complete'
            : `None of the ${summary.problems} uploads completed`
          : `${summary.problems} of ${summary.done + summary.problems} uploads did not complete`,
    };
  }
  if (summary.done === 0) return null;
  return {
    tone: 'ok',
    message: summary.done === 1 ? '1 file uploaded' : `${summary.done} files uploaded`,
  };
}

export type UploadVerdict =
  /** Accepted by the server; its check of the content has not finished. */
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly media: MediaDto }
  | { readonly kind: 'failed'; readonly media: MediaDto };

/**
 * What the server's check has come to for an uploaded file. `uploaded` is the answer of the
 * upload itself; `listed` is the same file in the library list, once a refresh has it. A
 * verdict (ready or failed) from either is final; until one arrives the file is being checked.
 */
export function uploadVerdict(uploaded: MediaDto, listed: MediaDto | undefined): UploadVerdict {
  for (const media of [listed, uploaded]) {
    if (media === undefined) continue;
    if (media.status === 'ready') return { kind: 'ready', media };
    if (media.status === 'failed') return { kind: 'failed', media };
  }
  return { kind: 'checking' };
}

/**
 * The verdict for one row of the queue: null until the server has accepted the file and its
 * answer (`uploaded`) is known. `countVerdicts` counts an accepted file without an answer as
 * being checked.
 */
export function entryVerdict(
  entry: Pick<UploadEntry, 'status'>,
  uploaded: MediaDto | undefined,
  listed: ReadonlyMap<string, MediaDto>,
): UploadVerdict | null {
  return entry.status === 'done' && uploaded !== undefined
    ? uploadVerdict(uploaded, listed.get(uploaded.id))
    : null;
}

/** Ready, being checked and failed among the accepted files, from the same data as the rows. */
export function countVerdicts(
  entries: readonly UploadEntry[],
  uploaded: ReadonlyMap<string, MediaDto>,
  listed: ReadonlyMap<string, MediaDto>,
): UploadVerdictCounts {
  let ready = 0;
  let checking = 0;
  let failed = 0;
  for (const entry of entries) {
    if (entry.status !== 'done') continue;
    const kind = entryVerdict(entry, uploaded.get(entry.id), listed)?.kind ?? 'checking';
    if (kind === 'ready') ready += 1;
    else if (kind === 'failed') failed += 1;
    else checking += 1;
  }
  return { ready, checking, failed };
}

/** True when a drag carries files from the computer (not text, a link or an element). */
export function dragHasFiles(types: readonly string[] | null | undefined): boolean {
  return types !== null && types !== undefined && Array.from(types).includes('Files');
}
