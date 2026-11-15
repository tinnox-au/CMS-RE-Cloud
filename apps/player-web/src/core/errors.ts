import { ABSOLUTE, type PlayerError, type PlayerErrorCode } from '@tinnox/contracts';

/** A failure with a protocol error code, safe to report in a heartbeat. */
export class PlayerFault extends Error {
  readonly code: PlayerErrorCode;
  readonly assetId: string | null;
  /** HTTP status when the fault came from an HTTP response. */
  readonly status: number | null;

  constructor(
    code: PlayerErrorCode,
    message: string,
    options: { assetId?: string | null; status?: number | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PlayerFault';
    this.code = code;
    this.assetId = options.assetId ?? null;
    this.status = options.status ?? null;
  }
}

/** The server answered 401: the device credential is no longer accepted. */
export class RevokedError extends Error {
  constructor() {
    super('device credential rejected by the server');
    this.name = 'RevokedError';
  }
}

/** Work was cancelled on purpose (reset, revocation, shutdown). Not a fault. */
export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new AbortedError();
}

export function isQuotaError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

/**
 * Makes a message safe to store and send: URLs are removed (a signed media URL
 * must never leave the player in a report) and the length is bounded.
 */
export function sanitiseMessage(text: string): string {
  const withoutUrls = text.replace(/\b(?:https?|blob|wss?):[^\s"'<>]+/gi, '[url]');
  const withoutTokens = withoutUrls.replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]');
  return withoutTokens.length > ABSOLUTE.maxErrorMessageLength
    ? `${withoutTokens.slice(0, ABSOLUTE.maxErrorMessageLength - 1)}…`
    : withoutTokens;
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message === '' ? err.name : err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}

export function toPlayerError(
  err: unknown,
  context: {
    at: string;
    publicationId: string | null;
    assetId?: string | null;
    fallbackCode?: PlayerErrorCode;
  },
): PlayerError {
  const code: PlayerErrorCode =
    err instanceof PlayerFault
      ? err.code
      : isQuotaError(err)
        ? 'quota_exceeded'
        : (context.fallbackCode ?? 'internal_error');
  const assetId = (err instanceof PlayerFault ? err.assetId : null) ?? context.assetId ?? null;
  return {
    code,
    message: sanitiseMessage(describeError(err)),
    at: context.at,
    publicationId: context.publicationId,
    assetId,
  };
}

/** Errors about running the content on screen, as opposed to fetching or storing it. */
const PLAYBACK_CODES: ReadonlySet<PlayerErrorCode> = new Set(['decode_failed', 'playback_error']);
/** Errors that a later successful contact with the server proves are over. */
const CONTACT_CODES: ReadonlySet<PlayerErrorCode> = new Set([
  'network_error',
  'auth_rejected',
  'manifest_malformed',
  'manifest_unsupported_version',
]);
/** How long a still-relevant error is reported after the last time it happened. */
export const ERROR_RETENTION_MS = 60 * 60 * 1000;

/**
 * After a successful sync cycle (the server answered and the active version is the one
 * it wants), an error is still worth reporting only if it is a playback problem of the
 * active version, or an unattributed local problem (storage, internal), and it happened
 * within the last hour. Delivery errors of any version and contact errors are resolved.
 */
export function stillRelevant(
  error: PlayerError,
  activePublicationId: string | null,
  nowMs: number,
): boolean {
  const at = Date.parse(error.at);
  if (!Number.isFinite(at) || nowMs - at > ERROR_RETENTION_MS) return false;
  if (CONTACT_CODES.has(error.code)) return false;
  if (PLAYBACK_CODES.has(error.code)) {
    return activePublicationId !== null && error.publicationId === activePublicationId;
  }
  return error.publicationId === null;
}

/**
 * Bounded list of recent problems, newest first. A repeat of the newest entry
 * replaces it instead of growing the list, so a failing retry loop cannot push
 * out older, different problems.
 */
export class ErrorLog {
  readonly #max: number;
  #items: PlayerError[];

  constructor(initial: readonly PlayerError[] = [], max: number = ABSOLUTE.maxHeartbeatErrors) {
    this.#max = Math.max(1, max);
    this.#items = initial.slice(0, this.#max);
  }

  add(error: PlayerError): void {
    const clean: PlayerError = { ...error, message: sanitiseMessage(error.message) };
    const newest = this.#items[0];
    if (
      newest !== undefined &&
      newest.code === clean.code &&
      newest.assetId === clean.assetId &&
      newest.publicationId === clean.publicationId
    ) {
      this.#items[0] = clean;
      return;
    }
    this.#items = [clean, ...this.#items].slice(0, this.#max);
  }

  list(): readonly PlayerError[] {
    return this.#items;
  }

  /**
   * Drops what a successful sync cycle has resolved (see `stillRelevant`). Returns true
   * when anything was removed.
   */
  resolveAfterSync(activePublicationId: string | null, nowMs: number): boolean {
    const kept = this.#items.filter((e) => stillRelevant(e, activePublicationId, nowMs));
    if (kept.length === this.#items.length) return false;
    this.#items = kept;
    return true;
  }

  clear(): void {
    this.#items = [];
  }
}
