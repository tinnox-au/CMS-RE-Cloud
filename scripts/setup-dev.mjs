#!/usr/bin/env node
// Generates local development configuration. Nothing here is for production.
//
//   .env                                   database passwords, session secret, media-URL HMAC secret,
//                                          OIDC client secret, provisioning reader secret, ports and URLs
//   infra/.generated/tinnox-dev-realm.json Keycloak realm import (built from infra/keycloak/realm-template.json)
//   infra/.generated/dev-credentials.json  test users' passwords and TOTP secrets, for you and for automated tests
//
// All three are gitignored. Existing values are kept: running this again changes nothing
// unless you pass --force, which regenerates every secret (then recreate the containers
// with `npm run reset -- --yes`, because PostgreSQL and Keycloak keep the old ones).
//
// Options: --force   regenerate all secrets
//          --quiet   do not print the generated sign-in details
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const generatedDir = join(root, 'infra', '.generated');
const realmPath = join(generatedDir, 'tinnox-dev-realm.json');
const credentialsPath = join(generatedDir, 'dev-credentials.json');
const templatePath = join(root, 'infra', 'keycloak', 'realm-template.json');

const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (arg !== '--force' && arg !== '--quiet') {
    console.error(`Unknown option ${arg}. Options: --force, --quiet`);
    process.exit(2);
  }
}
const force = args.has('--force');
const quiet = args.has('--quiet');

/** Every generated secret starts with this marker so a production start-up can refuse it (D19). */
const DEV_PREFIX = 'dev-';
const secret = (bytes = 32) => DEV_PREFIX + randomBytes(bytes).toString('base64url');

function alphanumeric(length) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

function base32(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) map.set(match[1], match[2]);
  }
  return map;
}

function writePrivate(path, content) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

function portIsFreeOn(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    // A host without IPv6 cannot have the port taken on ::1.
    server.once('error', (error) =>
      resolve(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT'),
    );
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

// Free on both loopback addresses: a client that resolves "localhost" to ::1 must not reach
// another program that happens to hold the same port there.
async function portIsFree(port) {
  return (await portIsFreeOn(port, '127.0.0.1')) && (await portIsFreeOn(port, '::1'));
}

async function choosePostgresPort() {
  for (let port = 54329; port < 54340; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(
    'No port between 54329 and 54339 is free on both 127.0.0.1 and ::1 for PostgreSQL',
  );
}

const existingEnv =
  !force && existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : new Map();
const existingCredentials =
  !force && existsSync(credentialsPath) ? JSON.parse(readFileSync(credentialsPath, 'utf8')) : null;

const created = [];
const keep = (key, make) => {
  const current = existingEnv.get(key);
  if (current !== undefined && current !== '') return current;
  created.push(key);
  return String(make());
};

// ---- test users (Keycloak) -------------------------------------------------

function makeUser(username, firstName, lastName) {
  const totpSecret = alphanumeric(32);
  return {
    username,
    firstName,
    lastName,
    email: `${username}@tinnox-dev.invalid`,
    // Fixed at import time, so it is also the OIDC "sub" claim the API sees.
    oidcSub: randomUUID(),
    password: `${alphanumeric(8)}-${alphanumeric(8)}-${alphanumeric(8)}`,
    // Keycloak uses the bytes of this text as the TOTP key.
    totpSecret,
    // The same key in base32, the form authenticator apps and otplib expect.
    totpSecretBase32: base32(Buffer.from(totpSecret, 'utf8')),
  };
}

const credentials = existingCredentials ?? {
  note: 'LOCAL DEVELOPMENT ONLY. Generated by scripts/setup-dev.mjs. Never commit or reuse these values.',
  realm: 'tinnox-dev',
  totp: { algorithm: 'SHA1', digits: 6, period: 30 },
  // Owner of "TINNOX Internal"; every e2e spec defaults to it.
  operator: makeUser('operator', 'Dev', 'Operator'),
  // Owner of a second organisation that exists only in automated isolation tests.
  secondOrgOperator: makeUser('second-operator', 'Second', 'Operator'),
};
if (existingCredentials === null) created.push('infra/.generated/dev-credentials.json');
// One member per other role in "TINNOX Internal" (the seed gives them their roles). Added to an
// existing file without touching the users already there. Not "dev-admin": that is the
// master-realm bootstrap user.
const addedUsers = [];
for (const [key, username, lastName] of [
  ['admin', 'org-admin', 'Admin'],
  ['editor', 'editor', 'Editor'],
  ['viewer', 'viewer', 'Viewer'],
]) {
  if (credentials[key] !== undefined) continue;
  credentials[key] = makeUser(username, 'Dev', lastName);
  if (existingCredentials !== null) addedUsers.push(key);
}
if (addedUsers.length > 0) {
  created.push(`infra/.generated/dev-credentials.json (users ${addedUsers.join(', ')})`);
}
const devUsers = ['operator', 'secondOrgOperator', 'admin', 'editor', 'viewer'].map(
  (key) => credentials[key],
);

// ---- .env ------------------------------------------------------------------

const postgresPort = existingEnv.get('POSTGRES_HOST_PORT') || String(await choosePostgresPort());
if (!existingEnv.has('POSTGRES_HOST_PORT')) created.push('POSTGRES_HOST_PORT');

const migratorPassword = keep('TINNOX_MIGRATOR_PASSWORD', () => secret(24));
const appPassword = keep('TINNOX_APP_PASSWORD', () => secret(24));
const dbUrl = (role, password, database) =>
  `postgres://${role}:${encodeURIComponent(password)}@127.0.0.1:${postgresPort}/${database}`;

const apiOrigin = 'http://localhost:4000';
const portalOrigin = 'http://localhost:5173';
const playerOrigin = 'http://localhost:5174';
const issuer = 'http://localhost:8080/realms/tinnox-dev';

const sections = [
  [
    'Generated by scripts/setup-dev.mjs for LOCAL DEVELOPMENT ONLY. Do not commit. Do not reuse anywhere else.\n# Every secret below starts with "dev-"; a NODE_ENV=production start-up must refuse such values.',
    { NODE_ENV: 'development', LOG_LEVEL: 'info' },
  ],
  [
    'PostgreSQL (Docker, bound to 127.0.0.1)',
    {
      POSTGRES_HOST_PORT: postgresPort,
      POSTGRES_SUPERUSER_PASSWORD: keep('POSTGRES_SUPERUSER_PASSWORD', () => secret(24)),
      TINNOX_MIGRATOR_PASSWORD: migratorPassword,
      TINNOX_APP_PASSWORD: appPassword,
      DATABASE_URL: dbUrl('tinnox_app', appPassword, 'tinnox'),
      DATABASE_MIGRATOR_URL: dbUrl('tinnox_migrator', migratorPassword, 'tinnox'),
      TEST_DATABASE_URL: dbUrl('tinnox_app', appPassword, 'tinnox_test'),
      TEST_DATABASE_MIGRATOR_URL: dbUrl('tinnox_migrator', migratorPassword, 'tinnox_test'),
    },
  ],
  [
    'API',
    {
      API_HOST: '127.0.0.1',
      API_PORT: '4000',
      API_PUBLIC_ORIGIN: apiOrigin,
      PORTAL_ORIGIN: portalOrigin,
      PLAYER_ORIGIN: playerOrigin,
      SESSION_SECRET: keep('SESSION_SECRET', () => secret(48)),
      SESSION_TTL_SECONDS: '28800',
      SESSION_IDLE_TIMEOUT_SECONDS: '1800',
      MEDIA_URL_HMAC_SECRET: keep('MEDIA_URL_HMAC_SECRET', () => secret(48)),
      PAIRING_CLIENT_KEY_SECRET: keep('PAIRING_CLIENT_KEY_SECRET', () => secret(32)),
    },
  ],
  [
    'Identity provider (local Keycloak, development realm)',
    {
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: 'tinnox-portal-bff',
      OIDC_CLIENT_SECRET: keep('OIDC_CLIENT_SECRET', () => secret(32)),
      OIDC_REDIRECT_URI: `${portalOrigin}/api/auth/callback`,
      OIDC_POST_LOGOUT_REDIRECT_URI: `${portalOrigin}/`,
      KC_BOOTSTRAP_ADMIN_USERNAME: 'dev-admin',
      KC_BOOTSTRAP_ADMIN_PASSWORD: keep('KC_BOOTSTRAP_ADMIN_PASSWORD', () => secret(24)),
    },
  ],
  [
    'Development identities. The seed script attaches memberships to these OIDC subjects.',
    {
      DEV_OPERATOR_OIDC_SUB: credentials.operator.oidcSub,
      DEV_SECOND_ORG_OIDC_SUB: credentials.secondOrgOperator.oidcSub,
      DEV_ADMIN_OIDC_SUB: credentials.admin.oidcSub,
      DEV_EDITOR_OIDC_SUB: credentials.editor.oidcSub,
      DEV_VIEWER_OIDC_SUB: credentials.viewer.oidcSub,
    },
  ],
  [
    'Provisioning (scripts/provision-member.ts). TINNOX staff run it from a controlled host; this\n# identity-provider client can only read accounts (view-users). Never give it to the API.',
    {
      PROVISION_IDP_CLIENT_ID: 'tinnox-provisioning',
      PROVISION_IDP_CLIENT_SECRET: keep('PROVISION_IDP_CLIENT_SECRET', () => secret(32)),
    },
  ],
  [
    'Media storage and the validation worker exchange directory (relative to the repository root)',
    { MEDIA_ROOT: './data/media', MEDIA_JOBS_DIR: './data/jobs' },
  ],
];

// Keep any extra variables a developer added by hand (for example LIMIT_* overrides).
const known = new Set(sections.flatMap(([, values]) => Object.keys(values)));
const extras = [...existingEnv].filter(([key]) => !known.has(key));

let envText = '';
for (const [title, values] of sections) {
  envText += `# ${title}\n`;
  for (const [key, value] of Object.entries(values)) envText += `${key}=${value}\n`;
  envText += '\n';
}
if (extras.length > 0) {
  envText += '# Added by hand (preserved)\n';
  for (const [key, value] of extras) envText += `${key}=${value}\n`;
}
writePrivate(envPath, envText);

// ---- Keycloak realm import -------------------------------------------------

const env = parseEnv(envText);
const realm = JSON.parse(readFileSync(templatePath, 'utf8'));
delete realm._comment;
const clientById = (clientId) => {
  const found = realm.clients.find((c) => c.clientId === clientId);
  if (!found) throw new Error(`realm template has no client ${clientId}`);
  return found;
};
const client = clientById('tinnox-portal-bff');
client.secret = env.get('OIDC_CLIENT_SECRET');
client.rootUrl = portalOrigin;
client.baseUrl = '/';
// Exact redirect URIs, no wildcards: through the portal dev proxy (D7) and directly on the API.
client.redirectUris = [`${portalOrigin}/api/auth/callback`, `${apiOrigin}/api/auth/callback`];
client.attributes['post.logout.redirect.uris'] = `${portalOrigin}/`;
clientById('tinnox-provisioning').secret = env.get('PROVISION_IDP_CLIENT_SECRET');

// Appended: the template's own users (the provisioning client's service account) stay.
realm.users = [
  ...realm.users,
  ...devUsers.map((user) => ({
    id: user.oidcSub,
    username: user.username,
    enabled: true,
    emailVerified: true,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    requiredActions: [],
    credentials: [
      { type: 'password', value: user.password, temporary: false },
      {
        type: 'otp',
        userLabel: 'development authenticator',
        secretData: JSON.stringify({ value: user.totpSecret }),
        credentialData: JSON.stringify({
          subType: 'totp',
          digits: 6,
          counter: 0,
          period: 30,
          algorithm: 'HmacSHA1',
        }),
      },
    ],
  })),
];

mkdirSync(generatedDir, { recursive: true, mode: 0o700 });
writePrivate(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`);
writePrivate(realmPath, `${JSON.stringify(realm, null, 2)}\n`);
// The Keycloak container runs as a non-root user and must be able to read the import file.
chmodSync(generatedDir, 0o755);
chmodSync(realmPath, 0o644);

// Runtime data directories (gitignored). Created here, before any container starts, so the
// media worker's bind mount is owned by the developer and not created by Docker as root.
// The worker (uid 10001) only reads the inbox and writes verdicts into the sticky outbox.
const dataDir = join(root, 'data');
for (const [dir, mode] of [
  [join(dataDir, 'media'), 0o700],
  [join(dataDir, 'jobs'), 0o755],
  [join(dataDir, 'jobs', 'inbox'), 0o755],
  [join(dataDir, 'jobs', 'outbox'), 0o1777],
]) {
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, mode);
}

// ---- report ----------------------------------------------------------------

console.log(
  created.length === 0
    ? 'Development configuration already present; nothing regenerated.'
    : `Generated: ${created.join(', ')}`,
);
console.log(
  `Wrote .env, infra/.generated/tinnox-dev-realm.json and infra/.generated/dev-credentials.json (all gitignored).`,
);
if (postgresPort !== '54329') {
  console.log(
    `Note: port 54329 was in use on this machine, so PostgreSQL is mapped to 127.0.0.1:${postgresPort} (POSTGRES_HOST_PORT).`,
  );
}
if (force) {
  console.log(
    'Secrets were regenerated. Recreate the containers so they pick them up: npm run reset -- --yes && npm run infra:up',
  );
}
// Keycloak imports the realm only when it does not exist yet (infra/docker-compose.yml).
if (
  addedUsers.length > 0 ||
  (existingEnv.size > 0 && created.includes('PROVISION_IDP_CLIENT_SECRET'))
) {
  console.log(
    `New development ${addedUsers.length > 0 ? 'users were' : 'identity-provider settings were'} added. Recreate the Keycloak container so it imports them: \`docker compose --env-file .env -f infra/docker-compose.yml rm -sf keycloak && npm run infra:up\``,
  );
}
if (quiet) {
  console.log(
    'Sign-in details were not printed (--quiet). They are in infra/.generated/dev-credentials.json.',
  );
} else {
  const o = credentials.operator;
  console.log(
    '\nDevelopment sign-in (local Keycloak only; shown here and stored in infra/.generated/dev-credentials.json):',
  );
  console.log(`  Portal:        ${portalOrigin}`);
  console.log(`  Username:      ${o.username}`);
  console.log(`  Password:      ${o.password}`);
  console.log(`  TOTP secret:   ${o.totpSecretBase32}  (base32, SHA1, 6 digits, 30 s)`);
  console.log(
    `  Authenticator: otpauth://totp/tinnox-dev:${o.username}?secret=${o.totpSecretBase32}&issuer=tinnox-dev`,
  );
  console.log(
    `  Keycloak admin console: http://localhost:8080  user ${env.get('KC_BOOTSTRAP_ADMIN_USERNAME')}, password in .env (KC_BOOTSTRAP_ADMIN_PASSWORD)`,
  );
  console.log(
    'Other development users: org-admin, editor, viewer (`npm run otp -- --as admin|editor|viewer`).',
  );
}
console.log('\nNext: npm run infra:up && npm run db:migrate && npm run db:seed');
