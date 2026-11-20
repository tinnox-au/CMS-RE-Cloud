/**
 * Development identities for automated sign-in. Reads the gitignored file written
 * by scripts/setup-dev.mjs; nothing here is a committed credential. Never log the
 * returned values and never capture them in screenshots or traces.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSync } from 'otplib';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface DevUser {
  readonly username: string;
  readonly password: string;
  /** The OIDC "sub" claim; equals membership.oidc_sub after seeding. */
  readonly oidcSub: string;
  readonly totpSecretBase32: string;
}

export type DevUserName = 'operator' | 'secondOrgOperator' | 'admin' | 'editor' | 'viewer';

export function devUser(name: DevUserName = 'operator'): DevUser {
  const path = join(repoRoot, 'infra', '.generated', 'dev-credentials.json');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('infra/.generated/dev-credentials.json is missing; run "npm run setup" first');
  }
  const user = parsed[name] as Partial<DevUser> | undefined;
  if (
    user === undefined ||
    typeof user.username !== 'string' ||
    typeof user.password !== 'string' ||
    typeof user.oidcSub !== 'string' ||
    typeof user.totpSecretBase32 !== 'string'
  ) {
    throw new Error(`development user "${name}" is not present in dev-credentials.json`);
  }
  return {
    username: user.username,
    password: user.password,
    oidcSub: user.oidcSub,
    totpSecretBase32: user.totpSecretBase32,
  };
}

/**
 * Current 6-digit one-time code for a development user (SHA-1, 30 s period, as
 * configured in the realm). Keycloak refuses to accept the same code twice, so
 * a test that signs the same user in repeatedly must wait for the next 30 s window.
 */
export function totpCode(user: DevUser, atEpochSeconds?: number): string {
  return generateSync({
    secret: user.totpSecretBase32,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
    ...(atEpochSeconds === undefined ? {} : { epoch: atEpochSeconds }),
  });
}
