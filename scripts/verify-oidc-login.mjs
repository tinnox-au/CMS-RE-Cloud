#!/usr/bin/env node
// Development check: signs the generated test operator in to the local Keycloak realm with
// the authorization code flow (PKCE S256), password and TOTP, exactly as a browser would,
// then exchanges the code as the confidential client. Proves the realm import is usable.
// Also proves that MFA does not depend on the user already having an authenticator: a
// temporary user with a password and no one-time-code credential is created through the
// local admin API, must be sent to authenticator set-up instead of receiving a code, and is
// deleted again. Stage C (CMS-13): the ID token carries auth_time; prompt=login makes a browser
// that is still signed in at Keycloak enter the password and a fresh one-time code again (the
// re-sign-in after a removal, demotion or "sign out everywhere"); the tinnox-provisioning client
// reads accounts and cannot create one. Prints no secret.
// Usage: node scripts/verify-oidc-login.mjs [operator|secondOrgOperator|admin|editor|viewer]
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(join(root, '.env'));
const credentials = JSON.parse(
  readFileSync(join(root, 'infra', '.generated', 'dev-credentials.json'), 'utf8'),
);
/** dev-credentials.json key → the .env variable that holds its subject (setup-dev.mjs). */
const SUBJECT_ENV = {
  operator: 'DEV_OPERATOR_OIDC_SUB',
  secondOrgOperator: 'DEV_SECOND_ORG_OIDC_SUB',
  admin: 'DEV_ADMIN_OIDC_SUB',
  editor: 'DEV_EDITOR_OIDC_SUB',
  viewer: 'DEV_VIEWER_OIDC_SUB',
};
const who = process.argv[2] ?? 'operator';
const user = Object.hasOwn(SUBJECT_ENV, who) ? credentials[who] : undefined;
if (!user) {
  throw new Error(`unknown user ${who}; one of ${Object.keys(SUBJECT_ENV).join(', ')}`);
}

const issuer = process.env.OIDC_ISSUER;
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(issuer ?? '')) {
  throw new Error('this check only runs against a local development issuer');
}
const clientId = process.env.OIDC_CLIENT_ID;
const redirectUri = process.env.OIDC_REDIRECT_URI;

function totp(keyText, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', Buffer.from(keyText, 'utf8')).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

const jar = new Map();
async function request(url, init = {}) {
  const headers = new Headers(init.headers);
  if (jar.size > 0) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  const response = await fetch(url, { ...init, headers, redirect: 'manual' });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return response;
}
const formAction = (html) => {
  const match = /<form[^>]*action="([^"]+)"/.exec(html);
  if (!match) throw new Error('no form found in identity-provider page');
  return match[1].replaceAll('&amp;', '&');
};
const check = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok  ${message}`);
};

const discovery = await (await fetch(`${issuer}/.well-known/openid-configuration`)).json();
check(discovery.issuer === issuer, 'discovery document issuer matches OIDC_ISSUER');

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('base64url');
const nonce = randomBytes(16).toString('base64url');
const authUrl = (extra) =>
  `${discovery.authorization_endpoint}?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid', state, nonce, ...extra })}`;

// 1. PKCE is mandatory for this client.
const noPkce = await request(authUrl({}));
const noPkceLocation = noPkce.headers.get('location') ?? '';
check(
  noPkce.status === 302 && /error=invalid_request/.test(noPkceLocation),
  'authorization request without PKCE is refused',
);
const plain = await request(authUrl({ code_challenge: verifier, code_challenge_method: 'plain' }));
check(
  plain.status === 302 && /error=invalid_request/.test(plain.headers.get('location') ?? ''),
  'authorization request with PKCE method "plain" is refused',
);

// 2. A redirect URI that is not registered exactly is refused (no wildcard matching).
jar.clear();
const badRedirect = await request(
  `${discovery.authorization_endpoint}?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: `${redirectUri}/extra`, scope: 'openid', state, code_challenge: challenge, code_challenge_method: 'S256' })}`,
);
check(badRedirect.status === 400, 'unregistered redirect URI is refused');

// 3. Password, then TOTP.
jar.clear();
const loginPage = await request(
  authUrl({ code_challenge: challenge, code_challenge_method: 'S256' }),
);
check(loginPage.status === 200, 'login page is served');
const afterPassword = await request(formAction(await loginPage.text()), {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username: user.username, password: user.password }),
});
check(
  afterPassword.status === 200,
  'password accepted but sign-in is not complete (a second factor is requested)',
);
const otpPage = await afterPassword.text();
check(/name="otp"/.test(otpPage), 'one-time code form is shown');

const wrongOtp = await request(formAction(otpPage), {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ otp: '000000' === totp(user.totpSecret) ? '111111' : '000000' }),
});
check(wrongOtp.status === 200, 'wrong one-time code does not complete the sign-in');
// Keycloak accepts each code once: the re-authentication below waits for the next step.
const otpAt = Date.now();
const otpStep = Math.floor(otpAt / 30_000);
const afterOtp = await request(formAction(await wrongOtp.text()), {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ otp: totp(user.totpSecret, otpAt) }),
});
const location = afterOtp.headers.get('location') ?? '';
check(
  afterOtp.status === 302 && location.startsWith(`${redirectUri}?`),
  'correct one-time code redirects to the registered redirect URI',
);
const callback = new URL(location);
check(callback.searchParams.get('state') === state, 'state is returned unchanged');
const code = callback.searchParams.get('code');
check(typeof code === 'string' && code.length > 0, 'authorization code issued');

// 4. Token exchange as the confidential client.
const exchange = (body, secret) =>
  fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      ...body,
    }),
  });
const wrongVerifier = await exchange(
  { code, code_verifier: randomBytes(32).toString('base64url') },
  process.env.OIDC_CLIENT_SECRET,
);
check(wrongVerifier.status === 400, 'token exchange with a wrong PKCE verifier is refused');

// A fresh code is needed: the failed attempt consumed the first one.
jar.delete('never');
const again = await request(authUrl({ code_challenge: challenge, code_challenge_method: 'S256' }));
const code2 = new URL(again.headers.get('location') ?? 'http://invalid/').searchParams.get('code');
check(
  again.status === 302 && typeof code2 === 'string',
  'existing identity-provider session issues a new code',
);
const wrongSecret = await exchange({ code: code2, code_verifier: verifier }, 'not-the-secret');
check(wrongSecret.status === 401, 'token exchange with a wrong client secret is refused');
const tokenResponse = await exchange(
  { code: code2, code_verifier: verifier },
  process.env.OIDC_CLIENT_SECRET,
);
check(tokenResponse.status === 200, 'token exchange with client secret and PKCE verifier succeeds');
const tokens = await tokenResponse.json();
const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
check(
  claims.iss === issuer && claims.aud === clientId && claims.nonce === nonce,
  'id_token issuer, audience and nonce are as requested',
);
check(
  claims.sub === user.oidcSub,
  'id_token subject equals the subject recorded by setup (membership key)',
);
check(claims.sub === process.env[SUBJECT_ENV[who]], `subject matches ${SUBJECT_ENV[who]} in .env`);
check(
  typeof claims.auth_time === 'number',
  "id_token carries a numeric auth_time (the API compares it with the member's cut-off)",
);
console.log(`claims present in id_token: ${Object.keys(claims).sort().join(', ')}`);
const personal = ['name', 'given_name', 'family_name', 'preferred_username', 'email'].filter(
  (claim) => claim in claims,
);
check(
  personal.length === 0,
  `id_token carries no name or e-mail claims (data minimisation)${personal.length > 0 ? `: found ${personal.join(', ')}` : ''}`,
);
console.log(`acr=${claims.acr ?? '(none)'} amr=${JSON.stringify(claims.amr ?? null)}`);
const replay = await exchange(
  { code: code2, code_verifier: verifier },
  process.env.OIDC_CLIENT_SECRET,
);
check(replay.status === 400, 'an authorization code cannot be redeemed twice');

// 5. Forced re-authentication (prompt=login, sent after a removal, demotion or sign-out
//    everywhere): with the Keycloak session above still alive, the password and a fresh one-time
//    code are asked for again, and the new ID token's auth_time is later.
const reVerifier = randomBytes(32).toString('base64url');
const reChallenge = createHash('sha256').update(reVerifier).digest('base64url');
const reLogin = await request(
  authUrl({ code_challenge: reChallenge, code_challenge_method: 'S256', prompt: 'login' }),
);
const reLoginPage = reLogin.status === 200 ? await reLogin.text() : '';
check(
  reLogin.status === 200 && /id="password"/.test(reLoginPage),
  'prompt=login with a live identity-provider session shows the password form, not a code',
);
// Keycloak may show the username read-only during a re-authentication (unverified).
const reForm = new URLSearchParams({ password: user.password });
if (/id="username"/.test(reLoginPage)) reForm.set('username', user.username);
const reAfterPassword = await request(formAction(reLoginPage), {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: reForm,
});
const reOtpPage = reAfterPassword.status === 200 ? await reAfterPassword.text() : '';
check(/name="otp"/.test(reOtpPage), 'the re-authentication asks for a one-time code again');
while (Math.floor(Date.now() / 30_000) <= otpStep) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const reAfterOtp = await request(formAction(reOtpPage), {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ otp: totp(user.totpSecret) }),
});
const reLocation = reAfterOtp.headers.get('location') ?? '';
check(
  reAfterOtp.status === 302 && reLocation.startsWith(`${redirectUri}?`),
  'a fresh one-time code completes the re-authentication',
);
const reCode = new URL(reLocation).searchParams.get('code');
const reTokens = await exchange(
  { code: reCode, code_verifier: reVerifier },
  process.env.OIDC_CLIENT_SECRET,
);
check(reTokens.status === 200, 'the re-authentication code is exchanged');
const reClaims = JSON.parse(
  Buffer.from((await reTokens.json()).id_token.split('.')[1], 'base64url').toString('utf8'),
);
check(
  typeof reClaims.auth_time === 'number' && reClaims.auth_time > claims.auth_time,
  'the new id_token has a later auth_time',
);

// 6. A user who has no one-time-code credential must not get a session with a password only
//    (for example a new user, or one who removed the authenticator in the account console).
const adminBase = issuer.replace(/\/realms\/[^/]+$/, '');
const realmName = issuer.slice(issuer.lastIndexOf('/') + 1);
const adminTokenResponse = await fetch(`${adminBase}/realms/master/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? '',
    password: process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ?? '',
  }),
});
check(adminTokenResponse.status === 200, 'local admin API reachable for the MFA probe');
const adminToken = (await adminTokenResponse.json()).access_token;
const admin = (path, init = {}) =>
  fetch(`${adminBase}/admin/realms/${realmName}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
const probeName = `mfa-probe-${randomBytes(4).toString('hex')}`;
const probePassword = randomBytes(18).toString('base64url');
const created = await admin('/users', {
  method: 'POST',
  body: JSON.stringify({
    username: probeName,
    enabled: true,
    credentials: [{ type: 'password', value: probePassword, temporary: false }],
  }),
});
check(created.status === 201, 'temporary MFA probe user created (password only, no authenticator)');
const probeId = (created.headers.get('location') ?? '').split('/').pop();
try {
  // Clear the default required actions, as for a user who later removed the authenticator.
  const cleared = await admin(`/users/${probeId}`, {
    method: 'PUT',
    body: JSON.stringify({ requiredActions: [] }),
  });
  check(cleared.status === 204, 'probe user has no pending required action');
  jar.clear();
  const probeLogin = await request(
    authUrl({ code_challenge: challenge, code_challenge_method: 'S256' }),
  );
  const probeAfterPassword = await request(formAction(await probeLogin.text()), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: probeName, password: probePassword }),
  });
  const probeLocation = probeAfterPassword.headers.get('location') ?? '';
  check(
    !(probeAfterPassword.status === 302 && probeLocation.startsWith(`${redirectUri}?`)),
    'a user without an authenticator gets no authorization code after the password alone',
  );
  // Follow redirects that stay inside the identity provider (required-action pages).
  let probeResponse = probeAfterPassword;
  for (let hop = 0; hop < 3 && probeResponse.status === 302; hop += 1) {
    const next = new URL(probeResponse.headers.get('location') ?? '', issuer);
    if (next.origin !== new URL(issuer).origin) break;
    probeResponse = await request(next.toString());
  }
  const setupPage = probeResponse.status === 200 ? await probeResponse.text() : '';
  if (!/name="totp"/.test(setupPage)) {
    const fields = [...setupPage.matchAll(/name="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
    console.log(`probe: status ${probeResponse.status}, form fields: ${fields.join(', ')}`);
  }
  check(
    /name="totp"/.test(setupPage) && /totpSecret/.test(setupPage),
    'that user is sent to authenticator set-up before sign-in can complete',
  );
} finally {
  const removed = await admin(`/users/${probeId}`, { method: 'DELETE' });
  check(removed.status === 204, 'temporary MFA probe user deleted');
}

// 7. The provisioning reader (scripts/provision-member.ts): view-users only.
const provisionResponse = await fetch(`${issuer}/protocol/openid-connect/token`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: `Basic ${Buffer.from(`${encodeURIComponent(process.env.PROVISION_IDP_CLIENT_ID ?? '')}:${encodeURIComponent(process.env.PROVISION_IDP_CLIENT_SECRET ?? '')}`).toString('base64')}`,
  },
  body: new URLSearchParams({ grant_type: 'client_credentials' }),
});
check(
  provisionResponse.status === 200,
  'the provisioning client gets a token (client_credentials)',
);
const provisionToken = (await provisionResponse.json()).access_token;
const asProvisioner = (path, init = {}) =>
  fetch(`${adminBase}/admin/realms/${realmName}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${provisionToken}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
const found = await asProvisioner(
  `/users?${new URLSearchParams({ username: credentials.operator.username, exact: 'true' })}`,
);
const foundUsers = found.status === 200 ? await found.json() : [];
check(
  foundUsers.length === 1 &&
    foundUsers[0].id === credentials.operator.oidcSub &&
    typeof foundUsers[0].email === 'string' &&
    foundUsers[0].email !== '',
  'the provisioning client finds one account by exact username, with its e-mail address and subject',
);
const provisionCreate = await asProvisioner('/users', {
  method: 'POST',
  body: JSON.stringify({ username: `provision-probe-${randomBytes(4).toString('hex')}` }),
});
if (provisionCreate.status === 201) {
  const strayId = (provisionCreate.headers.get('location') ?? '').split('/').pop();
  await admin(`/users/${strayId}`, { method: 'DELETE' });
}
check(provisionCreate.status === 403, 'the provisioning client cannot create an account');

console.log('\nAll identity-provider checks passed.');
