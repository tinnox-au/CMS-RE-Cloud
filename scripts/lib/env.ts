import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Loads the repository's .env if present. Variables already set in the environment win (CI sets them directly). */
export function loadEnv(): void {
  const path = join(repoRoot, '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. Run "npm run setup" first (or set it in the environment).`,
    );
  }
  return value;
}
