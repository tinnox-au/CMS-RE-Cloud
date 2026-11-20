/**
 * Operator-side helpers: the real sign-in through Keycloak (password, then TOTP) and a
 * small client that calls the portal API with the browser context's own session cookie.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { devUser, totpCode, type DevUserName } from '../../support/dev-identity.ts';
import { PORTAL_URL, runDir } from './stack.ts';

const TOTP_PERIOD_SECONDS = 30;

/**
 * Keycloak refuses a one-time code it has already accepted. Remember the time step
 * used last for each user (across runs) and wait for the next one when needed.
 */
async function freshTotp(name: DevUserName): Promise<string> {
  mkdirSync(runDir, { recursive: true });
  const file = join(runDir, 'totp-steps.json');
  const used: Record<string, number> = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>)
    : {};
  for (;;) {
    const nowSeconds = Date.now() / 1000;
    const step = Math.floor(nowSeconds / TOTP_PERIOD_SECONDS);
    const secondsLeft = TOTP_PERIOD_SECONDS - (nowSeconds % TOTP_PERIOD_SECONDS);
    // Also avoid typing a code that is about to roll over.
    if ((used[name] ?? -1) < step && secondsLeft > 4) {
      used[name] = step;
      writeFileSync(file, JSON.stringify(used));
      return totpCode(devUser(name));
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Signs in through the portal's "Sign in" link and the identity provider's two forms. */
export async function signIn(page: Page, name: DevUserName = 'operator'): Promise<void> {
  const user = devUser(name);
  await page.goto(`${PORTAL_URL}/`);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.waitForURL(/\/realms\/tinnox-dev\//);
  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(user.password);
  await page.locator('#kc-login').click();
  const otp = page.locator('#otp');
  await expect(otp, 'the identity provider asks for a one-time code').toBeVisible();
  await otp.fill(await freshTotp(name));
  await page.locator('#kc-login').click();
  await page.waitForURL(`${PORTAL_URL}/**`);
  // Sign-in lands on the dashboard (docs/portal-v2/stage-a.md, section 1).
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/**
 * Signs in again from the portal's sign-in screen after the member's sessions were ended
 * (a demotion, "Sign out everywhere"). Keycloak's own session is still alive, so the API
 * refuses its silent answer and asks again with `prompt=login` (docs/portal-v2/stage-c.md,
 * section 6.5): the password form must show, then the one-time code. Keycloak may show the
 * username as text instead of a field during a re-authentication, so `#username` is filled
 * only when it is there to fill. Ends on the portal page the member was on.
 */
export async function reauthenticate(page: Page, name: DevUserName): Promise<void> {
  const user = devUser(name);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.waitForURL(/\/realms\/tinnox-dev\//);
  const password = page.locator('#password');
  await expect(password, 'the identity provider asks for the password again').toBeVisible();
  const username = page.locator('#username');
  if ((await username.isVisible()) && (await username.isEditable())) {
    await username.fill(user.username);
  }
  await password.fill(user.password);
  await page.locator('#kc-login').click();
  const otp = page.locator('#otp');
  await expect(otp, 'the identity provider asks for a one-time code again').toBeVisible();
  await otp.fill(await freshTotp(name));
  await page.locator('#kc-login').click();
  await page.waitForURL(`${PORTAL_URL}/**`);
}

export interface MediaItem {
  readonly id: string;
  readonly status: string;
  readonly kind: string;
  readonly originalName: string;
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly errorCode: string | null;
}

export interface PublishResult {
  readonly publicationId: string;
  readonly replayed: boolean;
  readonly manifest: { readonly assets: readonly { assetId: string; sha256: string }[] };
}

/** A schedule as `POST` and `PUT /api/schedules` take it; `days` is seven entries, Monday first. */
export interface ScheduleInput {
  readonly name: string;
  readonly defaultPlaylistId: string;
  readonly events: readonly {
    readonly playlistId: string;
    readonly days: readonly boolean[];
    /** HH:mm in the screen's site zone; an end of 24:00 is midnight. */
    readonly start: string;
    readonly end: string;
  }[];
}

/** A layout as `POST` and `PUT /api/layouts` take it; zones in basis points, [0] is the main zone. */
export interface LayoutInput {
  readonly name: string;
  readonly zones: readonly {
    readonly playlistId: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
}

/** The portal's one preset: a main zone over a band along the bottom, `percent` of the height. */
export function bandLayout(
  name: string,
  mainPlaylistId: string,
  bandPlaylistId: string,
  percent = 15,
): LayoutInput {
  const band = percent * 100;
  return {
    name,
    zones: [
      { playlistId: mainPlaylistId, x: 0, y: 0, width: 10_000, height: 10_000 - band },
      { playlistId: bandPlaylistId, x: 0, y: 10_000 - band, width: 10_000, height: band },
    ],
  };
}

export interface StatusView {
  readonly paired: boolean;
  readonly registrationId: string | null;
  readonly desired: { publicationId: string } | null;
  readonly downloaded: { publicationId: string } | null;
  readonly active: { publicationId: string; itemIndex: number } | null;
  readonly playerState: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly stale: boolean;
  readonly summary: string;
  readonly errors: readonly { code: string; publicationId: string | null }[];
}

/** Calls the API through the portal origin, as the signed-in browser context. */
export class OperatorApi {
  readonly #context: BrowserContext;
  #csrf: string | null = null;

  constructor(context: BrowserContext) {
    this.#context = context;
  }

  async session(): Promise<{
    authenticated: boolean;
    organization?: { id: string; name: string };
  }> {
    const response = await this.#context.request.get(`${PORTAL_URL}/api/session`);
    return (await response.json()) as {
      authenticated: boolean;
      organization?: { id: string; name: string };
      csrfToken?: string;
    };
  }

  async #headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    if (this.#csrf === null) {
      const response = await this.#context.request.get(`${PORTAL_URL}/api/session`);
      const body = (await response.json()) as { authenticated: boolean; csrfToken?: string };
      if (!body.authenticated || body.csrfToken === undefined) throw new Error('not signed in');
      this.#csrf = body.csrfToken;
    }
    return { origin: PORTAL_URL, 'x-csrf-token': this.#csrf, ...extra };
  }

  get(path: string): Promise<APIResponse> {
    return this.#context.request.get(`${PORTAL_URL}${path}`);
  }

  async post(
    path: string,
    data?: unknown,
    extra: Record<string, string> = {},
  ): Promise<APIResponse> {
    return this.#context.request.post(`${PORTAL_URL}${path}`, {
      headers: await this.#headers(extra),
      ...(data === undefined ? {} : { data }),
    });
  }

  async patch(path: string, data: unknown): Promise<APIResponse> {
    return this.#context.request.patch(`${PORTAL_URL}${path}`, {
      headers: await this.#headers(),
      data,
    });
  }

  async put(path: string, data: unknown): Promise<APIResponse> {
    return this.#context.request.put(`${PORTAL_URL}${path}`, {
      headers: await this.#headers(),
      data,
    });
  }

  /** The membership id of the person with this name (`GET /api/members`, needs `member.read`). */
  async memberIdByName(name: string): Promise<string> {
    const response = await this.get('/api/members');
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as {
      items: { id: string; displayName: string | null }[];
    };
    const member = body.items.find((item) => item.displayName === name);
    if (member === undefined) throw new Error(`no member is named "${name}"`);
    return member.id;
  }

  async siteId(): Promise<string> {
    const body = (await (await this.get('/api/sites')).json()) as { items: { id: string }[] };
    const site = body.items[0];
    if (site === undefined) throw new Error('no site is seeded');
    return site.id;
  }

  async createDisplay(input: {
    name: string;
    canvas: { width: number; height: number };
    contentRect?: { x: number; y: number; width: number; height: number } | null;
    defaultFit?: 'contain' | 'cover';
  }): Promise<{ id: string }> {
    const response = await this.post('/api/displays', { siteId: await this.siteId(), ...input });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as { id: string };
  }

  async claim(displayId: string, code: string): Promise<APIResponse> {
    return this.post(`/api/displays/${displayId}/claim`, { code });
  }

  async upload(name: string, mimeType: string, buffer: Buffer): Promise<MediaItem> {
    const response = await this.#context.request.post(`${PORTAL_URL}/api/media`, {
      headers: await this.#headers(),
      multipart: { file: { name, mimeType, buffer } },
    });
    expect(response.status(), await response.text()).toBe(201);
    return ((await response.json()) as { media: MediaItem }).media;
  }

  async media(id: string): Promise<MediaItem> {
    return (await (await this.get(`/api/media/${id}`)).json()) as MediaItem;
  }

  /** Waits until the real validation worker has reached a verdict. */
  async waitForVerdict(id: string, timeoutMs = 60_000): Promise<MediaItem> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const item = await this.media(id);
      if (item.status !== 'processing') return item;
      if (Date.now() > deadline) throw new Error(`media ${id} is still processing`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async uploadReady(name: string, mimeType: string, buffer: Buffer): Promise<MediaItem> {
    const uploaded = await this.upload(name, mimeType, buffer);
    const verdict = await this.waitForVerdict(uploaded.id);
    expect(verdict.status, `verdict for ${name}: ${verdict.errorCode ?? ''}`).toBe('ready');
    return verdict;
  }

  async createPlaylist(name: string): Promise<{ id: string }> {
    const response = await this.post('/api/playlists', { name });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as { id: string };
  }

  /** Creates a built-in app; `content` is `{type, settings}` as the API takes it. */
  async createApp(input: {
    name: string;
    content: { type: string; settings: Record<string, string | boolean> };
  }): Promise<{ id: string }> {
    const response = await this.post('/api/apps', input);
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as { id: string };
  }

  async savePlaylist(
    id: string,
    name: string,
    items: readonly (
      | { mediaId: string; durationMs: number | null; fit: 'contain' | 'cover' | null }
      | { appId: string; durationMs: number }
    )[],
    playback: { transition?: 'cut' | 'fade'; shuffle?: boolean } = {},
  ): Promise<void> {
    const response = await this.put(`/api/playlists/${id}`, { name, items, ...playback });
    expect(response.status(), await response.text()).toBe(200);
  }

  async createSchedule(input: ScheduleInput): Promise<{ id: string }> {
    const response = await this.post('/api/schedules', input);
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as { id: string };
  }

  /** Replaces the whole schedule: its name, default playlist and events. */
  async replaceSchedule(id: string, input: ScheduleInput): Promise<void> {
    const response = await this.put(`/api/schedules/${id}`, input);
    expect(response.status(), await response.text()).toBe(200);
  }

  /** Assigns a schedule to a screen (this clears an assigned playlist). Nothing is pushed. */
  async assignSchedule(displayId: string, scheduleId: string): Promise<void> {
    const response = await this.patch(`/api/displays/${displayId}`, {
      assignedScheduleId: scheduleId,
    });
    expect(response.status(), await response.text()).toBe(200);
  }

  async createLayout(input: LayoutInput): Promise<{ id: string }> {
    const response = await this.post('/api/layouts', input);
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as { id: string };
  }

  /** Replaces the whole layout: its name and zones. */
  async replaceLayout(id: string, input: LayoutInput): Promise<void> {
    const response = await this.put(`/api/layouts/${id}`, input);
    expect(response.status(), await response.text()).toBe(200);
  }

  /** Assigns a layout to a screen (this clears a playlist or a schedule). Nothing is pushed. */
  async assignLayout(displayId: string, layoutId: string): Promise<void> {
    const response = await this.patch(`/api/displays/${displayId}`, {
      assignedLayoutId: layoutId,
    });
    expect(response.status(), await response.text()).toBe(200);
  }

  async publish(playlistId: string, displayId: string, key = randomUUID()): Promise<PublishResult> {
    const response = await this.post(
      `/api/playlists/${playlistId}/publish`,
      { displayId },
      { 'idempotency-key': key },
    );
    expect([200, 201], await response.text()).toContain(response.status());
    return (await response.json()) as PublishResult;
  }

  async status(displayId: string): Promise<StatusView> {
    const response = await this.get(`/api/displays/${displayId}/status`);
    expect(response.status()).toBe(200);
    return (await response.json()) as StatusView;
  }

  /** Polls the server's status view until `accept` is satisfied; returns the accepted view. */
  async waitForStatus(
    displayId: string,
    what: string,
    accept: (view: StatusView) => boolean,
    timeoutMs = 90_000,
  ): Promise<StatusView> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const last = await this.status(displayId);
      if (accept(last)) return last;
      if (Date.now() > deadline) {
        throw new Error(`status never showed ${what}; last view: ${JSON.stringify(last)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
