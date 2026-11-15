# TINNOX CMS operator portal

React 19 + Vite + TypeScript single-page application. Internal engineering prototype (M0);
synthetic data only. Architecture decisions are in `docs/prototype-m0.md`.

## Run

From the repository root, with the API running on 127.0.0.1:4000:

```
npm run dev -w @tinnox/portal      # http://localhost:5173
npm run build -w @tinnox/portal    # static files in apps/portal/dist
npm run typecheck -w @tinnox/portal
npx vitest run --project unit apps/portal
```

Open the portal as **http://localhost:5173** (not `127.0.0.1`): the identity provider's
registered redirect URI and the session cookie use the `localhost` host name. The dev server
listens on 127.0.0.1 only and proxies `/api` to the API, so the session cookie is same-origin.

## How it talks to the API

- Every path, header name and schema comes from `@tinnox/contracts`. Every response is validated
  with the shared zod schema; a response that does not match is reported as `invalid_response`
  and nothing is assumed from it.
- Authentication is the API's concern (backend-for-frontend). The portal never sees an OIDC
  token. "Sign in" is a full-page navigation to `/api/auth/login`.
- The CSRF token from `GET /api/session` is held in a closure in memory (`src/api/client.ts`).
  Nothing is written to `localStorage`, `sessionStorage`, IndexedDB or a cookie by the portal.
- State-changing requests carry `X-CSRF-Token`. A `csrf_failed` answer triggers one session
  refresh and one retry. Any `401` returns the operator to the sign-in screen.
- Publishing sends an `Idempotency-Key` (a random UUID) per operator intent. The same key is
  reused only when the outcome of the previous attempt is unknown (`src/lib/publishIntent.ts`).
- Player status is shown exactly as the API reports it. The portal never derives "healthy" on
  its own, and it has no "online" indicator.

## Source layout

```
src/api         client (CSRF, 401, errors), typed endpoints, XHR upload
src/lib         pure logic with unit tests: form validation, durations, status text, draft, upload queue
src/hooks       loading and polling
src/session     session state
src/components  shared UI pieces
src/pages       screens
src/styles.css  the only stylesheet; system fonts; light and dark via prefers-color-scheme
```

## Content Security Policy

`index.html` carries this policy in a `<meta>` element, and the built files comply with it
(no inline script, no inline style element, no external origin):

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:;
media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none';
worker-src 'none'; base-uri 'self'; form-action 'self'
```

`vite dev` replaces it with a looser policy (inline script and style, websocket) because hot
reload needs that; see `vite.config.ts`. The build fails if the meta element is missing or if an
inline script appears in the built `index.html`.

## What the production reverse proxy must do

A `<meta>` policy cannot express everything, and it is absent from non-HTML responses. Whatever
serves `dist/` in a hosted environment must send these response headers on every response:

| Header | Value |
|---|---|
| `Content-Security-Policy` | The policy above plus `; frame-ancestors 'none'; upgrade-insecure-requests` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (HTTPS only; no plain HTTP listener other than a redirect) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |
| `X-Frame-Options` | `DENY` (for browsers that ignore `frame-ancestors`) |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Cache-Control` | `no-store` for `index.html`; `public, max-age=31536000, immutable` for `/assets/*` (file names are content-hashed) |

It must also:

- Serve the portal and `/api` from the **same origin** over HTTPS, so the `__Host-` session
  cookie is first-party and `SameSite=Lax` applies. Do not enable CORS for `/api`.
- Answer unknown paths that are not `/api/*` or `/assets/*` with `index.html` (client-side
  routes such as `/displays/<id>`). Never apply that fallback to `/api/*`.
- Serve the player from a different origin (D7) and never serve portal files there.
- Pass upload request bodies through as a stream with a body-size limit no lower than the
  configured upload limit, and without buffering them to a shared temporary directory.
- Not publish source maps (`dist/assets/*.map`) on a customer-facing host unless that is a
  deliberate decision; the build emits them for debugging.
- Not log `Cookie`, `Set-Cookie` or `X-CSRF-Token` headers.

None of this has been deployed or tested; M0 runs locally only.

## Known limits

- No browser-level tests live here; end-to-end tests belong to `tests/`. Unit tests cover logic
  only (node environment, no DOM).
- Uploads go one file at a time. An interrupted upload restarts from the beginning.
- Thumbnails use `GET /api/media/:id/preview` directly as an image or muted video source.
- Reordering is by Up and Down buttons; there is no drag and drop.
- The unsaved-changes guard covers in-app navigation and tab close, not a session that ends
  while a draft is being edited (the draft is lost at sign-in).
