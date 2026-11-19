/**
 * The identity-provider reader of TINNOX's provisioning script (scripts/provision-member.ts).
 * It only looks accounts up: staff create and reset accounts by hand in the identity provider,
 * and the client it uses holds `view-users` only (infra/keycloak/realm-template.json,
 * `tinnox-provisioning`). Never prints the client secret or a token.
 */

export interface IdpAccount {
  /** The OIDC "sub" claim the API sees (membership.oidc_sub). */
  readonly subject: string;
  /** The account's e-mail address; null when the account has none. */
  readonly email: string | null;
  readonly enabled: boolean;
}

export interface IdpDirectory {
  /** Exactly one account whose username equals `username` (ignoring case), or null. */
  findByUsername(username: string): Promise<IdpAccount | null>;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Keycloak: a client_credentials token for PROVISION_IDP_CLIENT_ID (view-users only), then
 * GET {base}/admin/realms/{realm}/users?username={u}&exact=true. In Keycloak the user id is the
 * ID token's `sub`.
 */
// shortcut: Keycloak's admin API only; add a reader for the production identity provider (A3, Cognito ListUsers) before provisioning against it.
export function keycloakDirectory(options: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}): IdpDirectory {
  const issuer = new URL(options.issuer);
  const realmPath = /^(.*)\/realms\/([^/]+)\/?$/.exec(issuer.pathname);
  if (realmPath === null || realmPath[2] === undefined) {
    throw new Error('the identity-provider issuer must be a Keycloak realm URL (…/realms/<realm>)');
  }
  // The client secret and a token that reads every account go over this connection.
  if (issuer.protocol !== 'https:' && !LOCAL_HOSTS.has(issuer.hostname)) {
    throw new Error('the identity-provider issuer must use https unless it is on this machine');
  }
  const base = `${issuer.origin}${realmPath[1] ?? ''}`;
  const realm = realmPath[2];
  const send = options.fetch ?? fetch;
  const basic = Buffer.from(
    `${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`,
  ).toString('base64');

  async function token(): Promise<string> {
    const response = await send(`${base}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(
        `the identity provider refused the provisioning client (HTTP ${response.status})`,
      );
    }
    const body = (await response.json()) as { access_token?: unknown };
    if (typeof body.access_token !== 'string' || body.access_token === '') {
      throw new Error('the identity provider answered without an access token');
    }
    return body.access_token;
  }

  return {
    async findByUsername(username) {
      const query = new URLSearchParams({ username, exact: 'true' });
      const response = await send(`${base}/admin/realms/${realm}/users?${query.toString()}`, {
        headers: { authorization: `Bearer ${await token()}` },
        redirect: 'error',
      });
      if (!response.ok) {
        throw new Error(`the identity-provider user search failed (HTTP ${response.status})`);
      }
      const list: unknown = await response.json();
      if (!Array.isArray(list)) throw new Error('the identity-provider user search gave no list');
      const wanted = username.toLowerCase();
      const matches = list.filter(
        (user): user is { id?: unknown; email?: unknown; enabled?: unknown } =>
          typeof user === 'object' &&
          user !== null &&
          typeof (user as { username?: unknown }).username === 'string' &&
          (user as { username: string }).username.toLowerCase() === wanted,
      );
      const user = matches.length === 1 ? matches[0] : undefined;
      if (user === undefined || typeof user.id !== 'string' || user.id === '') return null;
      return {
        subject: user.id,
        email: typeof user.email === 'string' && user.email !== '' ? user.email : null,
        enabled: user.enabled === true,
      };
    },
  };
}
