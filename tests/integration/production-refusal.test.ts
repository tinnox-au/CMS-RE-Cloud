/**
 * D19 and brief section 6: the real API entry point, started with NODE_ENV=production
 * and the development configuration, must exit without ever listening.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './support.ts';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

function runApi(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: join(repoRoot, 'apps', 'api'),
      env: { PATH: process.env['PATH'] ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the API kept running with an unacceptable configuration:\n${output}`));
    }, 20_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

async function listening(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

describe('production start-up', () => {
  const envFile = join(repoRoot, '.env');
  const devEnv: Record<string, string> = existsSync(envFile)
    ? (parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>)
    : {};

  it('has a generated development configuration to test with', () => {
    expect(devEnv['SESSION_SECRET'] ?? '').toMatch(/^dev-/);
  });

  it('refuses the development configuration and names each problem without printing a value', async () => {
    const port = await freePort();
    const result = await runApi({ ...devEnv, NODE_ENV: 'production', API_PORT: String(port) });
    expect(result.code).toBe(1);
    expect(await listening(port)).toBe(false);
    for (const expected of [
      'SESSION_SECRET is a development or placeholder value',
      'MEDIA_URL_HMAC_SECRET is a development or placeholder value',
      'OIDC_CLIENT_SECRET is a development or placeholder value',
      'OIDC_ISSUER points at the development realm tinnox-dev',
      'must use https in production',
      'production requires MFA evidence',
    ]) {
      expect(result.output).toContain(expected);
    }
    for (const name of [
      'SESSION_SECRET',
      'MEDIA_URL_HMAC_SECRET',
      'PAIRING_CLIENT_KEY_SECRET',
      'OIDC_CLIENT_SECRET',
      'TINNOX_APP_PASSWORD',
    ]) {
      const value = devEnv[name] ?? '';
      expect(value.length).toBeGreaterThan(8);
      expect(result.output, `${name} must not be printed`).not.toContain(value);
    }
  });

  it('still refuses when only one development setting is left', async () => {
    const strong = (): string =>
      'k'.repeat(8) + Math.random().toString(36).slice(2) + 'Zq9'.repeat(12);
    const production: Record<string, string> = {
      ...devEnv,
      NODE_ENV: 'production',
      API_PUBLIC_ORIGIN: 'https://api.cms.example',
      PORTAL_ORIGIN: 'https://portal.cms.example',
      PLAYER_ORIGIN: 'https://player.cms.example',
      OIDC_ISSUER: 'https://id.example/realms/tinnox',
      OIDC_REDIRECT_URI: 'https://portal.cms.example/api/auth/callback',
      OIDC_POST_LOGOUT_REDIRECT_URI: 'https://portal.cms.example/',
      OIDC_MFA_ACR_VALUES: 'mfa',
      OIDC_CLIENT_SECRET: strong(),
      SESSION_SECRET: strong(),
      MEDIA_URL_HMAC_SECRET: strong(),
      PAIRING_CLIENT_KEY_SECRET: strong(),
    };
    const cases: [string, Record<string, string>, string][] = [
      [
        'a development session secret',
        { SESSION_SECRET: devEnv['SESSION_SECRET'] ?? '' },
        'SESSION_SECRET is a development or placeholder value',
      ],
      [
        'the development realm',
        { OIDC_ISSUER: 'https://id.example/realms/tinnox-dev' },
        'development realm',
      ],
      [
        'a plain-http portal',
        { PORTAL_ORIGIN: 'http://portal.cms.example' },
        'PORTAL_ORIGIN must use https in production',
      ],
      ['no MFA evidence', { OIDC_MFA_ACR_VALUES: '' }, 'production requires MFA evidence'],
    ];
    for (const [what, override, message] of cases) {
      const port = await freePort();
      const result = await runApi({ ...production, ...override, API_PORT: String(port) });
      expect(result.code, what).toBe(1);
      expect(result.output, what).toContain(message);
      expect(await listening(port), what).toBe(false);
    }
  }, 120_000);
});
