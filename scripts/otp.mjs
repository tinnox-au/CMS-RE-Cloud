#!/usr/bin/env node
// Prints the current one-time code (TOTP) for a development sign-in.
//   npm run otp                      the operator, Owner of "TINNOX Internal"
//   npm run otp -- --as <user>       operator | second | admin | editor | viewer: the Owner, the
//                                    Owner of the second test organisation, or the Admin, Editor
//                                    or Viewer of "TINNOX Internal"
//   npm run otp -- --second          the same as --as second
//   npm run otp -- --show-password   also print the generated password
// Reads the gitignored infra/.generated/dev-credentials.json written by `npm run setup`.
// These are synthetic development identities for the local Keycloak realm only.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const PERIOD_SECONDS = 30;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** --as value → key in dev-credentials.json. */
const USERS = {
  operator: 'operator',
  second: 'secondOrgOperator',
  admin: 'admin',
  editor: 'editor',
  viewer: 'viewer',
};
let values;
try {
  ({ values } = parseArgs({
    options: {
      as: { type: 'string' },
      second: { type: 'boolean' },
      'show-password': { type: 'boolean' },
    },
    strict: true,
  }));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const as = values.as ?? (values.second ? 'second' : 'operator');
if (!Object.hasOwn(USERS, as)) {
  console.error(`--as takes one of ${Object.keys(USERS).join(', ')}.`);
  process.exit(2);
}
const key = USERS[as];

let user;
try {
  user = JSON.parse(
    readFileSync(join(root, 'infra', '.generated', 'dev-credentials.json'), 'utf8'),
  )[key];
} catch {
  console.error('infra/.generated/dev-credentials.json not found. Run "npm run setup" first.');
  process.exit(2);
}
if (!user || typeof user.totpSecretBase32 !== 'string') {
  console.error(`No development user "${key}" in dev-credentials.json.`);
  process.exit(2);
}

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('TOTP secret is not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// RFC 6238 with the realm's settings: HMAC-SHA1, 6 digits, 30-second step.
function totp(secret, atMs) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / PERIOD_SECONDS)));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 1_000_000).padStart(6, '0');
}

const now = Date.now();
const secondsLeft = PERIOD_SECONDS - (Math.floor(now / 1000) % PERIOD_SECONDS);
console.log(`Username:       ${user.username}`);
if (values['show-password']) console.log(`Password:       ${user.password}`);
else console.log('Password:       (hidden; add "-- --show-password" to print it)');
console.log(
  `One-time code:  ${totp(base32Decode(user.totpSecretBase32), now)}   (valid for ${secondsLeft} s)`,
);
console.log('Keycloak accepts each code once; wait for the next one before signing in again.');
