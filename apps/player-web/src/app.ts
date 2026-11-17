import {
  manifestPlaylists,
  manifestV2Facts,
  type PairingPollResponse,
  type PlayerError,
} from '@tinnox/contracts';
import { API_ORIGIN, IS_PRODUCTION_BUILD, PLAYER_VERSION } from './config.ts';
import { backoffDelay, type BackoffPolicy } from './core/backoff.ts';
import { describeError, ErrorLog, sanitiseMessage, toPlayerError } from './core/errors.ts';
import { retryAfterMsOf, retryDelay } from './core/retry-after.ts';
import { HeartbeatLoop, type HeartbeatSnapshot } from './core/heartbeat.ts';
import {
  canReusePairing,
  localPairingDeadline,
  pairingAbandoned,
  pairingSecondsLeft,
} from './core/pairing-clock.ts';
import { heartbeatStateFor, PlayerMachine, type PlayerPhase } from './core/machine.ts';
import { PlaybackLoop, type PlaybackEvent } from './core/playback.ts';
import { SyncLoop } from './core/sync.ts';
import { coveringSlices, localWallClock } from './core/time-rules.ts';
import { sleep, systemClock } from './core/timing.ts';
import type { PairingRecord, RegistrationRecord, StagingRecord } from './core/types.ts';
import { PlayerHttpApi } from './platform/api.ts';
import {
  CacheAssetStore,
  deleteAllMediaCaches,
  mediaCacheName,
  requestPersistence,
  storageEstimate,
} from './platform/cache-assets.ts';
import { IdbStateStore } from './platform/idb-store.ts';
import { acquireLeadership, type LeadershipMode } from './platform/leader.ts';
import { probeAsset, sha256Hex } from './platform/media.ts';
import { registerShellWorker, shellCacheStatus } from './platform/sw-register.ts';
import { Diagnostics, type DiagnosticsModel } from './ui/diagnostics.ts';
import { DomPresenter, FADE_MS } from './ui/presenter.ts';
import { Screens } from './ui/screens.ts';

const PAIRING_BACKOFF: BackoffPolicy = { baseMs: 5_000, maxMs: 2 * 60_000, factor: 2, jitter: 0.5 };
/** A stored pairing session is reused after a reload only if it has at least this long left. */
const PAIRING_MIN_REMAINING_MS = 20_000;
/** A session that ends sooner than this counts as a failure, so a refusing server is not hammered. */
const PAIRING_SHORT_LIVED_MS = 30_000;
const WIPE_TIMEOUT_MS = 4_000;
const RELEASE_TIMEOUT_MS = 3_000;
/** Pause before reloading after the storage connection was lost (lets a blocked upgrade finish). */
const STORAGE_LOST_RELOAD_MS = 2_000;

const WAITING_TEXT = 'Waiting for content';
const FAULT_TEXT =
  'The published content cannot be played in this browser. The problem has been reported.';

/** Everything that exists only while the player is registered. Dropped as a whole. */
interface Session {
  readonly registration: RegistrationRecord;
  readonly abort: AbortController;
  readonly sync: SyncLoop;
  readonly heartbeat: HeartbeatLoop;
  readonly playback: PlaybackLoop;
  readonly presenter: DomPresenter;
  /** Tells the server this player gives up its credential. Best effort. */
  readonly release: () => Promise<boolean>;
  staging: StagingRecord | null;
  rendering: { publicationId: string; itemIndex: number } | null;
}

function bytes(value: number): string {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/** Wires the state machine, storage, network loops, renderer and screens together. */
export class PlayerApp {
  readonly #stage: HTMLElement;
  readonly #screens: Screens;
  readonly #diagnostics: Diagnostics;
  readonly #api = new PlayerHttpApi(API_ORIGIN);
  readonly #machine: PlayerMachine;
  #store: IdbStateStore | null = null;
  #errors = new ErrorLog();
  #session: Session | null = null;
  #pairingAbort: AbortController | null = null;
  #pairingCode: PairingRecord | null = null;
  #persisted: boolean | null = null;
  #leadership: LeadershipMode | 'waiting' = 'waiting';
  /** Server time minus local time, from the last heartbeat response; working hours read this clock. */
  // shortcut: offset ignores round-trip time; halve RTT if minute edges must be exact.
  #clockOffsetMs = 0;
  #revokedDisplayName: string | null = null;
  #reloading = false;

  constructor(stage: HTMLElement, screenRoot: HTMLElement, diagnosticsRoot: HTMLElement) {
    this.#stage = stage;
    this.#screens = new Screens(screenRoot);
    this.#diagnostics = new Diagnostics(
      diagnosticsRoot,
      () => this.#diagnosticsModel(),
      () => void this.reset(),
    );
    this.#machine = new PlayerMachine(
      (phase) => {
        document.documentElement.dataset.playerPhase = phase;
        this.#session?.heartbeat.notifyChange();
      },
      (phase, event) => {
        console.warn(`player: event ${event.type} ignored in phase ${phase}`);
      },
    );
    document.documentElement.dataset.playerPhase = this.#machine.phase;
  }

  get phase(): PlayerPhase {
    return this.#machine.phase;
  }

  toggleDiagnostics(): void {
    this.#diagnostics.toggle();
  }

  closeDiagnostics(): void {
    this.#diagnostics.close();
  }

  async boot(): Promise<void> {
    this.#screens.starting('Starting…');
    this.#leadership = await acquireLeadership(() => {
      this.#machine.dispatch({ type: 'LEADERSHIP_WAITING' });
      this.#screens.standby();
    });
    void registerShellWorker(IS_PRODUCTION_BUILD);

    let store: IdbStateStore;
    try {
      store = await IdbStateStore.open(undefined, {
        onConnectionLost: (reason) => {
          this.#onStorageLost(reason);
        },
      });
    } catch (err) {
      this.#screens.fatal(
        'This browser will not store player data',
        `The player needs IndexedDB and Cache Storage. Private or restricted browsing modes often block them. (${sanitiseMessage(describeError(err))})`,
      );
      return;
    }
    this.#store = store;
    this.#persisted = await requestPersistence();
    this.#errors = new ErrorLog(await store.getErrors().catch(() => []));

    addEventListener('online', () => {
      this.#session?.sync.wake();
      this.#session?.heartbeat.notifyChange();
    });
    addEventListener('offline', () => {
      this.#session?.heartbeat.notifyChange();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.#session?.sync.wake();
        this.#session?.heartbeat.notifyChange();
      }
    });

    const registration = await store.getRegistration();
    if (registration === null) {
      // Not registered: nothing cached may remain from any earlier registration.
      await this.#purgeMedia(null);
      this.#machine.dispatch({ type: 'NO_REGISTRATION' });
      void this.#pairingLoop();
      return;
    }
    if (registration.revokedAt !== null || registration.deviceToken === null) {
      await this.#purgeMedia(null);
      this.#revokedDisplayName = registration.display.name;
      this.#machine.dispatch({ type: 'REVOKED_REGISTRATION_LOADED' });
      this.#screens.revoked(registration.display.name, () => void this.reset());
      return;
    }
    await this.#purgeMedia(mediaCacheName(registration.orgId, registration.registrationId));
    this.#machine.dispatch({ type: 'REGISTRATION_LOADED' });
    this.#startSession(registration, registration.deviceToken);
  }

  /** Deletes every media cache except `keep`. Failure is recorded, never fatal. */
  async #purgeMedia(keep: string | null): Promise<void> {
    try {
      if (keep === null) {
        await deleteAllMediaCaches(caches);
        return;
      }
      for (const name of await caches.keys()) {
        if (name.startsWith('tinnox-media-') && name !== keep) await caches.delete(name);
      }
    } catch (err) {
      this.#report(
        toPlayerError(err, {
          at: new Date().toISOString(),
          publicationId: null,
          fallbackCode: 'storage_error',
        }),
      );
    }
  }

  /**
   * The IndexedDB connection is gone (a newer build or a reset in another tab needs the
   * database, or the browser closed it). No further state can be read or written, so
   * carrying on would keep stale content on screen with no updates and no reports.
   * Stop everything and reload; the next start reopens the database (whatever its
   * version) and resumes from the cache, or pairs again if the data is gone.
   */
  #onStorageLost(reason: 'blocking' | 'terminated'): void {
    if (this.#machine.phase === 'resetting' || this.#reloading) return;
    this.#reloading = true;
    console.warn(`player: storage connection lost (${reason}); restarting`);
    this.#pairingAbort?.abort();
    const session = this.#session;
    this.#session = null;
    session?.abort.abort();
    this.#store = null;
    this.#screens.starting('Player storage was closed by the browser. Restarting…');
    setTimeout(() => {
      location.reload();
    }, STORAGE_LOST_RELOAD_MS);
  }

  #report(error: PlayerError): void {
    this.#errors.add(error);
    void this.#store?.putErrors(this.#errors.list()).catch(() => undefined);
    this.#session?.heartbeat.notifyChange();
  }

  // ───────────────────────────── pairing ─────────────────────────────

  async #pairingLoop(): Promise<void> {
    const store = this.#store;
    if (store === null) return;
    const abort = new AbortController();
    this.#pairingAbort = abort;
    const { signal } = abort;
    let failures = 0;
    let note: string | null = null;
    let retryAfterMs: number | null = null;

    while (!signal.aborted) {
      let record = await store.getPairing().catch(() => null);
      if (
        record !== null &&
        !canReusePairing(record.localExpiresAtMs, Date.now(), PAIRING_MIN_REMAINING_MS)
      ) {
        record = null;
      }
      if (record === null) {
        this.#screens.unpaired(note);
        if (failures > 0) {
          try {
            await sleep(
              retryDelay(backoffDelay(PAIRING_BACKOFF, failures, Math.random), retryAfterMs),
              signal,
            );
          } catch {
            return;
          }
          retryAfterMs = null;
        }
        try {
          const created = await this.#api.createPairing(signal);
          record = {
            pairingId: created.pairingId,
            code: created.code,
            pollingToken: created.pollingToken,
            expiresAt: created.expiresAt,
            // The device clock may be wrong: count down from the relative lifetime.
            localExpiresAtMs: localPairingDeadline(Date.now(), created.expiresInSeconds),
            pollIntervalMs: created.pollIntervalMs,
          };
          await store.putPairing(record);
        } catch (err) {
          if (signal.aborted) return;
          failures += 1;
          retryAfterMs = retryAfterMsOf(err);
          note = `Could not get a pairing code (${sanitiseMessage(describeError(err))}). Trying again.`;
          continue;
        }
      }

      this.#pairingCode = record;
      this.#machine.dispatch({ type: 'PAIRING_CODE_ISSUED' });
      const startedAt = Date.now();
      const outcome = await this.#awaitClaim(record, signal);
      this.#pairingCode = null;
      if (outcome.kind === 'paired' || signal.aborted) return;

      await store.clearPairing().catch(() => undefined);
      this.#machine.dispatch({ type: 'PAIRING_LOST' });
      note = outcome.note;
      failures = Date.now() - startedAt < PAIRING_SHORT_LIVED_MS ? failures + 1 : 0;
    }
  }

  async #awaitClaim(
    record: PairingRecord,
    signal: AbortSignal,
  ): Promise<{ kind: 'paired' } | { kind: 'lost'; note: string | null }> {
    const deadlineMs = record.localExpiresAtMs;
    let note: string | null = null;
    const paint = (): void => {
      this.#screens.pairing(record.code, pairingSecondsLeft(deadlineMs, Date.now()), note);
    };
    paint();
    const ticker = setInterval(paint, 1_000);
    let pollFailures = 0;
    try {
      while (!signal.aborted) {
        // Normally the server's poll answer ("expired") ends a code. This only gives up
        // when the server could not be asked for a while after the local deadline.
        if (pairingAbandoned(deadlineMs, Date.now())) return { kind: 'lost', note: null };
        let result: PairingPollResponse | { status: 'gone' };
        try {
          result = await this.#api.pollPairing(record.pairingId, record.pollingToken, signal);
          pollFailures = 0;
          note = null;
        } catch (err) {
          if (signal.aborted) break;
          pollFailures += 1;
          note = `The server cannot be reached (${sanitiseMessage(describeError(err))}). Still trying.`;
          paint();
          // Still bounded by the code's own deadline: an expired code is replaced, not held.
          const wait = retryDelay(
            Math.max(
              record.pollIntervalMs,
              backoffDelay(PAIRING_BACKOFF, pollFailures, Math.random),
            ),
            retryAfterMsOf(err),
          );
          await sleep(Math.min(wait, Math.max(1_000, deadlineMs - Date.now())), signal).catch(
            () => undefined,
          );
          continue;
        }
        if (result.status === 'claimed') {
          const saved = await this.#completePairing(result);
          if (saved) return { kind: 'paired' };
          return {
            kind: 'lost',
            note: 'Pairing succeeded but this browser could not store the registration. Please pair again.',
          };
        }
        if (result.status !== 'pending') return { kind: 'lost', note: null };
        paint();
        await sleep(record.pollIntervalMs, signal).catch(() => undefined);
      }
      return { kind: 'lost', note: null };
    } finally {
      clearInterval(ticker);
    }
  }

  async #completePairing(
    claim: Extract<PairingPollResponse, { status: 'claimed' }>,
  ): Promise<boolean> {
    const store = this.#store;
    if (store === null) return false;
    const registration: RegistrationRecord = {
      registrationId: claim.registrationId,
      orgId: claim.orgId,
      deviceToken: claim.deviceToken,
      display: {
        id: claim.display.id,
        name: claim.display.name.slice(0, 200),
        canvas: claim.display.canvas,
        contentRect: claim.display.contentRect,
      },
      pairedAt: new Date().toISOString(),
      revokedAt: null,
    };
    try {
      // A registration change never inherits cached media, whichever organisation it came from.
      await deleteAllMediaCaches(caches);
      await store.replaceRegistration(registration);
    } catch (err) {
      console.error(
        'player: could not store the registration',
        sanitiseMessage(describeError(err)),
      );
      return false;
    }
    this.#errors.clear();
    this.#pairingAbort = null;
    this.#machine.dispatch({ type: 'PAIRED' });
    this.#startSession(registration, claim.deviceToken);
    return true;
  }

  // ─────────────────────────── registered ────────────────────────────

  #startSession(registration: RegistrationRecord, deviceToken: string): void {
    const store = this.#store;
    if (store === null) return;
    const abort = new AbortController();
    const { signal } = abort;
    const assets = new CacheAssetStore(
      caches,
      mediaCacheName(registration.orgId, registration.registrationId),
      location.origin,
    );
    const deviceApi = this.#api.forDevice(deviceToken);
    // shortcut: clock offset is not persisted; store it in idb if screens reboot offline with bad clocks.
    const clock = { now: () => Date.now() + this.#clockOffsetMs };
    const presenter = new DomPresenter(this.#stage, (sha256) => assets.getBlob(sha256), clock.now);
    const displayName = registration.display.name;
    const onRevoked = (): void => void this.#handleRevoked();

    const playback = new PlaybackLoop({
      loadActive: async () => (await store.getActive())?.manifest ?? null,
      presenter,
      clock,
      sleep,
      random: Math.random,
      signal,
      onEvent: (event) => {
        this.#onPlaybackEvent(event, displayName);
      },
    });

    const sync = new SyncLoop(
      {
        registrationId: registration.registrationId,
        displayId: registration.display.id,
        apiOrigin: this.#api.origin,
        state: store,
        assets,
        api: deviceApi,
        digest: sha256Hex,
        probe: (asset, blob) => probeAsset(asset, blob),
        inUse: () => presenter.inUse(),
        clock: systemClock,
        sleep,
        random: Math.random,
        signal,
        report: (error) => {
          this.#report(error);
        },
        onProgress: (record) => {
          const session = this.#session;
          if (session === null) return;
          const before = session.staging;
          session.staging = record;
          // Report phase changes promptly; per-asset progress rides on the regular heartbeat.
          if (
            before?.phase !== record?.phase ||
            before?.manifest.publicationId !== record?.manifest.publicationId
          ) {
            session.heartbeat.notifyChange();
          }
        },
      },
      {
        onRevoked,
        onActivated: () => {
          playback.wake();
          heartbeat.notifyChange();
        },
        onSettled: (result) => {
          if (result.kind !== 'up_to_date' && result.kind !== 'activated') return;
          void store
            .getActive()
            .then((active) => {
              const activeId = active?.manifest.publicationId ?? null;
              if (!this.#errors.resolveAfterSync(activeId, Date.now())) return;
              void store.putErrors(this.#errors.list()).catch(() => undefined);
              this.#session?.heartbeat.notifyChange();
            })
            .catch(() => undefined);
        },
      },
    );

    const heartbeat = new HeartbeatLoop({
      state: store,
      snapshot: () => this.#heartbeatSnapshot(),
      send: (body, signal) => deviceApi.heartbeat(body, signal),
      clock: systemClock,
      sleep,
      random: Math.random,
      signal,
      onRevoked,
      onResponse: (response) => {
        this.#clockOffsetMs = Date.parse(response.serverTime) - Date.now();
        void store
          .getActive()
          .then((active) => {
            sync.hintDesired(response.desiredPublicationId, active?.manifest.publicationId ?? null);
          })
          .catch(() => undefined);
      },
    });

    this.#session = {
      registration,
      abort,
      sync,
      heartbeat,
      playback,
      presenter,
      release: () => deviceApi.releaseRegistration(RELEASE_TIMEOUT_MS),
      staging: null,
      rendering: null,
    };
    this.#screens.slate(displayName, WAITING_TEXT);
    playback.start();
    sync.start();
    heartbeat.start();
  }

  #onPlaybackEvent(event: PlaybackEvent, displayName: string): void {
    const session = this.#session;
    if (session === null) return;
    switch (event.type) {
      case 'item_started': {
        const publicationChanged = session.rendering?.publicationId !== event.publicationId;
        session.rendering = { publicationId: event.publicationId, itemIndex: event.index };
        this.#machine.dispatch({ type: 'ITEM_STARTED' });
        this.#screens.hide();
        if (publicationChanged) {
          session.heartbeat.notifyChange();
          // The first item of the new version is now on screen and the presenter has
          // released the last item of the previous one, so what only the previous
          // version needed can be removed. (Collecting at 'version_adopted' would be
          // too early: the old item is still on screen then and would be kept for ever.)
          session.sync.requestGarbageCollection();
          // A fade keeps the previous version's last image on screen, and so in use, for
          // FADE_MS more; collect once more after the presenter has dropped it.
          setTimeout(() => {
            session.sync.requestGarbageCollection();
          }, FADE_MS);
        }
        break;
      }
      case 'version_adopted':
        // Nothing to do yet: the old item stays visible until the new one can be shown.
        break;
      case 'item_failed':
        this.#report(event.error);
        break;
      case 'all_failed':
        session.rendering = null;
        this.#machine.dispatch({ type: 'PLAYBACK_FAILED' });
        this.#screens.slate(displayName, FAULT_TEXT);
        session.heartbeat.notifyChange();
        break;
      case 'no_content':
        if (session.rendering !== null) {
          session.rendering = null;
          session.heartbeat.notifyChange();
        }
        this.#machine.dispatch({ type: 'NO_CONTENT' });
        // Outside working hours or windows the stage stays black: this is planned, not waiting.
        if (event.reason === 'not_now') this.#screens.hide();
        else this.#screens.slate(displayName, WAITING_TEXT);
        break;
    }
  }

  async #heartbeatSnapshot(): Promise<HeartbeatSnapshot | null> {
    const session = this.#session;
    const store = this.#store;
    const playerState = heartbeatStateFor(this.#machine.phase);
    if (session === null || store === null || playerState === null) return null;
    const active = await store.getActive();
    return {
      displayId: session.registration.display.id,
      downloadedPublicationId: active?.manifest.publicationId ?? null,
      rendering: session.rendering,
      playerState,
      staging: session.staging,
      errors: this.#errors.list(),
      version: PLAYER_VERSION,
      storagePersisted: this.#persisted,
      online: navigator.onLine,
    };
  }

  /**
   * The server answered 401. From this moment the player makes no further API calls,
   * stops playback, and removes the credential and all cached content from this browser.
   * (A player that is offline never receives the 401 and keeps playing its cache: the
   * server cannot erase a device it cannot reach. See README, "Revocation".)
   */
  async #handleRevoked(): Promise<void> {
    const session = this.#session;
    if (session === null || this.#machine.phase === 'revoked') return;
    if (!this.#machine.dispatch({ type: 'REVOKED' })) return;
    this.#session = null;
    session.abort.abort();
    session.presenter.clear();
    this.#revokedDisplayName = session.registration.display.name;
    this.#screens.revoked(this.#revokedDisplayName, () => void this.reset());
    try {
      await this.#store?.markRevoked(new Date().toISOString());
    } catch (err) {
      console.error('player: could not record revocation', sanitiseMessage(describeError(err)));
    }
    await this.#purgeMedia(null);
  }

  /**
   * Local reset. Removes the registration (with the device credential), all player
   * state in IndexedDB and every media cache of this origin, then reloads into the
   * unpaired state. The service worker and its cache of static player files stay:
   * they hold no customer content and keep the player loadable offline.
   */
  async reset(): Promise<void> {
    if (!this.#machine.dispatch({ type: 'RESET_REQUESTED' })) return;
    this.#diagnostics.close();
    this.#pairingAbort?.abort();
    const session = this.#session;
    this.#session = null;
    session?.abort.abort();
    session?.presenter.clear();
    this.#screens.starting('Removing registration and cached content…');
    // Ask the server to revoke the credential that is about to be deleted. If the server
    // cannot be reached the local reset still happens; the credential then stays valid on
    // the server until an operator revokes it, but no copy of it remains in this browser.
    if (session !== null) await session.release();

    const wipe = async (): Promise<void> => {
      try {
        await deleteAllMediaCaches(caches);
      } catch (err) {
        console.error('player: cache removal failed', sanitiseMessage(describeError(err)));
      }
      try {
        // Empty the records first: this works even if deleting the database is delayed.
        await this.#store?.wipe();
        await IdbStateStore.destroy(this.#store);
      } catch (err) {
        console.error('player: state removal failed', sanitiseMessage(describeError(err)));
      }
    };
    await Promise.race([wipe(), sleep(WIPE_TIMEOUT_MS)]);
    this.#store = null;
    location.reload();
  }

  // ─────────────────────────── diagnostics ───────────────────────────

  async #diagnosticsModel(): Promise<DiagnosticsModel> {
    const session = this.#session;
    const store = this.#store;
    const estimate = await storageEstimate();
    const active = store === null ? null : await store.getActive().catch(() => null);
    const sections: { title: string; rows: (readonly [string, string])[] }[] = [];

    sections.push({
      title: 'Player',
      rows: [
        ['State', this.#machine.phase],
        ['Build', `${PLAYER_VERSION}${IS_PRODUCTION_BUILD ? '' : ' (development server)'}`],
        ['API', API_ORIGIN],
        ['Network', navigator.onLine ? 'browser reports online' : 'browser reports offline'],
        ['Single-tab guard', this.#leadership],
        ['Offline shell', shellCacheStatus()],
        [
          'Persistent storage',
          this.#persisted === null
            ? 'not available'
            : this.#persisted
              ? 'granted'
              : 'not granted (browser may evict)',
        ],
        [
          'Storage use',
          estimate === null
            ? 'unknown'
            : `${bytes(estimate.usage)} of ${bytes(estimate.quota)} quota`,
        ],
      ],
    });

    if (this.#pairingCode !== null) {
      sections.push({
        title: 'Pairing',
        rows: [
          ['Session', this.#pairingCode.pairingId],
          [
            'Expires',
            `in about ${Math.round(pairingSecondsLeft(this.#pairingCode.localExpiresAtMs, Date.now()))} s (server time ${this.#pairingCode.expiresAt})`,
          ],
        ],
      });
    }

    if (session !== null) {
      const { registration } = session;
      const canvas = registration.display.canvas;
      sections.push({
        title: 'Registration',
        rows: [
          ['Display', `${registration.display.name} (${registration.display.id})`],
          ['Canvas at pairing', `${canvas.width}×${canvas.height}`],
          ['Organisation', registration.orgId],
          ['Registration', registration.registrationId],
          ['Paired', registration.pairedAt],
        ],
      });
      const sync = session.sync.status;
      const hb = session.heartbeat.status;
      const manifest = active?.manifest ?? null;
      const facts = manifest === null ? null : manifestV2Facts(manifest);
      const timeZone = facts?.timeZone ?? null;
      // One instant for "Local time there" and "Schedule picks".
      const correctedNow = Date.now() + this.#clockOffsetMs;
      const there = timeZone === null ? null : localWallClock(correctedNow, timeZone);
      // What the events ask for at the corrected clock, so "wrong content at 9" can be told
      // apart from a wrong clock or zone on the device; "On screen" says what is really showing.
      // shortcut: the row names the first covering event's playlist, not the one on air after a fallback; derive it from the item on screen if support needs it.
      const picked = manifest === null ? undefined : coveringSlices(manifest, correctedNow)[0];
      const schedulePicks =
        manifest === null || manifest.schemaVersion !== 4
          ? '— (no schedule)'
          : picked === undefined || picked === 0
            ? 'default playlist'
            : `playlist ${picked + 1} of ${manifestPlaylists(manifest).length}`;
      sections.push({
        title: 'Content',
        rows: [
          [
            'Downloaded',
            manifest === null
              ? 'none'
              : `${manifest.publicationId} (${manifest.assets.length} items)`,
          ],
          ['Activated', active?.activatedAt ?? '—'],
          [
            'Canvas',
            manifest === null ? '—' : `${manifest.canvas.width}×${manifest.canvas.height}`,
          ],
          [
            'Content rectangle',
            manifest === null || manifest.contentRect === null
              ? 'whole canvas'
              : `${manifest.contentRect.width}×${manifest.contentRect.height} at ${manifest.contentRect.x},${manifest.contentRect.y}`,
          ],
          ['Rotation', facts === null ? '—' : `${facts.rotation}°`],
          ['Time zone', timeZone ?? '— (no time rules)'],
          [
            'Local time there',
            timeZone === null
              ? '—'
              : (there?.stamp.replace('T', ' ') ?? 'zone unknown to this browser'),
          ],
          ['Clock offset', `${(this.#clockOffsetMs / 1000).toFixed(1)} s from server time`],
          ['Schedule picks', schedulePicks],
          [
            'On screen',
            session.rendering === null
              ? 'nothing'
              : `${session.rendering.publicationId} item ${session.rendering.itemIndex + 1}`,
          ],
          [
            'Update',
            session.staging === null
              ? 'none in progress'
              : `${session.staging.manifest.publicationId}: ${session.staging.phase} (${session.staging.assetsDone}/${session.staging.assetsTotal})`,
          ],
        ],
      });
      sections.push({
        title: 'Server contact',
        rows: [
          [
            'Last manifest check',
            sync.lastCycleAt === null ? 'not yet' : `${sync.lastCycleAt}: ${sync.lastResult}`,
          ],
          [
            'Next check in',
            sync.nextCycleInMs === null ? '—' : `about ${Math.round(sync.nextCycleInMs / 1000)} s`,
          ],
          [
            'Failures in a row',
            `network ${sync.counters.networkFailures}, update ${sync.counters.updateFailures}`,
          ],
          ['Last heartbeat accepted', hb.lastAcceptedAt ?? 'not yet'],
          ['Heartbeat sequence', hb.lastSeq === null ? '—' : String(hb.lastSeq)],
          ['Heartbeat problem', hb.lastFailure ?? 'none'],
        ],
      });
    } else if (this.#revokedDisplayName !== null) {
      sections.push({
        title: 'Registration',
        rows: [['Display', `${this.#revokedDisplayName} (unregistered)`]],
      });
    }

    return { sections, errors: this.#errors.list() };
  }
}
