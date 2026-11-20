// TINNOX's membership provisioning: new customers, invites, names, sign-in resets and lost Owners
// (docs/portal-v2/stage-c.md section 8.2). TINNOX staff run it from a controlled host, never
// from the API's host or container:
//   npm run provision -- <command> [options]      (npm run provision -- --help for the list)
// Environment (controlled host only): DATABASE_MIGRATOR_URL; PROVISION_IDP_ISSUER (default
// OIDC_ISSUER), PROVISION_IDP_CLIENT_ID and PROVISION_IDP_CLIENT_SECRET, the identity-provider
// client that can only read accounts. Exit 0 done, 1 refused or failed, 2 usage error.
import { CommitOutcomeUnknownError } from '@tinnox/db';
import pg from 'pg';
import { loadEnv, requireEnv } from './lib/env.ts';
import { keycloakDirectory, type IdpDirectory } from './lib/idp.ts';
import {
  RefusedError,
  USAGE,
  UsageError,
  fulfil,
  mfaReset,
  orgCreate,
  parseInvocation,
  pending,
  restoreOwner,
  setName,
  type Invocation,
  type Result,
} from './lib/provision.ts';

function run(pool: pg.Pool, idp: IdpDirectory, call: Invocation): Promise<Result> {
  switch (call.command) {
    case 'org-create':
      return orgCreate(pool, idp, call.args);
    case 'pending':
      return pending(pool, idp, call.args);
    case 'fulfil':
      return fulfil(pool, idp, call.args);
    case 'set-name':
      return setName(pool, idp, call.args);
    case 'mfa-reset':
      return mfaReset(pool, idp, call.args);
    case 'restore-owner':
      return restoreOwner(pool, idp, call.args);
  }
}

/** Returns the exit code (no process.exit, so nothing written to a pipe is lost). */
async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === 'help')) {
    console.log(USAGE);
    return 0;
  }
  let invocation: Invocation;
  try {
    invocation = parseInvocation(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }

  loadEnv();
  // Read on first use, so `pending` needs no identity-provider settings.
  const idp: IdpDirectory = {
    findByUsername: (username) =>
      keycloakDirectory({
        issuer: process.env['PROVISION_IDP_ISSUER'] || requireEnv('OIDC_ISSUER'),
        clientId: requireEnv('PROVISION_IDP_CLIENT_ID'),
        clientSecret: requireEnv('PROVISION_IDP_CLIENT_SECRET'),
      }).findByUsername(username),
  };
  let pool: pg.Pool | undefined;
  try {
    // One connection, not createPool: the commands run one transaction each, as the migrator.
    pool = new pg.Pool({
      connectionString: requireEnv('DATABASE_MIGRATOR_URL'),
      application_name: 'tinnox-provision',
      max: 1,
    });
    pool.on('error', () => undefined);
    const result = await run(pool, idp, invocation);
    for (const line of result.lines) console.log(line);
    return 0;
  } catch (error) {
    if (error instanceof CommitOutcomeUnknownError) {
      console.error('outcome unknown: run `pending` or read the audit log before running again');
    } else if (error instanceof RefusedError) {
      console.error(`refused: ${error.message}`);
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    return 1;
  } finally {
    await pool?.end().catch(() => undefined);
  }
}

process.exitCode = await main(process.argv.slice(2));
