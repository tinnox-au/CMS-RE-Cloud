import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const strong = (label: string): string => `${label}-9f2c7a1d4b8e6035a7c1d9e2f4b6a8c0e1d3f5a7`;

const development: Record<string, string> = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://tinnox_app:dev-local-password@127.0.0.1:54329/tinnox',
  API_PUBLIC_ORIGIN: 'http://localhost:4000',
  PORTAL_ORIGIN: 'http://localhost:5173',
  PLAYER_ORIGIN: 'http://localhost:5174',
  SESSION_SECRET: 'dev-session-secret-0123456789abcdef0123456789abcdef',
  MEDIA_URL_HMAC_SECRET: 'dev-media-secret-0123456789abcdef0123456789abcdef',
  PAIRING_CLIENT_KEY_SECRET: 'dev-pairing-secret-0123456789abcdef0123456789abcdef',
  OIDC_ISSUER: 'http://localhost:8080/realms/tinnox-dev',
  OIDC_CLIENT_ID: 'tinnox-portal-bff',
  OIDC_CLIENT_SECRET: 'dev-client-secret-0123456789abcdef',
  OIDC_REDIRECT_URI: 'http://localhost:5173/api/auth/callback',
  OIDC_POST_LOGOUT_REDIRECT_URI: 'http://localhost:5173/',
};

const production: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: `postgres://tinnox_app:${strong('db')}@db.internal:5432/tinnox`,
  API_PUBLIC_ORIGIN: 'https://api.signage.example',
  PORTAL_ORIGIN: 'https://portal.signage.example',
  PLAYER_ORIGIN: 'https://player.signage.example',
  SESSION_SECRET: strong('session'),
  MEDIA_URL_HMAC_SECRET: strong('media'),
  PAIRING_CLIENT_KEY_SECRET: strong('pairing'),
  OIDC_ISSUER: 'https://id.signage.example/realms/operators',
  OIDC_CLIENT_ID: 'portal',
  OIDC_CLIENT_SECRET: strong('client'),
  OIDC_REDIRECT_URI: 'https://portal.signage.example/api/auth/callback',
  OIDC_POST_LOGOUT_REDIRECT_URI: 'https://portal.signage.example/',
  OIDC_MFA_AMR_VALUES: 'otp, mfa',
};

function problems(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return [...error.problems];
    throw error;
  }
  return [];
}

describe('loadConfig in development', () => {
  it('accepts the generated loopback configuration', () => {
    const config = loadConfig(development);
    expect(config.secureCookies).toBe(false);
    expect(config.sessionCookieName).toBe('tinnox_session');
    expect(config.oidc.allowInsecureRequests).toBe(true);
    expect(config.port).toBe(4000);
    expect(config.mediaRoot.endsWith('/data/media')).toBe(true);
    expect(config.limits.maxUploadBytes).toBe(200 * 1024 * 1024);
  });

  it('refuses plain http anywhere but loopback, even outside production', () => {
    expect(
      problems({ ...development, PORTAL_ORIGIN: 'http://portal.example.com' }).join(' '),
    ).toContain('PORTAL_ORIGIN may use http only on a loopback host');
    expect(
      problems({ ...development, OIDC_ISSUER: 'http://id.example.com/realms/x' }).join(' '),
    ).toContain('OIDC_ISSUER may use http only on a loopback host');
  });

  it('refuses the same origin for portal and player', () => {
    expect(
      problems({ ...development, PLAYER_ORIGIN: development['PORTAL_ORIGIN'] }).join(' '),
    ).toContain('must be different origins');
  });

  it('refuses a redirect URI that is not the callback route on a known origin', () => {
    for (const uri of [
      'http://localhost:5173/api/auth/other',
      'http://localhost:9999/api/auth/callback',
      'http://localhost:5173/api/auth/callback?next=/x',
    ]) {
      expect(problems({ ...development, OIDC_REDIRECT_URI: uri }).join(' ')).toContain(
        'OIDC_REDIRECT_URI must be',
      );
    }
    expect(
      problems({ ...development, OIDC_REDIRECT_URI: 'http://localhost:4000/api/auth/callback' }),
    ).toEqual([]);
  });

  it('refuses to run as any database role but tinnox_app', () => {
    expect(
      problems({
        ...development,
        DATABASE_URL: 'postgres://tinnox_migrator:x@127.0.0.1:54329/tinnox',
      }).join(' '),
    ).toContain('must connect as the runtime role tinnox_app');
  });

  it('refuses short or reused secrets and invalid limits', () => {
    expect(problems({ ...development, SESSION_SECRET: 'short' }).join(' ')).toContain(
      'SESSION_SECRET',
    );
    expect(
      problems({ ...development, MEDIA_URL_HMAC_SECRET: development['SESSION_SECRET'] }).join(' '),
    ).toContain('three different values');
    expect(problems({ ...development, LIMIT_MAX_UPLOAD_BYTES: '-5' }).join(' ')).toContain(
      'LIMIT_MAX_UPLOAD_BYTES',
    );
    expect(
      problems({ ...development, SESSION_IDLE_TIMEOUT_SECONDS: '90000' }).length,
    ).toBeGreaterThan(0);
  });

  it('never puts a secret value in an error message', () => {
    const text = problems({ ...development, NODE_ENV: 'production' }).join(' ');
    for (const name of [
      'SESSION_SECRET',
      'MEDIA_URL_HMAC_SECRET',
      'PAIRING_CLIENT_KEY_SECRET',
      'OIDC_CLIENT_SECRET',
    ]) {
      expect(text).not.toContain(development[name]);
    }
    expect(text).not.toContain('dev-local-password');
  });
});

describe('loadConfig in production (D19)', () => {
  it('accepts a complete https configuration with real secrets', () => {
    const config = loadConfig(production);
    expect(config.secureCookies).toBe(true);
    expect(config.sessionCookieName).toBe('__Host-tinnox_session');
    expect(config.loginCookieName).toBe('__Host-tinnox_login');
    expect(config.oidc.allowInsecureRequests).toBe(false);
    expect(config.oidc.mfaAmrValues).toEqual(['otp', 'mfa']);
  });

  it('refuses the whole development configuration, naming every reason', () => {
    const found = problems({ ...development, NODE_ENV: 'production' });
    const text = found.join('\n');
    for (const expected of [
      'SESSION_SECRET is a development or placeholder value',
      'MEDIA_URL_HMAC_SECRET is a development or placeholder value',
      'PAIRING_CLIENT_KEY_SECRET is a development or placeholder value',
      'OIDC_CLIENT_SECRET is a development or placeholder value',
      'DATABASE_URL password is a development or placeholder value',
      'OIDC_ISSUER must use https in production',
      'OIDC_ISSUER points at the development realm tinnox-dev',
      'API_PUBLIC_ORIGIN must use https in production',
      'PORTAL_ORIGIN must use https in production',
      'PLAYER_ORIGIN must use https in production',
      'OIDC_REDIRECT_URI must use https in production',
      'production requires MFA evidence',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it.each([
    ['SESSION_SECRET', 'dev-0123456789abcdef0123456789abcdef0123456789'],
    ['MEDIA_URL_HMAC_SECRET', 'DEV-0123456789abcdef0123456789abcdef0123456789'],
    ['PAIRING_CLIENT_KEY_SECRET', 'change-me-change-me-change-me-change-me'],
    ['OIDC_CLIENT_SECRET', 'dev-0123456789abcdef0123456789abcdef'],
    ['DATABASE_URL', 'postgres://tinnox_app:dev-password@db.internal:5432/tinnox'],
  ])('refuses a development value in %s', (name, value) => {
    expect(problems({ ...production, [name]: value }).join(' ')).toContain(
      'development or placeholder value',
    );
  });

  it.each([
    ['API_PUBLIC_ORIGIN', 'http://api.signage.example'],
    ['PORTAL_ORIGIN', 'http://localhost:5173'],
    ['PLAYER_ORIGIN', 'http://127.0.0.1:5174'],
    ['OIDC_ISSUER', 'http://localhost:8080/realms/operators'],
  ])('refuses plain http for %s, loopback included', (name, value) => {
    expect(problems({ ...production, [name]: value }).join(' ')).toContain(
      `${name} must use https in production`,
    );
  });

  it('refuses the development realm even over https', () => {
    expect(
      problems({ ...production, OIDC_ISSUER: 'https://id.signage.example/realms/tinnox-dev' }).join(
        ' ',
      ),
    ).toContain('development realm');
  });

  it('refuses to start without an MFA evidence requirement', () => {
    const { OIDC_MFA_AMR_VALUES: _removed, ...withoutMfa } = production;
    expect(problems(withoutMfa).join(' ')).toContain('production requires MFA evidence');
    expect(problems({ ...withoutMfa, OIDC_MFA_ACR_VALUES: 'urn:example:mfa' })).toEqual([]);
  });
});

describe('TRUST_PROXY', () => {
  it('refuses "true" in every mode, because the client controls the leftmost X-Forwarded-For entry', () => {
    expect(problems({ ...development, TRUST_PROXY: 'true' }).join(' ')).toMatch(/TRUST_PROXY=true/);
    expect(problems({ ...production, TRUST_PROXY: 'true' }).join(' ')).toMatch(/TRUST_PROXY=true/);
  });

  it('accepts no proxy, or explicit proxy addresses and ranges', () => {
    expect(loadConfig(development).trustProxy).toBe(false);
    expect(loadConfig({ ...development, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(loadConfig({ ...production, TRUST_PROXY: '10.0.0.0/8, 192.0.2.7' }).trustProxy).toBe(
      '10.0.0.0/8,192.0.2.7',
    );
    expect(loadConfig({ ...development, TRUST_PROXY: 'loopback' }).trustProxy).toBe('loopback');
    expect(loadConfig({ ...development, TRUST_PROXY: '2001:db8::/32' }).trustProxy).toBe(
      '2001:db8::/32',
    );
  });

  it('refuses malformed or over-broad values', () => {
    for (const value of [
      'yes',
      '1',
      '11',
      '0.0.0.0/0',
      '10.0.0.0/4',
      '::/0',
      '10.0.0.1/33',
      'proxy.internal',
      '1.2.3.4/8/9',
    ]) {
      expect(problems({ ...development, TRUST_PROXY: value }).join(' '), value).toMatch(
        /TRUST_PROXY/,
      );
    }
  });

  it('with the proxy listed, a client cannot choose its own address through X-Forwarded-For', async () => {
    const { default: Fastify } = await import('fastify');
    const config = loadConfig({ ...development, TRUST_PROXY: '10.0.0.2' });
    const app = Fastify({ trustProxy: config.trustProxy });
    app.get('/ip', (request) => ({ ip: request.ip }));
    try {
      const spoofed = await app.inject({
        url: '/ip',
        remoteAddress: '10.0.0.2',
        headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' },
      });
      // The proxy (10.0.0.2) appended the real client; the client's own entry is ignored.
      expect(spoofed.json()).toEqual({ ip: '203.0.113.9' });
    } finally {
      await app.close();
    }
  });
});
