/**
 * Upgrade test for migration 0011 on a database that already holds pairing sessions.
 *
 * Before migration 0010, revoking a screen's player or claiming the screen again left
 * older claims in place. A claim like that, not yet collected by its player when the
 * database is upgraded, could still complete afterwards and hand out a lasting
 * credential (security review round 3, SCX-01, second check). 0011 cancels them.
 *
 * This file rebuilds the test database at migration 0010, leaves pairing sessions in
 * every state, with claims as the code before 0010 could leave them, then applies 0011
 * with the real migration runner and checks what was cancelled, what was left alone and
 * what was audited.
 *
 * It resets the shared integration-test database. Integration files run one at a time
 * and each arranges its own data, so the others are unaffected; `afterAll` always leaves
 * the database at the newest migration.
 */
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deviceByTokenHash,
  pairingClaim,
  pairingComplete,
  pairingCreate,
  poolAsTx,
  resetTestDatabase,
  runMigrations,
  withOrg,
  type MigrationResult,
  type Pool,
  type Tx,
} from '../src/index.ts';
import {
  appPool,
  createOrg,
  hash,
  migratorClient,
  migratorUrl,
  pairingCode,
  type TestOrg,
} from './support.ts';

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'db',
  'migrations',
);
const TARGET = '0011_pairing_upgrade_cleanup.sql';

interface Pairing {
  readonly pairingId: string;
  readonly code: string;
  readonly pollingTokenHash: Buffer;
}

let scratch: string | undefined;
let migrator: pg.Client | undefined;
let pool: Pool | undefined;
let db: Tx;
let upgrade: MigrationResult;

/** A screen that never had a player, with two claims at once: possible only before 0010. */
let a: TestOrg;
/** In another organisation: a screen with one claim, and one that lapsed uncollected. */
let b: TestOrg;
/** A screen with a paired player. */
let c: TestOrg;

let firstOfTwo: Pairing;
let secondOfTwo: Pairing;
let otherOrg: Pairing;
let lapsed: Pairing;
let pending: Pairing;
let locked: Pairing;
let completed: Pairing;
let completedToken: Buffer;

function clients(): { migrator: pg.Client; pool: Pool } {
  if (migrator === undefined || pool === undefined) throw new Error('beforeAll did not finish');
  return { migrator, pool };
}

/** Runs one statement as the owner of the security functions (non-tenant tables). */
async function asDefiner<R extends pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<R[]> {
  const { migrator: client } = clients();
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE tinnox_definer');
    const { rows } = await client.query<R>(text, [...values]);
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function newPairing(): Promise<Pairing> {
  const pollingTokenHash = hash();
  const code = pairingCode();
  const created = await pairingCreate(db, {
    code,
    pollingTokenHash,
    clientKey: `client-${code}`,
    ttlSeconds: 600,
    maxSessionsPerClient: 10,
    windowSeconds: 600,
  });
  if (created.outcome !== 'created') throw new Error(`pairing not created: ${created.outcome}`);
  return { code, pollingTokenHash, pairingId: created.pairingId };
}

/** A claim written straight into the table, as code from before 0010 could leave it. */
async function legacyClaim(org: TestOrg, expiresIn: string): Promise<Pairing> {
  const pairing = await newPairing();
  await asDefiner(
    `UPDATE public.pairing_session
     SET status = 'claimed', org_id = $2, display_id = $3, claimed_at = now(),
         claimed_by_membership = $4, expires_at = now() + $5::interval
     WHERE id = $1`,
    [pairing.pairingId, org.orgId, org.displayId, org.membershipId, expiresIn],
  );
  return pairing;
}

async function statusOf(pairing: Pairing): Promise<string | undefined> {
  const rows = await asDefiner<{ status: string }>(
    'SELECT status FROM public.pairing_session WHERE id = $1',
    [pairing.pairingId],
  );
  return rows[0]?.status;
}

const complete = (pairing: Pairing, deviceTokenHash: Buffer = hash()) =>
  pairingComplete(db, {
    pairingId: pairing.pairingId,
    pollingTokenHash: pairing.pollingTokenHash,
    deviceTokenHash,
  });

/** The cancellations an organisation can read in its own audit trail. */
async function cancellationsSeenBy(org: TestOrg): Promise<Record<string, unknown>[]> {
  return withOrg(clients().pool, org.orgId, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `SELECT actor_type, actor_id, object_type, object_id, result, detail
       FROM audit_event WHERE action = 'pairing.cancel' ORDER BY id`,
    );
    return rows;
  });
}

beforeAll(async () => {
  const names = (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql')).sort();
  const before = names.filter((n) => n < TARGET);
  expect(names).toContain(TARGET);
  expect(before).toHaveLength(10);
  scratch = await mkdtemp(join(tmpdir(), 'tinnox-migration-0011-'));
  for (const name of before) await copyFile(join(MIGRATIONS, name), join(scratch, name));

  await resetTestDatabase(migratorUrl());
  await runMigrations({ connectionString: migratorUrl(), directory: scratch });

  migrator = await migratorClient();
  pool = appPool(2);
  db = poolAsTx(pool);
  a = await createOrg(migrator, 'Upgrade A');
  b = await createOrg(migrator, 'Upgrade B');
  c = await createOrg(migrator, 'Upgrade C');

  firstOfTwo = await legacyClaim(a, '5 minutes');
  // Longer than the default code lifetime of ten minutes: the lifetime is configurable.
  secondOfTwo = await legacyClaim(a, '50 minutes');
  otherOrg = await legacyClaim(b, '5 minutes');
  lapsed = await legacyClaim(b, '-1 minute');
  pending = await newPairing();
  locked = await newPairing();
  await asDefiner("UPDATE public.pairing_session SET status = 'locked' WHERE id = $1", [
    locked.pairingId,
  ]);

  completed = await newPairing();
  completedToken = hash();
  const claimed = await withOrg(pool, c.orgId, (tx) =>
    pairingClaim(tx, {
      code: completed.code,
      displayId: c.displayId,
      membershipId: c.membershipId,
      maxFailures: 5,
      windowSeconds: 600,
    }),
  );
  expect(claimed.outcome).toBe('claimed');
  expect((await complete(completed, completedToken)).outcome).toBe('completed');

  upgrade = await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
});

afterAll(async () => {
  await pool?.end();
  await migrator?.end();
  // Whatever happened above, leave the shared test database at the newest migration.
  await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
});

describe('migration 0011 on a database that already holds pairing sessions', () => {
  it('is applied on top of 0010, and is not applied twice', async () => {
    const later = (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql') && n > TARGET);
    expect(upgrade.alreadyApplied).toHaveLength(10);
    expect(upgrade.applied).toEqual([TARGET, ...later.sort()]);
    const again = await runMigrations({ connectionString: migratorUrl(), directory: MIGRATIONS });
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toContain(TARGET);
  });

  it('cancels every claim that could still complete, in each organisation', async () => {
    for (const claim of [firstOfTwo, secondOfTwo, otherOrg]) {
      expect(await statusOf(claim)).toBe('expired');
    }
  });

  it('gives no credential to a player that collects such a claim afterwards', async () => {
    for (const claim of [firstOfTwo, secondOfTwo, otherOrg]) {
      expect(await complete(claim)).toEqual({ outcome: 'not_claimable' });
    }
    for (const org of [a, b]) {
      const registrations = await withOrg(clients().pool, org.orgId, async (tx) => {
        const { rows } = await tx.query('SELECT id FROM player_registration');
        return rows;
      });
      expect(registrations).toEqual([]);
    }
  });

  it('leaves every other session as it was', async () => {
    expect(await statusOf(pending)).toBe('pending');
    expect(await statusOf(locked)).toBe('locked');
    expect(await statusOf(completed)).toBe('completed');
    // Past its expiry, so it could not complete anyway: not touched and not audited.
    expect(await statusOf(lapsed)).toBe('claimed');
    expect((await deviceByTokenHash(db, completedToken))?.displayId).toBe(c.displayId);
  });

  it('audits the cancellation once per screen, for its own organisation only', async () => {
    expect(await cancellationsSeenBy(a)).toEqual([
      {
        actor_type: 'system',
        actor_id: null,
        object_type: 'display',
        object_id: a.displayId,
        result: 'success',
        detail: {
          reason: 'upgrade',
          cancelledPairingIds: [firstOfTwo.pairingId, secondOfTwo.pairingId].sort(),
        },
      },
    ]);
    expect(await cancellationsSeenBy(b)).toEqual([
      {
        actor_type: 'system',
        actor_id: null,
        object_type: 'display',
        object_id: b.displayId,
        result: 'success',
        detail: { reason: 'upgrade', cancelledPairingIds: [otherOrg.pairingId] },
      },
    ]);
    expect(await cancellationsSeenBy(c)).toEqual([]);
  });

  it('still pairs a player whose code is accepted after the upgrade', async () => {
    const claimed = await withOrg(clients().pool, a.orgId, (tx) =>
      pairingClaim(tx, {
        code: pending.code,
        displayId: a.displayId,
        membershipId: a.membershipId,
        maxFailures: 5,
        windowSeconds: 600,
      }),
    );
    expect(claimed.outcome).toBe('claimed');
    expect((await complete(pending)).outcome).toBe('completed');
  });
});
