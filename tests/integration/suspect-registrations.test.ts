/**
 * Security review round 3, SCX-01: scripts/find-suspect-registrations.sql, the upgrade
 * runbook's list of credentials a version from before migration 0010 may have handed out
 * after the screen's player was revoked or another code was accepted
 * (docs/security/operations-and-release-checklist.md section 1.3).
 *
 * The current code refuses such a collection, so the history is written straight into
 * the tables, with the audit events the older code wrote.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createOrg, repoRoot, type TestOrg } from './support.ts';

/** The database administrator, as in the runbook. */
async function asSuperuser<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(process.env['TEST_DATABASE_MIGRATOR_URL'] ?? '');
  url.username = 'postgres';
  url.password = encodeURIComponent(process.env['POSTGRES_SUPERUSER_PASSWORD'] ?? '');
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

type Step = 'claim' | 'revoke' | 'otherClaim' | 'collect';

/**
 * A screen with the audit trail of the given steps, in order. `collect` creates the
 * registration its code leads to. Returns the screen and that registration.
 */
async function screenWithHistory(
  client: pg.Client,
  org: TestOrg,
  steps: readonly Step[],
  options: { revokedSince?: boolean } = {},
): Promise<{ displayId: string; registrationId: string }> {
  const displayId = randomUUID();
  const pairingId = randomUUID();
  const registrationId = randomUUID();
  await client.query(
    `INSERT INTO public.display (id, org_id, site_id, name, canvas_width, canvas_height)
     VALUES ($1, $2, $3, $4, 1920, 1080)`,
    [displayId, org.orgId, org.siteId, `Suspect ${displayId.slice(0, 8)}`],
  );
  const audit = (
    actorType: string,
    action: string,
    objectType: string,
    objectId: string,
    detail: Record<string, unknown>,
  ) =>
    client.query(
      `INSERT INTO public.audit_event (org_id, actor_type, actor_id, action, object_type, object_id, result, detail)
       VALUES ($1, $2, $3, $4, $5, $6, 'success', $7)`,
      [
        org.orgId,
        actorType,
        actorType === 'operator' ? org.membershipId : registrationId,
        action,
        objectType,
        objectId,
        JSON.stringify(detail),
      ],
    );
  for (const step of steps) {
    if (step === 'claim') {
      await audit('operator', 'pairing.claim', 'display', displayId, { pairingId });
    } else if (step === 'otherClaim') {
      await audit('operator', 'pairing.claim', 'display', displayId, { pairingId: randomUUID() });
    } else if (step === 'revoke') {
      await audit('operator', 'player.revoke', 'display', displayId, {
        reason: 'operator',
        displayId,
        hadActiveRegistration: false,
      });
    } else {
      await client.query(
        `INSERT INTO public.player_registration (id, org_id, display_id, token_hash, revoked_at, revoked_reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          registrationId,
          org.orgId,
          displayId,
          randomBytes(32),
          options.revokedSince === true ? new Date() : null,
          options.revokedSince === true ? 'operator' : null,
        ],
      );
      await audit('player', 'pairing.complete', 'player_registration', registrationId, {
        displayId,
        pairingId,
      });
    }
  }
  return { displayId, registrationId };
}

describe('finding credentials handed out against a revocation, from before migration 0010', () => {
  it('lists an active credential collected after a revocation or a newer code, and no other', async () => {
    const org = await createOrg('Suspect registrations');
    const other = await createOrg('Suspect registrations, other');
    const script = await readFile(
      join(repoRoot, 'scripts', 'find-suspect-registrations.sql'),
      'utf8',
    );

    const found = await asSuperuser(async (client) => {
      const afterRevoke = await screenWithHistory(client, org, ['claim', 'revoke', 'collect']);
      const afterNewerCode = await screenWithHistory(client, other, [
        'claim',
        'otherClaim',
        'collect',
      ]);
      // Not suspect: an ordinary pairing, a revocation before the code was accepted or
      // after it was collected, and a suspect credential that has been revoked since.
      await screenWithHistory(client, org, ['claim', 'collect']);
      await screenWithHistory(client, org, ['revoke', 'claim', 'collect']);
      await screenWithHistory(client, org, ['claim', 'collect', 'revoke']);
      await screenWithHistory(client, org, ['claim', 'revoke', 'collect'], { revokedSince: true });

      const { rows } = await client.query<{
        org_id: string;
        display_id: string;
        registration_id: string;
      }>(script);
      const ours = rows.filter((row) => [org.orgId, other.orgId].includes(row.org_id));
      return { ours, afterRevoke, afterNewerCode };
    });

    expect(
      found.ours.map(({ org_id, display_id, registration_id }) => ({
        org_id,
        display_id,
        registration_id,
      })),
    ).toEqual([
      {
        org_id: org.orgId,
        display_id: found.afterRevoke.displayId,
        registration_id: found.afterRevoke.registrationId,
      },
      {
        org_id: other.orgId,
        display_id: found.afterNewerCode.displayId,
        registration_id: found.afterNewerCode.registrationId,
      },
    ]);
  });
});
