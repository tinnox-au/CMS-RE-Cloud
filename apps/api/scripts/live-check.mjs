#!/usr/bin/env node
// End-to-end check of the running API through the REAL sign-in flow: the development
// operator signs in at the local Keycloak (password, then TOTP) exactly as a browser
// would, and every later request uses the resulting session cookie and CSRF token.
// Nothing is inserted into the database directly. Prints no secret.
//
// Prerequisites:
//   npm run infra:up && npm run db:migrate && npm run db:seed
//   docker compose --env-file .env -f infra/docker-compose.yml --profile worker up -d --build media-worker
//   node apps/api/test-fixtures/generate.mjs
//   OIDC_REDIRECT_URI=http://localhost:4000/api/auth/callback npm run start -w @tinnox/api
// (the second registered redirect URI, so the callback reaches the API without the portal proxy)
//
// Usage: node apps/api/scripts/live-check.mjs
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
process.loadEnvFile(join(root, '.env'));
const fixtures = join(root, 'apps', 'api', 'test-fixtures', 'out');
const user = JSON.parse(
  readFileSync(join(root, 'infra', '.generated', 'dev-credentials.json'), 'utf8'),
).operator;

const API = process.env.LIVE_API_ORIGIN ?? 'http://localhost:4000';
const PORTAL = process.env.PORTAL_ORIGIN;
const PLAYER = process.env.PLAYER_ORIGIN;
const issuer = process.env.OIDC_ISSUER;
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(issuer ?? '')) {
  throw new Error('this check only runs against a local development issuer');
}

let failures = 0;
function check(condition, message, extra = '') {
  if (condition) console.log(`ok    ${message}`);
  else {
    failures += 1;
    console.log(`FAIL  ${message} ${extra}`);
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function totp(keyText, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', Buffer.from(keyText, 'utf8')).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// One cookie jar per origin, as a browser keeps them.
const jars = new Map();
async function request(url, init = {}) {
  const origin = new URL(url).origin;
  const jar = jars.get(origin) ?? new Map();
  jars.set(origin, jar);
  const headers = new Headers(init.headers);
  if (jar.size > 0) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  const response = await fetch(url, { ...init, headers, redirect: 'manual' });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair, ...attributes] = cookie.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (value === '' || attributes.some((a) => /max-age=0/i.test(a))) jar.delete(name);
    else jar.set(name, value);
  }
  return response;
}
const formAction = (html) => {
  const match = /<form[^>]*action="([^"]+)"/.exec(html);
  if (!match) throw new Error('no form found in identity-provider page');
  return match[1].replaceAll('&amp;', '&');
};
const form = (fields) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});

/* ---------------------------------------------------------------- sign-in */
console.log('\n== health and sign-in ==');
check((await fetch(`${API}/healthz`)).status === 200, 'GET /healthz is 200');
const ready = await fetch(`${API}/readyz`);
const readyBody = await ready.json();
check(
  ready.status === 200 && readyBody.checks.database && readyBody.checks.storage,
  'GET /readyz reports database and storage ready',
);
check(
  readyBody.checks.mediaWorker === true,
  'readyz sees the media worker alive (marker file freshness)',
);

const anonymous = await (await fetch(`${API}/api/session`)).json();
check(anonymous.authenticated === false, 'session is unauthenticated before sign-in');
check(
  (await fetch(`${API}/api/displays`)).status === 401,
  'operator API refuses requests without a session (401)',
);

const login = await request(`${API}/api/auth/login`);
const authorizeUrl = login.headers.get('location') ?? '';
check(
  login.status === 303 && authorizeUrl.startsWith(`${issuer}/`),
  'login redirects to the identity provider',
);
const authParams = new URL(authorizeUrl).searchParams;
check(
  authParams.get('code_challenge_method') === 'S256' && authParams.get('response_type') === 'code',
  'authorization request uses the code flow with PKCE S256',
);
check(
  Boolean(authParams.get('state')) && Boolean(authParams.get('nonce')),
  'authorization request carries state and nonce',
);
const preAuthCookie = login.headers.getSetCookie().find((c) => c.startsWith('tinnox_login=')) ?? '';
check(
  /HttpOnly/i.test(preAuthCookie) && /SameSite=Lax/i.test(preAuthCookie),
  'pre-auth cookie is HttpOnly and SameSite=Lax',
);

const loginPage = await request(authorizeUrl);
const afterPassword = await request(
  formAction(await loginPage.text()),
  form({ username: user.username, password: user.password }),
);
const otpPage = await afterPassword.text();
check(
  afterPassword.status === 200 && /name="otp"/.test(otpPage),
  'identity provider asks for a one-time code after the password (MFA by realm policy)',
);
const afterOtp = await request(formAction(otpPage), form({ otp: totp(user.totpSecret) }));
const callbackUrl = afterOtp.headers.get('location') ?? '';
check(
  afterOtp.status === 302 && callbackUrl.startsWith(`${API}/api/auth/callback?`),
  'identity provider redirects to the API callback',
);

// A callback replayed in another browser (no pre-auth cookie) must not sign anyone in.
const stolen = await fetch(callbackUrl, { redirect: 'manual' });
check(
  stolen.status === 303 &&
    (stolen.headers.get('location') ?? '').includes('authError=state') &&
    stolen.headers.getSetCookie().every((c) => !c.startsWith('tinnox_session=')),
  'callback without the pre-auth cookie is refused and sets no session',
);

const callback = await request(callbackUrl);
const sessionCookie =
  callback.headers.getSetCookie().find((c) => c.startsWith('tinnox_session=')) ?? '';
check(
  callback.status === 303 && callback.headers.get('location') === `${PORTAL}/`,
  'callback redirects to the portal',
);
check(
  /HttpOnly/i.test(sessionCookie) &&
    /SameSite=Lax/i.test(sessionCookie) &&
    /Path=\//i.test(sessionCookie),
  'session cookie is HttpOnly, SameSite=Lax, Path=/',
);
const replayed = await request(callbackUrl);
check(
  (replayed.headers.get('location') ?? '').includes('authError='),
  'the same callback cannot be redeemed twice',
);

const session = await (await request(`${API}/api/session`)).json();
check(
  session.authenticated === true && session.organization?.name === 'TINNOX Internal',
  'session is authenticated for the seeded organisation',
);
const csrf = session.csrfToken;
const api = (path, init = {}) =>
  request(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.method && init.method !== 'GET' ? { origin: PORTAL, 'x-csrf-token': csrf } : {}),
      ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });

/* ------------------------------------------------------------ CSRF, origin */
console.log('\n== CSRF and origin ==');
const noCsrf = await request(`${API}/api/playlists`, {
  method: 'POST',
  headers: { origin: PORTAL, 'content-type': 'application/json' },
  body: '{"name":"x"}',
});
check(
  noCsrf.status === 403 && (await noCsrf.json()).error.code === 'csrf_failed',
  'state change without the CSRF token is refused (403 csrf_failed)',
);
const badOrigin = await request(`${API}/api/playlists`, {
  method: 'POST',
  headers: {
    origin: 'http://evil.example',
    'x-csrf-token': csrf,
    'content-type': 'application/json',
  },
  body: '{"name":"x"}',
});
check(
  badOrigin.status === 403 && (await badOrigin.json()).error.code === 'origin_not_allowed',
  'state change from another Origin is refused (403 origin_not_allowed)',
);
const noOrigin = await request(`${API}/api/playlists`, {
  method: 'POST',
  headers: { 'x-csrf-token': csrf, 'content-type': 'application/json' },
  body: '{"name":"x"}',
});
check(noOrigin.status === 403, 'state change without an Origin header is refused');

/* ---------------------------------------------------------------- displays */
console.log('\n== sites and displays ==');
const sites = await (await api('/api/sites')).json();
check(
  sites.items.length === 1 && sites.items[0].timezone === 'Australia/Melbourne',
  'one seeded site in Australia/Melbourne',
);
const siteId = sites.items[0].id;
const created = await api('/api/displays', {
  method: 'POST',
  json: {
    siteId,
    name: `Live check ${new Date().toISOString()}`,
    canvas: { width: 1920, height: 320 },
    contentRect: { x: 64, y: 0, width: 1792, height: 320 },
    defaultFit: 'cover',
  },
});
const display = await created.json();
check(
  created.status === 201 && display.canvas?.width === 1920 && display.player === null,
  'display with an LED-shaped canvas and a content rectangle is created',
);
const outOfBounds = await api('/api/displays', {
  method: 'POST',
  json: {
    siteId,
    name: 'bad',
    canvas: { width: 100, height: 100 },
    contentRect: { x: 50, y: 0, width: 100, height: 100 },
  },
});
check(
  outOfBounds.status === 400 && (await outOfBounds.json()).error.code === 'validation_failed',
  'content rectangle outside the canvas is refused',
);
const shrink = await api(`/api/displays/${display.id}`, {
  method: 'PATCH',
  json: { canvas: { width: 800, height: 320 } },
});
check(
  shrink.status === 400,
  'shrinking the canvas below the existing content rectangle is refused',
);
const foreignSite = await api('/api/displays', {
  method: 'POST',
  json: { siteId: randomUUID(), name: 'x', canvas: { width: 100, height: 100 } },
});
check(foreignSite.status === 404, 'display for an unknown site is refused (404)');

/* ----------------------------------------------------------------- pairing */
console.log('\n== pairing ==');
const playerHeaders = { origin: PLAYER };
const preflight = await fetch(`${API}/player/manifest`, {
  method: 'OPTIONS',
  headers: {
    origin: PLAYER,
    'access-control-request-method': 'GET',
    'access-control-request-headers': 'authorization',
  },
});
check(
  preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === PLAYER,
  'CORS preflight from the player origin is allowed',
);
const evilPreflight = await fetch(`${API}/player/manifest`, {
  method: 'OPTIONS',
  headers: { origin: 'http://evil.example', 'access-control-request-method': 'GET' },
});
check(
  evilPreflight.headers.get('access-control-allow-origin') === null,
  'CORS preflight from another origin gets no allow-origin header',
);
const apiPreflight = await fetch(`${API}/api/displays`, {
  method: 'OPTIONS',
  headers: { origin: PLAYER, 'access-control-request-method': 'GET' },
});
check(
  apiPreflight.headers.get('access-control-allow-origin') === null,
  'operator API paths send no CORS headers at all',
);

const pairingResponse = await fetch(`${API}/player/pairing`, {
  method: 'POST',
  headers: playerHeaders,
});
const pairing = await pairingResponse.json();
check(
  pairingResponse.status === 201 &&
    /^[2-9A-HJKMNP-TV-Z]{8}$/.test(pairing.code) &&
    pairingResponse.headers.get('access-control-allow-origin') === PLAYER,
  'player obtains a pairing code',
);
const poll = () =>
  fetch(`${API}/player/pairing/${pairing.pairingId}`, {
    headers: { ...playerHeaders, authorization: `Bearer ${pairing.pollingToken}` },
  });
check((await (await poll()).json()).status === 'pending', 'poll before the claim is pending');
const wrongPoll = await fetch(`${API}/player/pairing/${pairing.pairingId}`, {
  headers: { authorization: `Bearer ${'A'.repeat(43)}` },
});
check(wrongPoll.status === 404, 'poll with a wrong polling token is 404');
const wrongClaim = await api(`/api/displays/${display.id}/claim`, {
  method: 'POST',
  json: { code: pairing.code === '22222222' ? '33333333' : '22222222' },
});
check(
  wrongClaim.status === 400 && (await wrongClaim.json()).error.code === 'pairing_code_invalid',
  'claim with a wrong code is refused',
);
const claim = await api(`/api/displays/${display.id}/claim`, {
  method: 'POST',
  json: { code: `${pairing.code.slice(0, 4).toLowerCase()}-${pairing.code.slice(4)}` },
});
check(claim.status === 200, 'operator claims the code (lower case with a dash is accepted)');
const secondClaim = await api(`/api/displays/${display.id}/claim`, {
  method: 'POST',
  json: { code: pairing.code },
});
check(secondClaim.status === 400, 'the same code cannot be claimed twice');
const collected = await (await poll()).json();
check(
  collected.status === 'claimed' &&
    /^[A-Za-z0-9_-]{43}$/.test(collected.deviceToken ?? '') &&
    collected.display?.id === display.id,
  'player collects its device token once',
);
check(
  (await (await poll()).json()).status === 'consumed',
  'a second poll does not return the token again',
);
const device = { ...playerHeaders, authorization: `Bearer ${collected.deviceToken}` };
const displayAfter = await (await api(`/api/displays/${display.id}`)).json();
check(
  displayAfter.player?.registrationId === collected.registrationId,
  'display shows the active registration',
);

/* ------------------------------------------------------------------ uploads */
console.log('\n== uploads and validation (isolated worker) ==');
async function upload(file, declaredType) {
  const body = new FormData();
  body.set('file', new Blob([readFileSync(join(fixtures, file))], { type: declaredType }), file);
  return api('/api/media', { method: 'POST', body });
}
async function settle(id) {
  for (let i = 0; i < 120; i += 1) {
    const media = await (await api(`/api/media/${id}`)).json();
    if (media.status !== 'processing') return media;
    await sleep(500);
  }
  return { status: 'processing' };
}
const expectations = [
  ['landscape.jpg', 'image/jpeg', 'ready', null],
  ['portrait.png', 'image/png', 'ready', null],
  ['h264.mp4', 'video/mp4', 'ready', null],
  ['h264-with-audio.mp4', 'video/mp4', 'ready', null],
  ['hevc.mp4', 'video/mp4', 'failed', 'unsupported_codec'],
  ['vp9.mp4', 'video/mp4', 'failed', 'unsupported_codec'],
  ['h264-yuv444.mp4', 'video/mp4', 'failed', 'unsupported_pixel_format'],
  ['too-wide.png', 'image/png', 'failed', 'image_too_large'],
  ['jpeg-signature-then-garbage.jpg', 'image/jpeg', 'failed', 'corrupt'],
  ['text-renamed.jpg', 'image/jpeg', 415, null],
  ['html-renamed.png', 'image/png', 415, null],
  ['vector-renamed.png', 'image/png', 415, null],
  ['matroska-renamed.mp4', 'video/mp4', 415, null],
];
const media = {};
for (const [file, type, expected, errorCode] of expectations) {
  const response = await upload(file, type);
  if (typeof expected === 'number') {
    const body = await response.json();
    check(
      response.status === expected && body.error?.code === 'unsupported_media_type',
      `${file}: refused at upload (${expected} unsupported_media_type)`,
      `got ${response.status}`,
    );
    continue;
  }
  const body = await response.json();
  if (response.status !== 201) {
    check(
      false,
      `${file}: upload accepted for validation`,
      `got ${response.status} ${JSON.stringify(body)}`,
    );
    continue;
  }
  const settled = await settle(body.media.id);
  media[file] = settled;
  check(
    body.media.status === 'processing' &&
      settled.status === expected &&
      (settled.errorCode ?? null) === errorCode,
    `${file}: ${expected}${errorCode ? ` (${errorCode})` : ''}`,
    `got ${settled.status} ${settled.errorCode ?? ''} ${settled.errorDetail ?? ''}`,
  );
}
const jpg = media['landscape.jpg'];
const png = media['portrait.png'];
const mp4 = media['h264.mp4'];
check(
  jpg?.width === 640 && jpg?.height === 360 && /^[0-9a-f]{64}$/.test(jpg?.sha256 ?? ''),
  'JPEG metadata: 640x360 with a SHA-256',
);
check(
  mp4?.codec === 'h264' && mp4?.width === 320 && mp4?.durationMs >= 1900 && mp4?.durationMs <= 2100,
  'MP4 metadata: h264, 320x240, about 2 s',
);
const traversal = new FormData();
traversal.set(
  'file',
  new Blob([readFileSync(join(fixtures, 'landscape.jpg'))]),
  '../../../etc/passwd\u0000.jpg',
);
const traversalResponse = await api('/api/media', { method: 'POST', body: traversal });
const traversalMedia = (await traversalResponse.json()).media;
check(
  traversalResponse.status === 201 && !/[\\/]/.test(traversalMedia.originalName),
  'a path-traversal file name is reduced to a harmless label',
  traversalMedia?.originalName,
);
await settle(traversalMedia.id);

const preview = await api(`/api/media/${jpg.id}/preview`);
const previewBytes = Buffer.from(await preview.arrayBuffer());
check(
  preview.status === 200 &&
    preview.headers.get('content-type') === 'image/jpeg' &&
    preview.headers.get('x-content-type-options') === 'nosniff' &&
    /^inline; filename="tinnox-/.test(preview.headers.get('content-disposition') ?? '') &&
    previewBytes.length === jpg.bytes,
  'preview: correct type, nosniff, neutral Content-Disposition, full length',
);
const ranged = await api(`/api/media/${mp4.id}/preview`, { headers: { range: 'bytes=0-99' } });
check(
  ranged.status === 206 &&
    ranged.headers.get('content-range') === `bytes 0-99/${mp4.bytes}` &&
    (await ranged.arrayBuffer()).byteLength === 100,
  'preview honours Range (206, 100 bytes)',
);
const beyond = await api(`/api/media/${mp4.id}/preview`, {
  headers: { range: `bytes=${mp4.bytes + 10}-` },
});
check(beyond.status === 416, 'unsatisfiable Range is 416');
const failedPreview = await api(`/api/media/${media['hevc.mp4'].id}/preview`);
check(failedPreview.status === 409, 'failed media has no preview');

/* ---------------------------------------------------------------- playlists */
console.log('\n== playlist and publishing ==');
const playlist = await (
  await api('/api/playlists', { method: 'POST', json: { name: 'Live check playlist' } })
).json();
const items = [
  { mediaId: jpg.id, durationMs: 5000, fit: null },
  { mediaId: mp4.id, durationMs: null, fit: 'contain' },
  { mediaId: png.id, durationMs: 3000, fit: 'cover' },
];
const saved = await api(`/api/playlists/${playlist.id}`, {
  method: 'PUT',
  json: { name: 'Live check playlist', items },
});
const savedBody = await saved.json();
check(
  saved.status === 200 &&
    savedBody.items.map((i) => i.mediaId).join() === items.map((i) => i.mediaId).join(),
  'playlist saved with three ordered items',
);
const missingDuration = await api(`/api/playlists/${playlist.id}`, {
  method: 'PUT',
  json: { name: 'x', items: [{ mediaId: jpg.id, durationMs: null, fit: null }] },
});
check(
  missingDuration.status === 400 &&
    (await missingDuration.json()).error.details?.[0]?.code === 'duration_required',
  'image without a duration is refused',
);
const videoDuration = await api(`/api/playlists/${playlist.id}`, {
  method: 'PUT',
  json: { name: 'x', items: [{ mediaId: mp4.id, durationMs: 4000, fit: null }] },
});
check(videoDuration.status === 400, 'video with a custom duration is refused');
const failedItem = await api(`/api/playlists/${playlist.id}`, {
  method: 'PUT',
  json: { name: 'x', items: [{ mediaId: media['hevc.mp4'].id, durationMs: null, fit: null }] },
});
check(failedItem.status === 400, 'failed media cannot be added to a playlist');

const noKey = await api(`/api/playlists/${playlist.id}/publish`, {
  method: 'POST',
  json: { displayId: display.id },
});
check(noKey.status === 400, 'publish without Idempotency-Key is refused');
const key = randomUUID();
const publish = () =>
  api(`/api/playlists/${playlist.id}/publish`, {
    method: 'POST',
    json: { displayId: display.id },
    headers: { 'idempotency-key': key },
  });
const [first, second, third] = await Promise.all([publish(), publish(), publish()]);
const publications = [await first.json(), await second.json(), await third.json()];
check(
  new Set(publications.map((p) => p.publicationId)).size === 1 &&
    publications.filter((p) => p.replayed === false).length === 1,
  'three concurrent publishes with one Idempotency-Key create exactly one publication',
);
const publication = publications[0];
check(
  publication.manifest.assets.length === 3 &&
    publication.manifest.assets[0].fit === 'cover' &&
    publication.manifest.assets[1].durationMs === mp4.durationMs &&
    publication.manifest.muted === true,
  'manifest: display default fit applied, natural video duration, muted',
);
const emptyPlaylist = await (
  await api('/api/playlists', { method: 'POST', json: { name: 'Empty' } })
).json();
const emptyPublish = await api(`/api/playlists/${emptyPlaylist.id}/publish`, {
  method: 'POST',
  json: { displayId: display.id },
  headers: { 'idempotency-key': randomUUID() },
});
const emptyBody = await emptyPublish.json();
check(
  emptyPublish.status === 422 &&
    emptyBody.error.code === 'publication_rejected' &&
    emptyBody.error.details[0].code === 'playlist_empty',
  'empty playlist is rejected with a readable reason',
);
const otherKeyConflict = await api(`/api/playlists/${emptyPlaylist.id}/publish`, {
  method: 'POST',
  json: { displayId: display.id },
  headers: { 'idempotency-key': key },
});
check(
  otherKeyConflict.status === 409 &&
    (await otherKeyConflict.json()).error.code === 'idempotency_conflict',
  'reusing a key for another playlist is a conflict',
);

// Draft edits do not change the publication.
await api(`/api/playlists/${playlist.id}`, {
  method: 'PUT',
  json: { name: 'Edited after publish', items: [items[2]] },
});
const inUse = await api(`/api/media/${png.id}`, { method: 'DELETE' });
check(
  inUse.status === 409 && (await inUse.json()).error.code === 'media_in_use',
  'media used by a playlist cannot be deleted',
);
const softDelete = await api(`/api/media/${jpg.id}`, { method: 'DELETE' });
check(
  softDelete.status === 204 && (await api(`/api/media/${jpg.id}`)).status === 404,
  'media used only by a publication is hidden from the library',
);

/* ----------------------------------------------------------------- player */
console.log('\n== player protocol ==');
const manifestResponse = await fetch(`${API}/player/manifest`, { headers: device });
const manifestBody = await manifestResponse.json();
const etag = manifestResponse.headers.get('etag');
check(
  manifestResponse.status === 200 &&
    etag === `"${publication.publicationId}"` &&
    manifestBody.manifest.assets.length === 3,
  'manifest is the published snapshot (unchanged by the draft edit), ETag is the publication id',
);
const notModified = await fetch(`${API}/player/manifest`, {
  headers: { ...device, 'if-none-match': etag },
});
check(notModified.status === 304, 'If-None-Match with the current ETag is 304');
check(
  (await fetch(`${API}/player/manifest`)).status === 401,
  'manifest without a credential is 401',
);

const urlsResponse = await fetch(`${API}/player/media-urls`, {
  method: 'POST',
  headers: { ...device, 'content-type': 'application/json' },
  body: JSON.stringify({
    publicationId: publication.publicationId,
    assetIds: [jpg.id, mp4.id, png.id],
  }),
});
const urls = (await urlsResponse.json()).urls;
check(
  urlsResponse.status === 200 && urls.length === 3,
  'media URLs issued for the publication assets',
);
const foreignAsset = await fetch(`${API}/player/media-urls`, {
  method: 'POST',
  headers: { ...device, 'content-type': 'application/json' },
  body: JSON.stringify({
    publicationId: publication.publicationId,
    assetIds: [media['h264-with-audio.mp4'].id],
  }),
});
check(foreignAsset.status === 404, 'media URL for an asset outside the publication is refused');
const jpgUrl = urls.find((u) => u.assetId === jpg.id).url;
const download = await fetch(jpgUrl, { headers: { origin: PLAYER } });
const downloaded = Buffer.from(await download.arrayBuffer());
const { createHash } = await import('node:crypto');
check(
  download.status === 200 &&
    createHash('sha256').update(downloaded).digest('hex') ===
      manifestBody.manifest.assets[0].sha256 &&
    downloaded.length === manifestBody.manifest.assets[0].bytes,
  'signed URL serves the deleted-from-library asset; bytes match the manifest SHA-256 and size',
);
check(
  /immutable/.test(download.headers.get('cache-control') ?? '') &&
    download.headers.get('access-control-allow-origin') === PLAYER,
  'media response has immutable cache headers and CORS for the player origin',
);
const mp4Url = urls.find((u) => u.assetId === mp4.id).url;
const partial = await fetch(mp4Url, { headers: { range: 'bytes=100-199' } });
check(
  partial.status === 206 && (await partial.arrayBuffer()).byteLength === 100,
  'signed URL honours Range',
);
const tampered = new URL(jpgUrl);
tampered.pathname = tampered.pathname.replace(jpg.id, mp4.id);
check((await fetch(tampered)).status === 403, 'signature does not transfer to another asset');
const later = new URL(jpgUrl);
later.searchParams.set('exp', String(Number(later.searchParams.get('exp')) + 3600));
check((await fetch(later)).status === 403, 'extending the expiry invalidates the signature');

const heartbeat = (seq, extra = {}) =>
  fetch(`${API}/player/heartbeat`, {
    method: 'POST',
    headers: { ...device, 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      seq,
      sentAt: new Date().toISOString(),
      displayId: display.id,
      downloadedPublicationId: publication.publicationId,
      activePublicationId: publication.publicationId,
      activeItemIndex: 1,
      playerState: 'playing',
      staging: null,
      errors: [],
      player: { version: 'live-check', storagePersisted: null, online: true },
      ...extra,
    }),
  });
const beforeReport = await (await api(`/api/displays/${display.id}/status`)).json();
check(
  beforeReport.summary === 'awaiting_player' &&
    beforeReport.stale === true &&
    beforeReport.desired?.publicationId === publication.publicationId &&
    beforeReport.active === null,
  'status before any report: awaiting_player, stale, desired set, nothing active',
);
const hb5 = await (await heartbeat(5)).json();
check(
  hb5.accepted === true && hb5.desiredPublicationId === publication.publicationId,
  'heartbeat seq 5 accepted',
);
const hb3 = await (await heartbeat(3, { activeItemIndex: 0, playerState: 'error' })).json();
check(
  hb3.accepted === false && hb3.ignoredReason === 'stale_seq',
  'delayed heartbeat seq 3 is ignored',
);
const afterReport = await (await api(`/api/displays/${display.id}/status`)).json();
check(
  afterReport.summary === 'in_sync' &&
    afterReport.stale === false &&
    afterReport.active?.itemIndex === 1 &&
    afterReport.playerState === 'playing',
  'status reflects the newer report only: in_sync, item 1, playing',
);
check(
  (await heartbeat(6, { displayId: randomUUID() })).status === 403,
  'heartbeat for another display is refused',
);
check(
  (await heartbeat(7, { activePublicationId: randomUUID() })).status === 409,
  'heartbeat naming an unknown publication is refused',
);
check(
  (await heartbeat(8, { unexpected: true })).status === 400,
  'heartbeat with an unknown field is refused',
);
const big = await fetch(`${API}/player/heartbeat`, {
  method: 'POST',
  headers: { ...device, 'content-type': 'application/json' },
  body: JSON.stringify({ pad: 'x'.repeat(20_000) }),
});
check(big.status === 413, 'oversized heartbeat is refused (413)');

/* ------------------------------------------------------------- revocation */
console.log('\n== revocation ==');
const revoke = await api(`/api/displays/${display.id}/revoke-player`, { method: 'POST' });
check(
  revoke.status === 200 && (await revoke.json()).revokedRegistrationId === collected.registrationId,
  'operator revokes the player',
);
const revokedManifest = await fetch(`${API}/player/manifest`, { headers: device });
check(
  revokedManifest.status === 401 && (await revokedManifest.json()).error.code === 'device_revoked',
  'revoked credential cannot fetch the manifest (401)',
);
check(
  (await fetch(jpgUrl)).status === 401,
  'a still-unexpired signed URL stops working after revocation',
);
check((await heartbeat(9)).status === 401, 'revoked credential cannot report');
const unpaired = await (await api(`/api/displays/${display.id}/status`)).json();
check(
  unpaired.summary === 'unpaired' && unpaired.active === null,
  'status after revocation: unpaired, old reports not shown as current',
);

/* ------------------------------------------------------------------ audit */
console.log('\n== audit and sign-out ==');
const audit = await (await api('/api/audit?limit=200')).json();
const actions = new Set(audit.items.map((e) => e.action));
for (const action of [
  'auth.login',
  'display.create',
  'pairing.claim',
  'pairing.complete',
  'player.revoke',
  'media.upload',
  'media.validate',
  'media.delete',
  'playlist.update',
  'publication.create',
  'security.csrf_rejected',
]) {
  check(actions.has(action), `audit trail contains ${action}`);
}
const auditText = JSON.stringify(audit);
check(
  !auditText.includes(collected.deviceToken) &&
    !auditText.includes(pairing.pollingToken) &&
    !auditText.includes(pairing.code) &&
    !auditText.includes('sig='),
  'audit trail contains no token, pairing code or signed URL',
);

const logout = await api('/api/auth/logout', { method: 'POST' });
const logoutBody = await logout.json();
check(
  logout.status === 200 &&
    (logoutBody.redirectTo ?? '').startsWith(`${issuer}/protocol/openid-connect/logout`),
  'logout ends the session and returns the provider end-session URL',
);
check(
  (await (await request(`${API}/api/session`)).json()).authenticated === false,
  'session is gone after logout',
);
check((await request(`${API}/api/displays`)).status === 401, 'operator API is closed after logout');

console.log(failures === 0 ? '\nAll live checks passed.' : `\n${failures} live check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
