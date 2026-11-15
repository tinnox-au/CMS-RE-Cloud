import type { PlayerError, PlayerErrorCode } from '@tinnox/contracts';
import { describe, expect, it } from 'vitest';
import { ERROR_RETENTION_MS, ErrorLog, stillRelevant } from './errors.ts';

const NOW = Date.parse('2026-11-14T10:00:00.000Z');
const ACTIVE = '11111111-1111-4111-8111-111111111111';
const OLDER = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

function error(
  code: PlayerErrorCode,
  publicationId: string | null,
  agoMs = 60_000,
  assetId: string | null = ASSET,
): PlayerError {
  return {
    code,
    message: code,
    at: new Date(NOW - agoMs).toISOString(),
    publicationId,
    assetId,
  };
}

describe('errors after a successful sync cycle', () => {
  it('drops delivery and contact errors, which the successful cycle has resolved', () => {
    for (const e of [
      error('network_error', null, 60_000, null),
      error('network_error', ACTIVE),
      error('integrity_mismatch', OLDER),
      error('download_failed', ACTIVE),
      error('size_mismatch', ACTIVE),
      error('quota_exceeded', OLDER),
      error('manifest_malformed', null, 60_000, null),
      error('auth_rejected', null, 60_000, null),
    ]) {
      expect(stillRelevant(e, ACTIVE, NOW), `${e.code} ${e.publicationId}`).toBe(false);
    }
  });

  it('keeps recent playback errors of the active version and recent local problems', () => {
    expect(stillRelevant(error('decode_failed', ACTIVE), ACTIVE, NOW)).toBe(true);
    expect(stillRelevant(error('playback_error', ACTIVE), ACTIVE, NOW)).toBe(true);
    expect(stillRelevant(error('storage_error', null, 60_000, null), ACTIVE, NOW)).toBe(true);
    // ... but not playback errors of a version that is no longer active, nor old ones.
    expect(stillRelevant(error('playback_error', OLDER), ACTIVE, NOW)).toBe(false);
    expect(stillRelevant(error('playback_error', ACTIVE), null, NOW)).toBe(false);
    expect(stillRelevant(error('decode_failed', ACTIVE, ERROR_RETENTION_MS + 1), ACTIVE, NOW)).toBe(
      false,
    );
    expect(
      stillRelevant(error('internal_error', null, ERROR_RETENTION_MS + 1, null), ACTIVE, NOW),
    ).toBe(false);
  });

  it('ErrorLog.resolveAfterSync removes only what is resolved and says whether it changed', () => {
    const log = new ErrorLog([
      error('network_error', null, 10_000, null),
      error('decode_failed', ACTIVE, 20_000),
      error('integrity_mismatch', OLDER, 30_000),
    ]);
    expect(log.resolveAfterSync(ACTIVE, NOW)).toBe(true);
    expect(log.list().map((e) => e.code)).toEqual(['decode_failed']);
    expect(log.resolveAfterSync(ACTIVE, NOW)).toBe(false);
  });
});
