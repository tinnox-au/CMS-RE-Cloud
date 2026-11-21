/**
 * Configuration loader. Reads the environment once, validates it with zod and
 * refuses unsafe combinations (prototype-m0.md D19, brief section 6).
 *
 * Rules that hold in every mode:
 *   - plain http origins are accepted only for loopback hosts;
 *   - portal and player must be different origins (D7);
 *   - the redirect URI must be the callback route on the portal or API origin.
 *   - e-mail is off without SMTP_HOST; with it, MAIL_FROM is required, and SMTP_USER and
 *     SMTP_PASSWORD come together.
 * Extra rules when NODE_ENV=production:
 *   - no secret may be a development value (prefix "dev-") or a placeholder (SMTP_PASSWORD too);
 *   - issuer, origins and redirect URIs must be https;
 *   - the development realm is refused;
 *   - an MFA evidence requirement (acr or amr) must be configured.
 */
import { isIP } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { limitsFromEnv, ROUTES, SESSION_COOKIE, type Limits } from '@tinnox/contracts';
import { z } from 'zod';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Refusing to start: ${problems.join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const origin = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
    } catch {
      return false;
    }
  }, 'must be an origin such as https://host or http://localhost:4000 (no path, no trailing slash)');

const httpUrl = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL');

const secret = z.string().min(32, 'must be at least 32 characters');
const intFromEnv = (min: number, max: number) =>
  z
    .string()
    .regex(/^[0-9]{1,9}$/, 'must be an integer')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: intFromEnv(1, 65535).default(4000),
  API_PUBLIC_ORIGIN: origin,
  PORTAL_ORIGIN: origin,
  PLAYER_ORIGIN: origin,
  SESSION_SECRET: secret,
  SESSION_TTL_SECONDS: intFromEnv(60, 86_400).default(28_800),
  SESSION_IDLE_TIMEOUT_SECONDS: intFromEnv(60, 86_400).default(1_800),
  MEDIA_URL_HMAC_SECRET: secret,
  PAIRING_CLIENT_KEY_SECRET: secret,
  OIDC_ISSUER: httpUrl,
  OIDC_CLIENT_ID: z.string().min(1).max(200),
  OIDC_CLIENT_SECRET: z.string().min(16, 'must be at least 16 characters'),
  OIDC_REDIRECT_URI: httpUrl,
  OIDC_POST_LOGOUT_REDIRECT_URI: httpUrl,
  /** Accepted `acr` values that prove multi-factor sign-in, comma separated. */
  OIDC_MFA_ACR_VALUES: csv,
  /** `amr` values of which at least one must be present, comma separated (for example "otp,mfa"). */
  OIDC_MFA_AMR_VALUES: csv,
  MEDIA_ROOT: z.string().min(1).default('./data/media'),
  MEDIA_JOBS_DIR: z.string().min(1).default('./data/jobs'),
  /**
   * Which X-Forwarded-For hops to believe: "false" (default, no proxy) or a comma-separated
   * list of the reverse proxies' addresses or CIDR ranges. "true" (believe every hop) is
   * refused: the client controls the leftmost entry. A hop count is refused too, because
   * Fastify 5.12 deliberately ignores X-Forwarded-For for hop-count trust (it cannot check
   * the immediate peer), so it would silently do nothing.
   */
  TRUST_PROXY: z.string().max(1000).default('false'),
  /** E-mail alerts (CMS-15) are off when unset. Any SMTP provider; SES offers SMTP too. */
  SMTP_HOST: z.string().max(253).optional(),
  /** 587 (STARTTLS) by default. */
  SMTP_PORT: intFromEnv(1, 65535).default(587),
  /** "true" for implicit TLS (usually port 465). Otherwise STARTTLS is required, except to 127.0.0.1 or ::1. */
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().max(200).optional(),
  SMTP_PASSWORD: z.string().max(200).optional(),
  MAIL_FROM: z
    .string()
    .max(254)
    .regex(
      /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/,
      'must be an e-mail address such as alerts@example.com',
    )
    .optional(),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly apiPublicOrigin: string;
  readonly portalOrigin: string;
  readonly playerOrigin: string;
  readonly sessionSecret: string;
  readonly sessionTtlSeconds: number;
  readonly sessionIdleTimeoutSeconds: number;
  readonly mediaUrlHmacSecret: string;
  readonly pairingClientKeySecret: string;
  readonly oidc: {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
    readonly postLogoutRedirectUri: string;
    readonly mfaAcrValues: readonly string[];
    readonly mfaAmrValues: readonly string[];
    /** True only for an http issuer on a loopback host in a non-production mode. */
    readonly allowInsecureRequests: boolean;
  };
  /** Absolute paths. */
  readonly mediaRoot: string;
  readonly mediaJobsDir: string;
  /** Passed to Fastify's trustProxy: false, or a list of trusted proxy addresses and ranges. */
  readonly trustProxy: false | string;
  /** Secure cookies with the `__Host-` prefix whenever the portal origin is https. */
  readonly secureCookies: boolean;
  readonly sessionCookieName: string;
  readonly loginCookieName: string;
  readonly limits: Limits;
  /** Null when SMTP_HOST is unset: no e-mail, so no alerts. */
  readonly mail: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly user: string | null;
    readonly password: string | null;
    readonly from: string;
  } | null;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopback(url: URL): boolean {
  return isLoopbackHost(url.hostname);
}

/** A host name or address on this machine (URL host form for IPv6, or a bare ::1). */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host === '::1' || host.endsWith('.localhost');
}

function looksLikeDevSecret(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.startsWith('dev-') ||
    lower.startsWith('change-me') ||
    lower.startsWith('changeme') ||
    lower === 'secret' ||
    lower === 'password'
  );
}

const NAMED_PROXY_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/** Parses TRUST_PROXY. Returns the Fastify value, or a problem text (never the value itself). */
export function parseTrustProxy(raw: string): { value: false | string } | { problem: string } {
  const text = raw.trim();
  if (text === 'false' || text === '' || text === '0') return { value: false };
  if (text === 'true') {
    return {
      problem:
        'TRUST_PROXY=true would trust every X-Forwarded-For hop, which the client controls; list the reverse proxy addresses instead',
    };
  }
  if (/^[0-9]+$/.test(text)) {
    return {
      problem:
        'TRUST_PROXY hop counts are ignored by Fastify (fail closed); list the reverse proxy addresses instead',
    };
  }
  const entries = text.split(',').map((part) => part.trim());
  for (const entry of entries) {
    if (NAMED_PROXY_RANGES.has(entry)) continue;
    const [address = '', prefix, extra] = entry.split('/');
    const family = isIP(address);
    const maxPrefix = family === 4 ? 32 : 128;
    const prefixOk =
      prefix === undefined ||
      (/^[0-9]{1,3}$/.test(prefix) &&
        Number(prefix) >= (family === 4 ? 8 : 16) &&
        Number(prefix) <= maxPrefix);
    if (family === 0 || extra !== undefined || !prefixOk) {
      return {
        problem:
          'TRUST_PROXY must be false or a comma-separated list of proxy addresses or CIDR ranges (no prefix wider than /8 for IPv4 or /16 for IPv6)',
      };
    }
  }
  return { value: entries.join(',') };
}

function absoluteFromRepo(path: string): string {
  return isAbsolute(path) ? resolve(path) : join(REPO_ROOT, path);
}

/**
 * Builds the configuration from an environment map. Throws ConfigError with
 * every problem found; error text names variables, never their values.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  // Treat empty strings as "not set" so defaults apply.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') cleaned[key] = value.trim();
  }
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'environment'} ${issue.message}`,
      ),
    );
  }
  const e = parsed.data;
  const problems: string[] = [];
  const production = e.NODE_ENV === 'production';

  let limits: Limits | undefined;
  try {
    limits = limitsFromEnv(cleaned);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : 'invalid limits');
  }

  const urls: [string, URL][] = [
    ['API_PUBLIC_ORIGIN', new URL(e.API_PUBLIC_ORIGIN)],
    ['PORTAL_ORIGIN', new URL(e.PORTAL_ORIGIN)],
    ['PLAYER_ORIGIN', new URL(e.PLAYER_ORIGIN)],
    ['OIDC_ISSUER', new URL(e.OIDC_ISSUER)],
    ['OIDC_REDIRECT_URI', new URL(e.OIDC_REDIRECT_URI)],
    ['OIDC_POST_LOGOUT_REDIRECT_URI', new URL(e.OIDC_POST_LOGOUT_REDIRECT_URI)],
  ];
  for (const [name, url] of urls) {
    if (url.protocol === 'https:') continue;
    if (production) {
      problems.push(`${name} must use https in production`);
    } else if (!isLoopback(url)) {
      problems.push(`${name} may use http only on a loopback host (localhost, 127.0.0.1)`);
    }
    if (url.username !== '' || url.password !== '') {
      problems.push(`${name} must not contain credentials`);
    }
  }

  const trustProxy = parseTrustProxy(e.TRUST_PROXY);
  if ('problem' in trustProxy) problems.push(trustProxy.problem);

  if (e.PORTAL_ORIGIN === e.PLAYER_ORIGIN) {
    problems.push('PORTAL_ORIGIN and PLAYER_ORIGIN must be different origins');
  }

  const redirect = new URL(e.OIDC_REDIRECT_URI);
  if (
    redirect.pathname !== ROUTES.authCallback ||
    redirect.search !== '' ||
    redirect.hash !== '' ||
    (redirect.origin !== e.PORTAL_ORIGIN && redirect.origin !== e.API_PUBLIC_ORIGIN)
  ) {
    problems.push(
      `OIDC_REDIRECT_URI must be ${ROUTES.authCallback} on PORTAL_ORIGIN or API_PUBLIC_ORIGIN`,
    );
  }
  if (new URL(e.OIDC_POST_LOGOUT_REDIRECT_URI).origin !== e.PORTAL_ORIGIN) {
    problems.push('OIDC_POST_LOGOUT_REDIRECT_URI must be on PORTAL_ORIGIN');
  }

  let databasePassword = '';
  try {
    const db = new URL(e.DATABASE_URL);
    if (db.protocol !== 'postgres:' && db.protocol !== 'postgresql:') {
      problems.push('DATABASE_URL must be a postgres:// URL');
    }
    databasePassword = decodeURIComponent(db.password);
    if (decodeURIComponent(db.username) !== 'tinnox_app') {
      problems.push('DATABASE_URL must connect as the runtime role tinnox_app');
    }
  } catch {
    problems.push('DATABASE_URL is not a valid URL');
  }

  if (e.SMTP_HOST !== undefined && e.MAIL_FROM === undefined) {
    problems.push('MAIL_FROM is required when SMTP_HOST is set');
  }
  if ((e.SMTP_USER === undefined) !== (e.SMTP_PASSWORD === undefined)) {
    problems.push('SMTP_USER and SMTP_PASSWORD must be set together');
  }

  if (production) {
    const secrets: [string, string][] = [
      ['SESSION_SECRET', e.SESSION_SECRET],
      ['MEDIA_URL_HMAC_SECRET', e.MEDIA_URL_HMAC_SECRET],
      ['PAIRING_CLIENT_KEY_SECRET', e.PAIRING_CLIENT_KEY_SECRET],
      ['OIDC_CLIENT_SECRET', e.OIDC_CLIENT_SECRET],
      ['DATABASE_URL password', databasePassword],
    ];
    if (e.SMTP_PASSWORD !== undefined) secrets.push(['SMTP_PASSWORD', e.SMTP_PASSWORD]);
    for (const [name, value] of secrets) {
      if (value === '' || looksLikeDevSecret(value)) {
        problems.push(`${name} is a development or placeholder value`);
      }
    }
    if (/\/realms\/tinnox-dev\/?$/.test(new URL(e.OIDC_ISSUER).pathname)) {
      problems.push('OIDC_ISSUER points at the development realm tinnox-dev');
    }
    if (e.OIDC_MFA_ACR_VALUES.length === 0 && e.OIDC_MFA_AMR_VALUES.length === 0) {
      problems.push(
        'production requires MFA evidence: set OIDC_MFA_ACR_VALUES or OIDC_MFA_AMR_VALUES',
      );
    }
  }
  const distinct = new Set([
    e.SESSION_SECRET,
    e.MEDIA_URL_HMAC_SECRET,
    e.PAIRING_CLIENT_KEY_SECRET,
  ]);
  if (distinct.size !== 3) {
    problems.push(
      'SESSION_SECRET, MEDIA_URL_HMAC_SECRET and PAIRING_CLIENT_KEY_SECRET must be three different values',
    );
  }
  if (e.SESSION_IDLE_TIMEOUT_SECONDS > e.SESSION_TTL_SECONDS) {
    problems.push('SESSION_IDLE_TIMEOUT_SECONDS must not exceed SESSION_TTL_SECONDS');
  }

  if (problems.length > 0 || limits === undefined || 'problem' in trustProxy) {
    throw new ConfigError(problems);
  }

  const secureCookies = new URL(e.PORTAL_ORIGIN).protocol === 'https:';
  const issuer = new URL(e.OIDC_ISSUER);
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    host: e.API_HOST,
    port: e.API_PORT,
    apiPublicOrigin: e.API_PUBLIC_ORIGIN,
    portalOrigin: e.PORTAL_ORIGIN,
    playerOrigin: e.PLAYER_ORIGIN,
    sessionSecret: e.SESSION_SECRET,
    sessionTtlSeconds: e.SESSION_TTL_SECONDS,
    sessionIdleTimeoutSeconds: e.SESSION_IDLE_TIMEOUT_SECONDS,
    mediaUrlHmacSecret: e.MEDIA_URL_HMAC_SECRET,
    pairingClientKeySecret: e.PAIRING_CLIENT_KEY_SECRET,
    oidc: Object.freeze({
      issuer: e.OIDC_ISSUER,
      clientId: e.OIDC_CLIENT_ID,
      clientSecret: e.OIDC_CLIENT_SECRET,
      redirectUri: e.OIDC_REDIRECT_URI,
      postLogoutRedirectUri: e.OIDC_POST_LOGOUT_REDIRECT_URI,
      mfaAcrValues: Object.freeze([...e.OIDC_MFA_ACR_VALUES]),
      mfaAmrValues: Object.freeze([...e.OIDC_MFA_AMR_VALUES]),
      allowInsecureRequests: !production && issuer.protocol === 'http:' && isLoopback(issuer),
    }),
    mediaRoot: absoluteFromRepo(e.MEDIA_ROOT),
    mediaJobsDir: absoluteFromRepo(e.MEDIA_JOBS_DIR),
    trustProxy: 'value' in trustProxy ? trustProxy.value : false,
    secureCookies,
    sessionCookieName: secureCookies ? SESSION_COOKIE.secure : SESSION_COOKIE.development,
    loginCookieName: secureCookies ? '__Host-tinnox_login' : 'tinnox_login',
    limits,
    mail:
      e.SMTP_HOST === undefined || e.MAIL_FROM === undefined
        ? null
        : Object.freeze({
            host: e.SMTP_HOST,
            port: e.SMTP_PORT,
            secure: e.SMTP_SECURE,
            user: e.SMTP_USER ?? null,
            password: e.SMTP_PASSWORD ?? null,
            from: e.MAIL_FROM,
          }),
  });
}
