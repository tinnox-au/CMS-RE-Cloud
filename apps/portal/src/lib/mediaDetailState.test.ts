import { describe, expect, it } from 'vitest';
import {
  addedToPlaylistMessage,
  deletedMessage,
  headerStatusLabel,
  mediaLoadProblem,
  mediaPollInterval,
  pendingStateText,
  PROCESSING_POLL_MS,
  saveRefusalNeedsReload,
  staleListsAfterSave,
} from './mediaDetailState.ts';

const refusal = (status: number, code: string, paths: readonly string[] = []) => ({
  status,
  code,
  details: paths.map((path) => ({ path, message: 'x' })),
});

describe('mediaPollInterval', () => {
  it('polls only while the file is being checked', () => {
    expect(mediaPollInterval({ status: 'processing' })).toBe(PROCESSING_POLL_MS);
    expect(mediaPollInterval({ status: 'ready' })).toBeNull();
    expect(mediaPollInterval({ status: 'failed' })).toBeNull();
  });
});

describe('mediaLoadProblem', () => {
  it('reads an unknown or foreign id as missing', () => {
    expect(mediaLoadProblem(refusal(404, 'not_found'))).toBe('missing');
  });

  it('reads an address without a valid id as missing', () => {
    expect(mediaLoadProblem(refusal(400, 'validation_failed', ['id']))).toBe('missing');
  });

  it('keeps other refusals and transport failures as failures that may pass', () => {
    expect(mediaLoadProblem(refusal(400, 'validation_failed', ['name']))).toBe('failed');
    expect(mediaLoadProblem(refusal(500, 'internal'))).toBe('failed');
    expect(mediaLoadProblem(refusal(0, 'network_error'))).toBe('failed');
    expect(mediaLoadProblem(null)).toBe('failed');
  });
});

describe('headerStatusLabel', () => {
  it('says whether there is something to save', () => {
    expect(headerStatusLabel(true)).toBe('Unsaved changes');
    expect(headerStatusLabel(false)).toBe('Saved');
  });
});

describe('staleListsAfterSave', () => {
  it('names the lists whose counts changed', () => {
    expect(staleListsAfterSave({ name: 'A' })).toEqual({ tags: false, folders: false });
    expect(staleListsAfterSave({ tagIds: [] })).toEqual({ tags: true, folders: false });
    expect(staleListsAfterSave({ folderId: null })).toEqual({ tags: false, folders: true });
  });
});

describe('saveRefusalNeedsReload', () => {
  it('reloads after a 404 on a save that named a folder or tags', () => {
    expect(saveRefusalNeedsReload(refusal(404, 'not_found'), { folderId: null })).toBe(true);
    expect(saveRefusalNeedsReload(refusal(404, 'not_found'), { tagIds: [] })).toBe(true);
    expect(saveRefusalNeedsReload(refusal(404, 'not_found'), { name: 'A' })).toBe(false);
  });

  it('reloads after a conflict and not after other refusals', () => {
    expect(saveRefusalNeedsReload(refusal(409, 'conflict'), { name: 'A' })).toBe(true);
    expect(saveRefusalNeedsReload(refusal(400, 'validation_failed'), { name: 'A' })).toBe(false);
    expect(saveRefusalNeedsReload(null, { name: 'A' })).toBe(false);
  });
});

describe('messages', () => {
  it('words additions and deletions', () => {
    expect(addedToPlaylistMessage('Foyer loop')).toBe('Added to Foyer loop');
    expect(deletedMessage('Menu board')).toBe('“Menu board” was deleted');
  });

  it('never calls a screen a display and never says online', () => {
    for (const status of ['processing', 'failed'] as const) {
      const text = pendingStateText(status);
      const all = `${text.title} ${text.text}`.toLowerCase();
      expect(all).not.toMatch(/display|online|offline/);
    }
  });
});
