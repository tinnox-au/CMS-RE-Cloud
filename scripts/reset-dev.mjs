#!/usr/bin/env node
// Destroys ALL local development state: the PostgreSQL volume, the Keycloak container
// (and with it the imported realm), uploaded media and worker job files under ./data.
// Keeps .env and infra/.generated so the same development secrets are reused.
//   npm run reset -- --yes
// Afterwards: npm run infra:up && npm run db:migrate && npm run db:seed
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
if (!process.argv.includes('--yes')) {
  console.error(
    'This deletes the local database, the Keycloak realm state and ./data (uploaded media).',
  );
  console.error('Run again with --yes to confirm:  npm run reset -- --yes');
  process.exit(2);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run with NODE_ENV=production.');
  process.exit(2);
}
if (!existsSync(join(root, '.env'))) {
  console.error('.env not found; nothing to reset. Run "npm run setup" first.');
  process.exit(2);
}

const down = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    join(root, '.env'),
    '-f',
    join(root, 'infra', 'docker-compose.yml'),
    '--profile',
    'worker',
    'down',
    '--volumes',
    '--remove-orphans',
  ],
  {
    stdio: 'inherit',
  },
);
if (down.status !== 0) {
  console.error('docker compose down failed; ./data was not removed.');
  process.exit(1);
}
const data = join(root, 'data');
if (data.startsWith(root + '/') && existsSync(data)) {
  rmSync(data, { recursive: true, force: true });
  console.log('Removed ./data');
}
console.log('Local state removed. Next: npm run infra:up && npm run db:migrate && npm run db:seed');
