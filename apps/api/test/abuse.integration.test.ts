/**
 * Abuse cases found in review (2026-11-14): anonymous floods of the credentialed
 * player routes, unbounded heartbeat history, router errors that skipped the
 * hardening headers, and HEAD on signed media. Each test drives the real API.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runHousekeeping } from '../src/housekeeping.ts';
import {
  createDisplay,
  createOrg,
  pairPlayer,
  publishImages,
  readyImage,
  signIn,
  startTestApp,
  type Operator,
  type PairedPlayer,
  type TestApp,
  type TestOrg,
} from './support.ts';

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

/** Read-only look at rows the runtime role cannot see (unscoped audit), as the migrator. */
async function asMigrator<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: need('TEST_DATABASE_MIGRATOR_URL') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Unscoped audit rows (org_id NULL) are visible to no application role, by design; only a
 * database administrator can count them. Read-only, as the superuser of the test cluster.
 */
async function unscopedRejections(): Promise<number> {
  const url = new URL(need('TEST_DATABASE_MIGRATOR_URL'));
  url.username = 'postgres';
  url.password = encodeURIComponent(need('POSTGRES_SUPERUSER_PASSWORD'));
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_event WHERE org_id IS NULL AND action = 'player.auth_rejected'",
    );
    return Number(rows[0]?.n);
  } finally {
    await client.end();
  }
}

/** Rows of one display's heartbeat history, read as the table owner inside that organisation. */
async function heartbeatRows(orgId: string, displayId: string): Promise<{ accepted: boolean }[]> {
  return asMigrator(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
      const { rows } = await client.query<{ accepted: boolean }>(
        'SELECT accepted FROM heartbeat_log WHERE display_id = $1 ORDER BY id',
        [displayId],
      );
      return rows;
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

const randomBearer = (): string => `Bearer ${randomBytes(32).toString('base64url')}`;

describe('anonymous floods of credentialed player routes (real rate limits)', () => {
  let t: TestApp;
  let org: TestOrg;
  let operator: Operator;

  beforeAll(async () => {
    t = await startTestApp({}, 1);
    org = await createOrg('Flood');
    operator = await signIn(t, org);
  });
  afterAll(async () => {
    await t.close();
  });

  it('throttles random bearer tokens per client address and audits per client, not per token', async () => {
    const display = await createDisplay(operator, org, 'flood target');
    const player = await pairPlayer(t, operator, display.id);
    // The real player has been verified before the flood starts.
    expect((await fetch(`${t.url}/player/manifest`, { headers: player.headers })).status).toBe(204);

    const before = await unscopedRejections();
    const statuses: Record<number, number> = {};
    for (let i = 0; i < 80; i += 1) {
      const response = await fetch(`${t.url}/player/manifest`, {
        headers: { authorization: randomBearer() },
      });
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      if (response.status === 429) {
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe('rate_limited');
        expect(response.headers.get('retry-after')).not.toBeNull();
      } else {
        await response.arrayBuffer();
      }
    }
    // A few failures are answered normally, then the address is throttled without any
    // database lookup, whatever token it sends next.
    expect(statuses[401]).toBeGreaterThan(0);
    expect(statuses[401]).toBeLessThanOrEqual(30);
    expect(statuses[429]).toBeGreaterThanOrEqual(50);
    // The other credentialed routes share the same failure budget.
    for (const [method, path] of [
      ['POST', '/player/heartbeat'],
      ['POST', '/player/media-urls'],
      ['DELETE', '/player/registration'],
    ] as const) {
      const response = await fetch(`${t.url}${path}`, {
        method,
        headers: {
          authorization: randomBearer(),
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(429);
    }
    // At most two audit rows for the whole flood: the first rejection and the throttle.
    const added = (await unscopedRejections()) - before;
    expect(added).toBeGreaterThanOrEqual(1);
    expect(added).toBeLessThanOrEqual(2);

    // A credential verified before the flood keeps working from the same address.
    expect((await fetch(`${t.url}/player/manifest`, { headers: player.headers })).status).toBe(204);
  });
});

describe('heartbeat history stays bounded whatever the player sends', () => {
  let t: TestApp;
  let org: TestOrg;
  let operator: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    org = await createOrg('Heartbeat history');
    operator = await signIn(t, org);
  });
  afterAll(async () => {
    await t.close();
  });

  const body = (displayId: string, seq: number): string =>
    JSON.stringify({
      schemaVersion: 1,
      seq,
      sentAt: new Date().toISOString(),
      displayId,
      downloadedPublicationId: null,
      activePublicationId: null,
      activeItemIndex: null,
      playerState: 'idle',
      staging: null,
      errors: [],
      player: { version: 'test', storagePersisted: null, online: true },
    });
  const send = (player: PairedPlayer, text: string): Promise<Response> =>
    fetch(`${t.url}/player/heartbeat`, {
      method: 'POST',
      headers: { ...player.headers, 'content-type': 'application/json' },
      body: text,
    });

  it('stores no ignored reports and at most one row per display per sampling interval', async () => {
    const display = await createDisplay(operator, org, 'replaying player');
    const player = await pairPlayer(t, operator, display.id);
    // A buggy or hostile player replays one sequence number, never a multiple of 50.
    for (let i = 0; i < 40; i += 1) await send(player, body(display.id, 7));
    // ... and sends fast, valid, increasing reports.
    for (let seq = 8; seq < 48; seq += 1) await send(player, body(display.id, seq));
    const rows = await heartbeatRows(org.orgId, display.id);
    expect(rows.every((r) => r.accepted)).toBe(true);
    expect(rows.length).toBe(1);

    // After the sampling interval the next accepted report is stored again.
    t.advanceClock(11_000);
    expect((await send(player, body(display.id, 1000))).status).toBe(200);
    expect((await heartbeatRows(org.orgId, display.id)).length).toBe(2);
  });

  it('housekeeping removes history older than the retention period for every organisation', async () => {
    const other = await createOrg('Heartbeat history B');
    const otherOperator = await signIn(t, other);
    const mine = await createDisplay(operator, org, 'retention A');
    const theirs = await createDisplay(otherOperator, other, 'retention B');
    const pa = await pairPlayer(t, operator, mine.id);
    const pb = await pairPlayer(t, otherOperator, theirs.id);
    expect((await send(pa, body(mine.id, 1))).status).toBe(200);
    expect((await send(pb, body(theirs.id, 1))).status).toBe(200);
    // Age both rows past the retention period (arranging only, as the function owner).
    await asMigrator(async (client) => {
      for (const [orgId, displayId] of [
        [org.orgId, mine.id],
        [other.orgId, theirs.id],
      ] as const) {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
        await client.query(
          `UPDATE heartbeat_log SET received_at = now() - interval '3 days' WHERE display_id = $1`,
          [displayId],
        );
        await client.query('COMMIT');
      }
    });
    const fresh = await createDisplay(operator, org, 'retention fresh');
    const pf = await pairPlayer(t, operator, fresh.id);
    expect((await send(pf, body(fresh.id, 1))).status).toBe(200);

    const result = await runHousekeeping({
      pool: t.pool,
      storage: t.ctx.storage,
      media: t.ctx.media,
      limits: t.config.limits,
    });
    expect(result.heartbeats).toBeGreaterThanOrEqual(2);
    expect(await heartbeatRows(org.orgId, mine.id)).toEqual([]);
    expect(await heartbeatRows(other.orgId, theirs.id)).toEqual([]);
    expect((await heartbeatRows(org.orgId, fresh.id)).length).toBe(1);
  });
});

describe('framework-level refusals use the error envelope and hardening headers', () => {
  let t: TestApp;
  let org: TestOrg;
  let operator: Operator;

  beforeAll(async () => {
    t = await startTestApp();
    org = await createOrg('Envelope');
    operator = await signIn(t, org);
  });
  afterAll(async () => {
    await t.close();
  });

  it('answers an over-long path parameter like any unknown address, without echoing it', async () => {
    const long = 'a'.repeat(150);
    for (const path of [`/player/media/${long}`, `/api/displays/${long}`]) {
      const response = await fetch(`${t.url}${path}`);
      const text = await response.text();
      expect(response.status, path).toBe(404);
      expect(text).not.toContain(long);
      expect(text).not.toContain('FST_ERR');
      expect(JSON.parse(text)).toMatchObject({ error: { code: 'not_found' } });
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-request-id')).not.toBeNull();
    }
  });

  it('reports the real size on HEAD of a signed media URL', async () => {
    const display = await createDisplay(operator, org, 'head');
    const image = await readyImage(t, operator);
    const { publicationId } = await publishImages(operator, display.id, [image.id]);
    const player = await pairPlayer(t, operator, display.id);
    const issued = (await (
      await fetch(`${t.url}/player/media-urls`, {
        method: 'POST',
        headers: { ...player.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ publicationId, assetIds: [image.id] }),
      })
    ).json()) as { urls: { url: string }[] };
    const url = new URL(issued.urls[0]?.url ?? '');
    const local = `${t.url}${url.pathname}${url.search}`;
    const head = await fetch(local, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(image.bytes));
    expect(head.headers.get('content-type')).toBe('image/png');
    expect(head.headers.get('accept-ranges')).toBe('bytes');
    const get = await fetch(local);
    expect((await get.arrayBuffer()).byteLength).toBe(image.bytes);
    // An unknown publication id in a validly shaped URL is still refused.
    const forged = new URL(local);
    forged.searchParams.set('pub', randomUUID());
    expect((await fetch(forged, { method: 'HEAD' })).status).toBe(403);
  });
});
