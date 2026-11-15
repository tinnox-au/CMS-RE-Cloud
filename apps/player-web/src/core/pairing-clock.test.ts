import { describe, expect, it } from 'vitest';
import {
  canReusePairing,
  localPairingDeadline,
  pairingAbandoned,
  pairingSecondsLeft,
  PAIRING_EXPIRY_SLACK_MS,
} from './pairing-clock.ts';

const SERVER_NOW = Date.parse('2026-11-14T10:00:00.000Z');
const TTL_S = 600;

describe('pairing timing on a device with a wrong clock', () => {
  for (const [label, skewMs] of [
    ['correct clock', 0],
    ['11 minutes fast', 11 * 60_000],
    ['3 hours slow', -3 * 3_600_000],
    ['2 days fast', 2 * 86_400_000],
  ] as const) {
    it(`${label}: a fresh code shows its full lifetime and is not abandoned early`, () => {
      const deviceNow = SERVER_NOW + skewMs;
      const deadline = localPairingDeadline(deviceNow, TTL_S);
      expect(pairingSecondsLeft(deadline, deviceNow)).toBe(TTL_S);
      expect(pairingAbandoned(deadline, deviceNow)).toBe(false);
      expect(pairingAbandoned(deadline, deviceNow + TTL_S * 1000)).toBe(false);
      expect(pairingAbandoned(deadline, deviceNow + TTL_S * 1000 + PAIRING_EXPIRY_SLACK_MS)).toBe(
        true,
      );
      // After a reload 5 minutes later the stored code is still reused.
      expect(canReusePairing(deadline, deviceNow + 300_000, 20_000)).toBe(true);
      expect(canReusePairing(deadline, deviceNow + 590_000, 20_000)).toBe(false);
    });
  }

  it('the old comparison of server expiry with the device clock failed for a fast clock', () => {
    // Documents the defect this module replaces: expiresAt (server) <= Date.now() (device).
    const serverExpiresAt = SERVER_NOW + TTL_S * 1000;
    const deviceNow = SERVER_NOW + 11 * 60_000;
    expect(deviceNow >= serverExpiresAt).toBe(true);
    expect(pairingAbandoned(localPairingDeadline(deviceNow, TTL_S), deviceNow)).toBe(false);
  });

  it('never counts below zero', () => {
    expect(pairingSecondsLeft(1000, 5000)).toBe(0);
  });
});
