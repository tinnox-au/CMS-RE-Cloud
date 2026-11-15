/**
 * Throttle for failed device authentication on the credentialed player routes.
 *
 * The per-route rate limit of those routes is keyed by the credential, which is right
 * for real players (many can share one address) but gives every invented token a fresh
 * bucket. This guard counts failed lookups per client address instead. Once an address
 * has used up its budget, requests from it are refused before any database lookup,
 * unless they carry a credential that was verified recently (a real player behind the
 * same address keeps working). A credential that fails is forgotten at once, so a
 * revoked player cannot use the exception.
 *
 * In memory and per process, like the other rate limits in M0.
 */
import { isIPv6 } from 'node:net';

export interface FailureGuardOptions {
  /** Failed lookups allowed per client address in one window. */
  readonly maxFailures: number;
  readonly windowMs: number;
  /** Bounds on memory: tracked addresses and remembered good credentials. */
  readonly maxClients?: number;
  readonly maxCredentials?: number;
  /** How long a verified credential is remembered. */
  readonly credentialTtlMs?: number;
  readonly now: () => number;
}

export interface FailureRecord {
  /** Failures from this client in the current window, including this one. */
  readonly count: number;
  /** True for the first failure of the window. */
  readonly first: boolean;
  /** True exactly when this failure used up the budget. */
  readonly crossedLimit: boolean;
}

interface Window {
  start: number;
  count: number;
}

/**
 * Key for an address: IPv4 as is (also when IPv4-mapped), IPv6 by its /64 prefix,
 * because one host usually controls a whole /64.
 */
export function clientKeyOf(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped?.[1] !== undefined) return mapped[1];
  if (!isIPv6(address)) return address;
  const [head = '', tail = ''] = address.toLowerCase().split('::', 2);
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const groups = address.includes('::')
    ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

export class AuthFailureGuard {
  readonly #maxFailures: number;
  readonly #windowMs: number;
  readonly #maxClients: number;
  readonly #maxCredentials: number;
  readonly #credentialTtlMs: number;
  readonly #now: () => number;
  readonly #clients = new Map<string, Window>();
  readonly #verified = new Map<string, number>();

  constructor(options: FailureGuardOptions) {
    this.#maxFailures = Math.max(1, Math.floor(options.maxFailures));
    this.#windowMs = Math.max(1, options.windowMs);
    this.#maxClients = options.maxClients ?? 10_000;
    this.#maxCredentials = options.maxCredentials ?? 10_000;
    this.#credentialTtlMs = options.credentialTtlMs ?? 15 * 60 * 1000;
    this.#now = options.now;
  }

  #window(client: string): Window | null {
    const entry = this.#clients.get(client);
    if (entry === undefined) return null;
    if (this.#now() - entry.start >= this.#windowMs) {
      this.#clients.delete(client);
      return null;
    }
    return entry;
  }

  #recentlyVerified(credential: string): boolean {
    const at = this.#verified.get(credential);
    if (at === undefined) return false;
    if (this.#now() - at >= this.#credentialTtlMs) {
      this.#verified.delete(credential);
      return false;
    }
    return true;
  }

  /** True when the request must be refused without looking the credential up. */
  isBlocked(clientAddress: string, credential: string): boolean {
    const entry = this.#window(clientKeyOf(clientAddress));
    if (entry === null || entry.count < this.#maxFailures) return false;
    return !this.#recentlyVerified(credential);
  }

  /** Seconds until the client's window ends (for Retry-After). */
  retryAfterSeconds(clientAddress: string): number {
    const entry = this.#window(clientKeyOf(clientAddress));
    if (entry === null) return 1;
    return Math.max(1, Math.ceil((entry.start + this.#windowMs - this.#now()) / 1000));
  }

  recordFailure(clientAddress: string, credential: string): FailureRecord {
    this.#verified.delete(credential);
    const client = clientKeyOf(clientAddress);
    let entry = this.#window(client);
    if (entry === null) {
      if (this.#clients.size >= this.#maxClients) {
        // Oldest entry first (insertion order); bounded memory beats perfect memory.
        const oldest = this.#clients.keys().next();
        if (oldest.done !== true) this.#clients.delete(oldest.value);
      }
      entry = { start: this.#now(), count: 0 };
      this.#clients.set(client, entry);
    }
    entry.count += 1;
    return {
      count: entry.count,
      first: entry.count === 1,
      crossedLimit: entry.count === this.#maxFailures,
    };
  }

  recordSuccess(credential: string): void {
    this.#verified.delete(credential);
    if (this.#verified.size >= this.#maxCredentials) {
      const oldest = this.#verified.keys().next();
      if (oldest.done !== true) this.#verified.delete(oldest.value);
    }
    this.#verified.set(credential, this.#now());
  }
}
