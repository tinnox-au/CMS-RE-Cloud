#!/usr/bin/env node
// Scans for committed secrets with gitleaks, run from its pinned container image with
// no network and the files mounted read-only.
//   1. the whole git history;
//   2. the files git tracks or would track (so work that is not committed yet is covered).
// Gitignored files (.env, infra/.generated, data) hold generated development secrets by
// design and are not scanned; .gitignore is what keeps them out of the repository.
//   3. an exact-value check: the generated secrets on this machine must not appear in any
//      file of step 2 (catches a value copied into a doc, test or fixture).
//   npm run scan:secrets
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = 'ghcr.io/gitleaks/gitleaks:v8.30.1';
// Inside the repository (under the gitignored data/ directory) so Docker can mount it on every platform.
const staging = join(root, 'data', '.secret-scan');

function gitleaks(mount, args) {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp',
      '-v',
      `${mount}:/scan:ro`,
      IMAGE,
      ...args,
      '--redact',
      '--no-banner',
      '--exit-code',
      '1',
    ],
    { stdio: 'inherit' },
  );
  if (result.error) {
    console.error(`Could not run docker: ${result.error.message}`);
    return 2;
  }
  return result.status ?? 2;
}

console.log('gitleaks: scanning git history');
const history = gitleaks(root, ['git', '/scan']);

console.log('gitleaks: scanning tracked and not-yet-committed files');
const listed = spawnSync(
  'git',
  ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
);
if (listed.status !== 0) {
  console.error('git ls-files failed');
  process.exit(2);
}
const files = listed.stdout.split('\0').filter((f) => f !== '');
rmSync(staging, { recursive: true, force: true });
let copied = 0;
try {
  for (const file of files) {
    const source = join(root, file);
    if (!existsSync(source) || !lstatSync(source).isFile()) continue;
    const target = join(staging, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    copied += 1;
  }
  const working = copied === 0 ? 0 : gitleaks(staging, ['dir', '/scan']);
  const generated = findGeneratedSecrets(files);
  if (history !== 0 || working !== 0 || generated !== 0) {
    console.error(
      'Secret scan FAILED. Remove the secret, rotate it, and never commit generated credentials.',
    );
    process.exitCode = 1;
  } else {
    console.log(`Secret scan passed: git history and ${copied} working-tree files.`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

/**
 * Exact-value check: every secret this machine generated (.env and
 * infra/.generated/dev-credentials.json) must appear in no tracked or not-ignored file.
 * gitleaks matches patterns; this matches the actual values. Prints names, never values.
 */
function findGeneratedSecrets(fileList) {
  const values = new Map();
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, name, value] = match;
      if (/(SECRET|PASSWORD|TOKEN|KEY)/.test(name) && value.length >= 12) values.set(name, value);
      // Connection strings embed the role passwords.
      if (name.endsWith('_URL')) {
        const password = /:\/\/[^:/]+:([^@]+)@/.exec(value)?.[1];
        if (password && password.length >= 12) values.set(`${name} (password)`, password);
      }
    }
  }
  const credentialsPath = join(root, 'infra', '.generated', 'dev-credentials.json');
  if (existsSync(credentialsPath)) {
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    for (const [user, entry] of Object.entries(credentials)) {
      if (!entry || typeof entry !== 'object') continue;
      for (const field of ['password', 'totpSecretBase32']) {
        const value = entry[field];
        if (typeof value === 'string' && value.length >= 12) values.set(`${user}.${field}`, value);
      }
    }
  }
  if (values.size === 0) {
    console.log('generated-secret check: no .env or dev-credentials.json; nothing to compare');
    return 0;
  }
  let hits = 0;
  for (const file of fileList) {
    const source = join(root, file);
    if (!existsSync(source) || !lstatSync(source).isFile()) continue;
    const text = readFileSync(source).toString('latin1');
    for (const [name, value] of values) {
      if (text.includes(value)) {
        console.error(`generated secret ${name} found in ${file}`);
        hits += 1;
      }
    }
  }
  console.log(
    `generated-secret check: ${values.size} generated values compared against ${fileList.length} files; ${hits} found`,
  );
  return hits === 0 ? 0 : 1;
}
