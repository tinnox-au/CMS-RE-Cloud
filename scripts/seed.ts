// Seeds synthetic development data as role tinnox_migrator. Safe to run repeatedly.
//   npm run db:seed                  organisation "TINNOX Internal", one site (Australia/Melbourne),
//                                    and a membership for the development operator
//   npm run db:seed -- --second-org  also a second organisation with its own operator, used by
//                                    cross-organisation isolation tests and manual checks
//   add --test to target the integration-test database
//
// How an operator gets access: there is no self-registration and no automatic
// provisioning at sign-in. A membership row links an identity-provider subject
// (the OIDC "sub" claim) to exactly one organisation. scripts/setup-dev.mjs fixes
// the subject of each Keycloak test user and records it in .env as
// DEV_OPERATOR_OIDC_SUB / DEV_SECOND_ORG_OIDC_SUB; this script creates the
// matching membership rows. A subject without a membership cannot sign in.
import pg from 'pg';
import { loadEnv, requireEnv } from './lib/env.ts';

loadEnv();
const useTest = process.argv.includes('--test');
const withSecondOrg = process.argv.includes('--second-org');
const connectionString = requireEnv(
  useTest ? 'TEST_DATABASE_MIGRATOR_URL' : 'DATABASE_MIGRATOR_URL',
);

/** Fixed identifiers so documentation, tests and repeated runs agree. Synthetic data only. */
export const SEED = {
  primary: {
    orgId: '10000000-0000-4000-8000-000000000001',
    orgName: 'TINNOX Internal',
    siteId: '10000000-0000-4000-8000-000000000002',
    siteName: 'Melbourne Workshop',
    timezone: 'Australia/Melbourne',
    subjectEnv: 'DEV_OPERATOR_OIDC_SUB',
  },
  second: {
    orgId: '20000000-0000-4000-8000-000000000001',
    orgName: 'Isolation Test Organisation',
    siteId: '20000000-0000-4000-8000-000000000002',
    siteName: 'Isolation Test Site',
    timezone: 'Australia/Sydney',
    subjectEnv: 'DEV_SECOND_ORG_OIDC_SUB',
  },
} as const;

async function seedOrganisation(
  client: pg.Client,
  org: (typeof SEED)[keyof typeof SEED],
): Promise<string> {
  const subject = requireEnv(org.subjectEnv);
  await client.query('BEGIN');
  try {
    // Row-level security is forced even for the table owner, so the seed sets the
    // tenant context exactly like the application does.
    await client.query("SELECT set_config('app.org_id', $1, true)", [org.orgId]);
    await client.query(
      'INSERT INTO organization (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [org.orgId, org.orgName],
    );
    await client.query(
      'INSERT INTO site (id, org_id, name, timezone) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
      [org.siteId, org.orgId, org.siteName, org.timezone],
    );
    const existing = await client.query<{ oidc_sub: string }>(
      'SELECT oidc_sub FROM membership WHERE org_id = $1',
      [org.orgId],
    );
    let note: string;
    if (existing.rows.some((r) => r.oidc_sub === subject)) {
      note = 'membership already present';
    } else {
      await client.query('INSERT INTO membership (org_id, oidc_sub, role) VALUES ($1, $2, $3)', [
        org.orgId,
        subject,
        'operator',
      ]);
      note =
        existing.rows.length === 0
          ? 'membership created'
          : 'membership added for a new subject (older ones kept)';
    }
    await client.query('COMMIT');
    return `${org.orgName}: site "${org.siteName}" (${org.timezone}); ${note}`;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

const client = new pg.Client({ connectionString, application_name: 'tinnox-seed' });
try {
  await client.connect();
  console.log(await seedOrganisation(client, SEED.primary));
  if (withSecondOrg) console.log(await seedOrganisation(client, SEED.second));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
