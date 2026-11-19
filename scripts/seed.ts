// Seeds synthetic development data as role tinnox_migrator. Safe to run repeatedly.
//   npm run db:seed                  organisation "TINNOX Internal", one site (Australia/Melbourne),
//                                    and one member per role: Owner (the development operator),
//                                    Admin, Editor and Viewer
//   npm run db:seed -- --second-org  also a second organisation with its own Owner, used by
//                                    cross-organisation isolation tests and manual checks
//   add --test to target the integration-test database
//
// How a person gets access: there is no self-registration and no automatic
// provisioning at sign-in. A membership row links an identity-provider subject
// (the OIDC "sub" claim) to exactly one organisation, with one role. scripts/setup-dev.mjs
// fixes the subject of each Keycloak test user and records it in .env as DEV_*_OIDC_SUB;
// this script creates the matching membership rows. A subject without a membership cannot
// sign in. Customers' members come from scripts/provision-member.ts instead.
import type { Role } from '@tinnox/contracts';
import pg from 'pg';
import { loadEnv, requireEnv } from './lib/env.ts';

loadEnv();
const useTest = process.argv.includes('--test');
const withSecondOrg = process.argv.includes('--second-org');
const connectionString = requireEnv(
  useTest ? 'TEST_DATABASE_MIGRATOR_URL' : 'DATABASE_MIGRATOR_URL',
);

interface SeedMember {
  readonly subjectEnv: string;
  readonly role: Role;
  readonly name: string;
}

interface SeedOrg {
  readonly orgId: string;
  readonly orgName: string;
  readonly siteId: string;
  readonly siteName: string;
  readonly timezone: string;
  readonly members: readonly SeedMember[];
}

/** Fixed identifiers so documentation, tests and repeated runs agree. Synthetic data only. */
export const SEED = {
  primary: {
    orgId: '10000000-0000-4000-8000-000000000001',
    orgName: 'TINNOX Internal',
    siteId: '10000000-0000-4000-8000-000000000002',
    siteName: 'Melbourne Workshop',
    timezone: 'Australia/Melbourne',
    members: [
      { subjectEnv: 'DEV_OPERATOR_OIDC_SUB', role: 'owner', name: 'Dev Owner' },
      { subjectEnv: 'DEV_ADMIN_OIDC_SUB', role: 'admin', name: 'Dev Admin' },
      { subjectEnv: 'DEV_EDITOR_OIDC_SUB', role: 'editor', name: 'Dev Editor' },
      { subjectEnv: 'DEV_VIEWER_OIDC_SUB', role: 'viewer', name: 'Dev Viewer' },
    ],
  },
  second: {
    orgId: '20000000-0000-4000-8000-000000000001',
    orgName: 'Isolation Test Organisation',
    siteId: '20000000-0000-4000-8000-000000000002',
    siteName: 'Isolation Test Site',
    timezone: 'Australia/Sydney',
    members: [{ subjectEnv: 'DEV_SECOND_ORG_OIDC_SUB', role: 'owner', name: 'Second Owner' }],
  },
} as const satisfies Record<string, SeedOrg>;

/**
 * Adds the member when its subject has no row yet, and names an unnamed one. A row that exists
 * keeps its role. A name already used in the organisation (removed members included, as the
 * unique index counts them) gets the subject's first 8 characters appended, so a re-seed after
 * `npm run setup -- --force` (new subjects, old rows kept) never fails.
 */
async function seedMember(
  client: pg.Client,
  orgId: string,
  member: SeedMember,
  subject: string,
): Promise<string> {
  const taken = await client.query(
    'SELECT 1 FROM membership WHERE org_id = $1 AND lower(display_name) = lower($2)',
    [orgId, member.name],
  );
  const name = taken.rows.length === 0 ? member.name : `${member.name} (${subject.slice(0, 8)})`;
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM membership WHERE org_id = $1 AND oidc_sub = $2',
    [orgId, subject],
  );
  const row = existing.rows[0];
  if (row !== undefined) {
    await client.query(
      'UPDATE membership SET display_name = $2 WHERE id = $1 AND display_name IS NULL',
      [row.id, name],
    );
    return `${member.role} membership already present`;
  }
  await client.query(
    'INSERT INTO membership (org_id, oidc_sub, role, display_name) VALUES ($1, $2, $3, $4)',
    [orgId, subject, member.role, name],
  );
  return `${member.role} membership created`;
}

async function seedOrganisation(client: pg.Client, org: SeedOrg): Promise<string> {
  const subjects = org.members.map((member) => requireEnv(member.subjectEnv));
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
    const notes: string[] = [];
    for (const [index, member] of org.members.entries()) {
      notes.push(await seedMember(client, org.orgId, member, subjects[index] ?? ''));
    }
    await client.query('COMMIT');
    return `${org.orgName}: site "${org.siteName}" (${org.timezone}); ${notes.join(', ')}`;
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
