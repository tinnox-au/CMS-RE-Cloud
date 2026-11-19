import { describe, expect, it } from 'vitest';
import { ID, media } from './mediaLibrary.test-support.ts';
import {
  backgroundFinishedToast,
  backgroundUploads,
  countVerdicts,
  dragHasFiles,
  entryVerdict,
  summariseUploads,
  uploadFooterText,
  uploadingLabel,
  uploadPercent,
  uploadProgressText,
  uploadVerdict,
  withoutFinished,
} from './mediaLibraryUploads.ts';
import type { UploadEntry, UploadStatus } from './uploadQueue.ts';

function entry(id: string, status: UploadStatus, loaded = 0, size = 100): UploadEntry {
  return { id, name: `${id}.png`, size, status, loaded, localMessage: null, error: null };
}

describe('upload progress', () => {
  it('gives whole per cent and the M0 words at the end', () => {
    expect(uploadPercent({ size: 0, loaded: 0 })).toBe(0);
    expect(uploadPercent({ size: 200, loaded: 50 })).toBe(25);
    expect(uploadPercent({ size: 100, loaded: 150 })).toBe(100);
    expect(uploadProgressText({ size: 200, loaded: 50 })).toBe('25%');
    expect(uploadProgressText({ size: 100, loaded: 100 })).toBe('Sent, waiting for the server…');
  });
});

describe('upload summaries', () => {
  const entries = [
    entry('a', 'done'),
    entry('b', 'uploading', 40),
    entry('c', 'queued'),
    entry('d', 'failed'),
    entry('e', 'rejected'),
    entry('f', 'cancelled'),
  ];

  it('counts each state', () => {
    expect(summariseUploads(entries)).toEqual({
      total: 6,
      queued: 1,
      uploading: 1,
      done: 1,
      problems: 2,
      cancelled: 1,
      active: 2,
    });
  });

  it('words the footer while running and once finished', () => {
    const none = { ready: 0, checking: 0, failed: 0 };
    const running = summariseUploads(entries);
    expect(uploadingLabel(running)).toBe('Uploading 5 of 6');
    expect(uploadFooterText(running, { ...none, failed: 1 })).toBe(
      'Uploading 5 of 6. Uploads carry on if you close this.',
    );
    const finished = summariseUploads([
      entry('a', 'done'),
      entry('d', 'failed'),
      entry('f', 'cancelled'),
    ]);
    expect(uploadFooterText(finished, { ...none, ready: 1 })).toBe(
      '1 of 3 ready · 1 not uploaded · 1 cancelled',
    );
    expect(uploadFooterText(summariseUploads([]), none)).toBeNull();
  });

  it('counts a file that failed the check apart from the ready ones (T4.3)', () => {
    const four = summariseUploads(['a', 'b', 'c', 'd'].map((id) => entry(id, 'done')));
    expect(uploadFooterText(four, { ready: 4, checking: 0, failed: 0 })).toBe('4 of 4 ready');
    expect(uploadFooterText(four, { ready: 2, checking: 2, failed: 0 })).toBe(
      '2 of 4 ready · 2 being checked',
    );
    const seven = summariseUploads([
      ...['a', 'b', 'c', 'd', 'e'].map((id) => entry(id, 'done')),
      entry('f', 'rejected'),
      entry('g', 'failed'),
    ]);
    expect(uploadFooterText(seven, { ready: 0, checking: 0, failed: 5 })).toBe(
      '0 of 7 ready · 5 failed the check · 2 not uploaded',
    );
  });

  it('takes each verdict from the same data as the rows', () => {
    const uploaded = new Map([
      ['a', media(1, 'image', { status: 'processing' })],
      ['b', media(2, 'image', { status: 'processing' })],
      ['c', media(3, 'image', { status: 'processing' })],
      ['d', media(4, 'image')],
    ]);
    const listed = new Map([
      [ID(2), media(2, 'image')],
      [ID(3), media(3, 'image', { status: 'failed' })],
    ]);
    const queue = [
      entry('a', 'done'),
      entry('b', 'done'),
      entry('c', 'done'),
      entry('d', 'done'),
      entry('e', 'done'),
      entry('f', 'failed'),
      entry('g', 'uploading'),
    ];
    expect(countVerdicts(queue, uploaded, listed)).toEqual({ ready: 2, checking: 2, failed: 1 });
    expect(entryVerdict(entry('a', 'done'), uploaded.get('a'), listed)?.kind).toBe('checking');
    expect(entryVerdict(entry('c', 'done'), uploaded.get('c'), listed)?.kind).toBe('failed');
    expect(entryVerdict(entry('e', 'done'), undefined, listed)).toBeNull();
    expect(entryVerdict(entry('f', 'failed'), uploaded.get('a'), listed)).toBeNull();
  });

  it('says what carries on behind a closed dialog', () => {
    expect(backgroundUploads(summariseUploads(entries))).toEqual({
      tone: 'busy',
      label: 'Uploading 5 of 6',
    });
    expect(backgroundUploads(summariseUploads([entry('d', 'failed')]))).toEqual({
      tone: 'warn',
      label: '1 upload did not complete',
    });
    expect(backgroundUploads(summariseUploads([entry('a', 'done')]))).toBeNull();
    expect(withoutFinished(entries).map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('reports how background uploads ended, honestly', () => {
    expect(backgroundFinishedToast(summariseUploads([entry('b', 'uploading')]))).toBeNull();
    expect(
      backgroundFinishedToast(summariseUploads([entry('a', 'done'), entry('b', 'done')])),
    ).toEqual({ tone: 'ok', message: '2 files uploaded' });
    expect(
      backgroundFinishedToast(summariseUploads([entry('a', 'done'), entry('d', 'failed')])),
    ).toEqual({ tone: 'warn', message: '1 of 2 uploads did not complete' });
    expect(backgroundFinishedToast(summariseUploads([entry('d', 'failed')]))).toEqual({
      tone: 'warn',
      message: 'The upload did not complete',
    });
    expect(backgroundFinishedToast(summariseUploads([entry('f', 'cancelled')]))).toBeNull();
  });
});

describe('the server’s verdict on an uploaded file', () => {
  it('waits for ready or failed from the upload answer or the list', () => {
    const uploaded = media(1, 'image', { status: 'processing' });
    expect(uploadVerdict(uploaded, undefined).kind).toBe('checking');
    expect(uploadVerdict(uploaded, media(1, 'image')).kind).toBe('ready');
    expect(uploadVerdict(uploaded, media(1, 'image', { status: 'failed' })).kind).toBe('failed');
    expect(uploadVerdict(media(1, 'image'), undefined).kind).toBe('ready');
  });

  it('takes only drags that carry files', () => {
    expect(dragHasFiles(['Files'])).toBe(true);
    expect(dragHasFiles(['text/plain', 'text/uri-list'])).toBe(false);
    expect(dragHasFiles(undefined)).toBe(false);
  });
});
