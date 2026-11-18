# TINNOX CMS operator portal

React 19 + Vite + TypeScript single-page application: portal v2, stage A
(`docs/portal-v2/`). Internal engineering prototype; synthetic data only. Architecture
decisions are in `docs/prototype-m0.md`; the portal's design and page specs are in
`docs/portal-v2/design-system.md` and `docs/portal-v2/stage-a.md`.

## Run

From the repository root, with the API running on 127.0.0.1:4000:

```
npm run dev -w @tinnox/portal      # http://localhost:5173
npm run build -w @tinnox/portal    # static files in apps/portal/dist
npm run typecheck -w @tinnox/portal
npx vitest run --project unit apps/portal
npm run test:component            # components in headless Chromium (*.test.tsx)
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
- Content reaches a screen in two steps (decision P2-05): a playlist, a schedule or a layout is
  assigned to a screen (at most one; assigning one takes the others off), then "Push
  to screens" (`POST /api/push`) builds one immutable publication per chosen screen. A
  schedule (stage B, slice 3) is a default playlist plus weekly events; the push copies all of
  its playlists into the publication and the player picks between them. A layout (stage B,
  slice 4) splits the screen into zones, each with its own playlist; the push copies every zone. The push dialog sends one `Idempotency-Key` per opening and reuses it only while the
  outcome of an attempt is unknown (`src/lib/pushDialog.ts`).
- Player status is shown exactly as the API reports it, in the words of decision P2-04 (In
  sync, Standing by, Updating, Not reporting, Error, Waiting for player, Nothing pushed, Not
  paired) with the
  time of the last report (`src/lib/screenStatus.ts`). The portal never derives "healthy" on its
  own; a unit test bans the words "online" and "offline".
- Everything an operator reads says "screen"; code, API paths and contracts say `display`
  (decision P2-03).

## Source layout

```
src/App.tsx     session gate and route table (docs/portal-v2/stage-a.md, section 1); each
                page module is loaded on first visit and is its own bundle
src/api         client (CSRF, 401, errors), typed endpoints, XHR upload
src/hooks       useLoad: loading, polling while the tab is visible, keeping data on refresh errors
src/session     session state
src/shell       the application frame: sidebar, page header, Page and EditorPage, account
                menu, push button, navigation data (nav.ts), sign-in and error screens
src/ui          the component kit; API reference in src/ui/README.md
src/styles      tokens.css, base.css and one file per component group, imported by index.css;
                light and dark via prefers-color-scheme; one system-first typeface with self-hosted Inter
src/features    one folder per area, each with its routed page(s), parts and one CSS file:
                dashboard, media (library/, detail/), apps (list, create dialog, editor
                with a live preview drawn by @tinnox/app-render), playlists (list/, editor/),
                schedules (list, create dialog, editor: a default playlist and an ordered
                list of weekly events), layouts (list, create dialog, editor: a main zone and
                a bottom band with a preview on a screen shape),
                displays (list/, wizard/, detail/: the operator's "Screens" under /screens),
                push (PushProvider and the push dialog), settings (settings and tags),
                audit, planned, shared (parts several pages use: tags, folders,
                thumbnails, pickers, status pills, leave guard; see its README.md) and
                styleguide (the component gallery, development builds only)
src/lib         pure logic with unit tests beside it (node, no DOM): list view, selection,
                validation and drafts, status and push wording, activity wording, the push
                dialog's state, upload queue, formatting
```

## How a page is built

- A page component renders exactly one frame: `Page` (list and overview pages) or `EditorPage`
  (an object with a back link, a status label and Save). The frame owns the only `h1`, the
  `main#main` landmark and the document title.
- Data comes from `api.*` through `useLoad` (never `fetch`); the push plan comes only from
  `usePush()`. After a save that can change what is waiting, a page calls `usePush().refresh()`.
- Lists follow the list page pattern of the design system, section 7: filter row (search,
  chips, create button at the end), toolbar (count, view toggle, refresh), `DataTable` or
  `TileGrid`, `SelectionBar`, `Pagination`, and an empty state and a no-results state with
  "Clear filters". Filters, sort, page and view live in the query string.
- Editors use `useLeaveGuard` (features/shared) for unsaved changes, show "Saved" or
  "Unsaved changes", report a save with a toast, and summarise validation errors in a banner
  with links to the fields.
- Every state is drawn: skeletons while loading, `ErrorNotice` (message and API error code as
  text) with "Try again", partial failures per item, success toasts after the server answered.
- Styles: tokens only, class prefix `tx-<feature>-`, no `style` attributes (React's `style`
  prop only for dynamic geometry through `cssVars`). Main controls carry `data-testid`
  values prefixed with the feature.

The component gallery is at `/styleguide` in a development build (`npm run dev`), without
signing in. It is not part of a production build.

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
  routes such as `/screens/<id>`). Never apply that fallback to `/api/*`.
- Serve the player from a different origin (D7) and never serve portal files there.
- Pass upload request bodies through as a stream with a body-size limit no lower than the
  configured upload limit, and without buffering them to a shared temporary directory.
- Not publish source maps (`dist/assets/*.map`) on a customer-facing host unless that is a
  deliberate decision; the build emits them for debugging.
- Not log `Cookie`, `Set-Cookie` or `X-CSRF-Token` headers.

None of this has been deployed or tested; the prototype runs locally only.

## Known limits

- No browser-level tests live here; end-to-end tests belong to `tests/`. Unit tests cover logic
  only (node environment, no DOM).
- Uploads go one file at a time. An interrupted upload restarts from the beginning.
- Thumbnails use `GET /api/media/:id/preview` directly as an image or a paused, muted video
  (worker-made thumbnails are stage B).
- "Add to playlist" reads the playlist and saves it whole: the API has no append route and no
  version check, so a simultaneous edit elsewhere can be overwritten.
- The unsaved-changes guard covers in-app navigation and tab close, not a session that ends
  while a draft is being edited (the draft is lost at sign-in).
