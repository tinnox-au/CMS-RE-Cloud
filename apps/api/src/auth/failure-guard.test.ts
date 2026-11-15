import { describe, expect, it } from 'vitest';
import { AuthFailureGuard, clientKeyOf } from './failure-guard.ts';

function guard(maxFailures = 3, windowMs = 60_000) {
  let now = 1_000_000;
  const g = new AuthFailureGuard({ maxFailures, windowMs, now: () => now, maxClients: 3 });
  return {
    g,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('AuthFailureGuard', () => {
  it('blocks an address once it has used up its failure budget, whatever token it sends next', () => {
    const { g } = guard();
    expect(g.isBlocked('203.0.113.9', 'a')).toBe(false);
    expect(g.recordFailure('203.0.113.9', 'a')).toEqual({
      count: 1,
      first: true,
      crossedLimit: false,
    });
    g.recordFailure('203.0.113.9', 'b');
    expect(g.isBlocked('203.0.113.9', 'c')).toBe(false);
    expect(g.recordFailure('203.0.113.9', 'c')).toEqual({
      count: 3,
      first: false,
      crossedLimit: true,
    });
    expect(g.isBlocked('203.0.113.9', 'never-seen')).toBe(true);
    // Another address is unaffected.
    expect(g.isBlocked('198.51.100.1', 'never-seen')).toBe(false);
  });

  it('lets a recently verified credential through a blocked address, but not after it fails', () => {
    const { g } = guard();
    g.recordSuccess('good');
    for (const t of ['x', 'y', 'z']) g.recordFailure('203.0.113.9', t);
    expect(g.isBlocked('203.0.113.9', 'good')).toBe(false);
    // The good credential is revoked: its failure removes the exception.
    g.recordFailure('203.0.113.9', 'good');
    expect(g.isBlocked('203.0.113.9', 'good')).toBe(true);
  });

  it('opens again when the window ends and reports the remaining time', () => {
    const { g, advance } = guard(2, 60_000);
    g.recordFailure('203.0.113.9', 'a');
    g.recordFailure('203.0.113.9', 'b');
    advance(20_000);
    expect(g.isBlocked('203.0.113.9', 'c')).toBe(true);
    expect(g.retryAfterSeconds('203.0.113.9')).toBe(40);
    advance(40_000);
    expect(g.isBlocked('203.0.113.9', 'c')).toBe(false);
    expect(g.recordFailure('203.0.113.9', 'c').first).toBe(true);
  });

  it('forgets verified credentials after their lifetime', () => {
    let now = 0;
    const g = new AuthFailureGuard({
      maxFailures: 1,
      windowMs: 10 * 60_000,
      credentialTtlMs: 60_000,
      now: () => now,
    });
    g.recordSuccess('good');
    g.recordFailure('203.0.113.9', 'bad');
    expect(g.isBlocked('203.0.113.9', 'good')).toBe(false);
    now += 61_000;
    expect(g.isBlocked('203.0.113.9', 'good')).toBe(true);
  });

  it('keeps memory bounded by evicting the oldest address', () => {
    const { g } = guard(1);
    g.recordFailure('192.0.2.1', 'a');
    g.recordFailure('192.0.2.2', 'a');
    g.recordFailure('192.0.2.3', 'a');
    g.recordFailure('192.0.2.4', 'a');
    expect(g.isBlocked('192.0.2.1', 'z')).toBe(false);
    expect(g.isBlocked('192.0.2.4', 'z')).toBe(true);
  });

  it('treats every address of one IPv6 /64 as one client', () => {
    const { g } = guard(2);
    g.recordFailure('2001:db8:1:2::1', 'a');
    g.recordFailure('2001:db8:1:2:ffff:ffff:ffff:fffe', 'b');
    expect(g.isBlocked('2001:db8:1:2:abcd::9', 'c')).toBe(true);
    expect(g.isBlocked('2001:db8:1:3::1', 'c')).toBe(false);
  });
});

describe('clientKeyOf', () => {
  it('normalises addresses', () => {
    expect(clientKeyOf('203.0.113.9')).toBe('203.0.113.9');
    expect(clientKeyOf('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(clientKeyOf('2001:0db8:0001:0002:0000:0000:0000:0001')).toBe('2001:db8:1:2::/64');
    expect(clientKeyOf('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKeyOf('::1')).toBe('0:0:0:0::/64');
  });
});
