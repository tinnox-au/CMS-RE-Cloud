# Portal v2 design system

Date: 2026-11-15, restyled 2026-11-16. Status: the binding visual and interaction spec for the redesigned operator portal (`apps/portal`). Source of the structure: `docs/yodeck-ui-observation.md`. Source of the look: the approved restyle mockups in `docs/portal-v2/restyle-mockups/` (Foundations, Main, DashboardDark, Media, Playlist, Screens).

**Look, 2026-11-16.** By client decision on 2026-11-16 (DEC-34, `docs/decisions-2026-11.md`) the portal follows the approved restyle mockups: an Apple-like neutral palette with one blue accent and the system typeface. Sections 1 to 3 describe the look, section 3a what changed in the components and the shell. Sections 4 to 10 describe structure and behaviour, which the restyle did not change.

## 1. Direction in one paragraph

The portal follows Yodeck's layout: a left sidebar of sections, a page header with a title on the left and account controls plus one primary "Push to screens" button on the right, list pages built from a search row, a toolbar, a table and a create button, and editor pages with a back link and Cancel and Save at the top right. On top of that structure it wears a calm, Apple-like, neutral finish: a light grey page with white cards that have a 20 px radius and neither border nor shadow, a single blue accent for filled buttons and links, status shown as a small coloured dot with coloured text, one system typeface throughout, pill buttons, hairline separators between rows, generous spacing and short eased motion. Dark mode follows the system and uses true black with dark grey cards. It must not look like a recoloured Yodeck: icons, wording, illustrations and the table treatment are our own.

## 2. Hard rules

1. No remote assets. Fonts and icons are bundled from npm packages and served from the portal's own origin. The production Content-Security-Policy in `apps/portal/index.html` stays as strict as it is today (`style-src 'self'`, `font-src 'self'`, `script-src 'self'`). The system typeface needs no download; Inter is self-hosted for systems without it.
2. No inline `style="..."` in static HTML and no `dangerouslySetInnerHTML`. Dynamic geometry goes through the `cssVars` helper (React's `style` prop, which writes through the CSSOM and the policy allows).
3. Accessibility is WCAG 2.2 AA: every control reachable and operable by keyboard, a visible focus ring, text contrast at least 4.5:1, control boundaries and focus rings at least 3:1, targets at least 24 by 24 px, no information by colour alone (a status always carries its text next to the dot), dialogs trap focus and restore it, menus follow the ARIA menu-button pattern, `prefers-reduced-motion` removes movement. `apps/portal/src/styles/tokens.test.ts` enforces the colour pairs.
4. Light and dark themes both ship; dark follows `prefers-color-scheme`. Colours live only in `apps/portal/src/styles/tokens.css` as plain values and are only ever referenced through the semantic tokens in section 3.
5. Wording is TINNOX's own, in Australian English and sentence case ("Push to screens", "Add media"). The product name is "TINNOX CMS". The logo image is not embedded; the brand mark is the text wordmark described in section 6.
6. Nothing from Yodeck is reused: no icon, illustration, template artwork, screenshot or sentence.

## 3. Tokens

All tokens are CSS custom properties on `:root` in `apps/portal/src/styles/tokens.css`. Dark values go under `@media (prefers-color-scheme: dark)`. `src/styles/tokens.test.ts` checks every text and boundary pair against WCAG 2.2 AA in both themes.

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f5f5f7` | `#000000` | Page background; the sidebar sits flat on it |
| `--surface` | `#ffffff` | `#1c1c1e` | Cards, the table card, dialogs, text inputs |
| `--surface-2` | `#f5f5f7` | `#2c2c2e` | Inset fill inside a card, hovered rows |
| `--surface-3` | `#e8e8ed` | `#3a3a3c` | Control fill: search field, segmented track, pressed states, selected chips |
| `--fill` | black 6% | white 10% | Secondary button, small capsules ("Prototype", "Planned"), selected sidebar row |
| `--fill-hover` | black 10% | white 16% | Hover of the above |
| `--fill-disabled` | black 4% | white 6% | Disabled button |
| `--glass` | `#f5f5f7` at 80% | black 72% | Sticky header, with `backdrop-filter` |
| `--scrim` | black 32% | black 60% | Dialog backdrop |
| `--line` | black 8% | white 12% | Hairlines between rows, the sidebar edge |
| `--line-strong` | black 16% | white 20% | Dividers that must show |
| `--line-control` | `#86868b` | `#8e8e93` | Boundary of text inputs, checkboxes and switch tracks (3:1). Deliberately darker than the mockups' `#d2d2d7`, which reaches only 1.5:1 |
| `--ink` | `#1d1d1f` | `#f5f5f7` | Primary text |
| `--ink-2` | `#67676c` | `#a3a3a8` | Secondary text, captions, table headers, placeholders. Specified `#6e6e73` / `#a1a1a6`; darkened (light) and lightened (dark) a little so it reaches 4.5:1 on `--surface-3` and on a `--fill` capsule |
| `--ink-3` | `#86868b` | `#6e6e73` | Disabled text only (never for text that must be read) |
| `--accent` | `#0071e3` | `#0071e3` | Filled controls: primary button, checked box, switch that is on, badge, progress and meter fills |
| `--accent-hover` | `#0068d6` | `#0068d6` | Hover of a filled control (darker, so white text keeps 4.5:1) |
| `--on-accent` | `#ffffff` | `#ffffff` | Text and icons on an accent fill |
| `--link` | `#0066cc` | `#2997ff` | Links, text buttons, icons that mark something active |
| `--link-hover` | `#004f9e` | `#5eb0ff` | Hover of a link |
| `--focus` | `#0071e3` | `#2997ff` | Focus ring `0 0 0 2px var(--surface), 0 0 0 4px var(--focus)`; a focused field gets a 1 px `--focus` border instead. Dark is lighter: `#0071e3` reaches only 3:1 on the dark fills |
| `--focus-halo` | accent 18% | `#2997ff` at 30% | The 4 px soft ring around a focused field; text selection |
| `--ok` / `--ok-bg` | `#1d7a36` / `#e8f2eb` | `#30d158` / `#1e3225` | In sync, ready, success |
| `--warn` / `--warn-bg` | `#b25000` / `#f7eee6` | `#ff9f0a` / `#372c1c` | Changes waiting, processing, not reporting |
| `--danger` / `--danger-bg` | `#d70015` / `#fcebec` | `#ff5d53` / `#372424` | Errors, destructive actions (the destructive button is `--danger` text on `--danger-bg`). Dark specified `#ff453a`; lightened to reach 4.5:1 on a hovered row |
| `--on-danger` | `#ffffff` | `#000000` | Text on a filled `--danger` (the confirming button of a destructive dialog, the danger badge). White on the dark red is only 3.4:1 |
| `--neutral-bg` | `#ebebf0` | `#242426` | Skeletons, meter tracks, neutral badges |
| `--tag-*` | teal `#00829b`, sky `#0071e3`, slate `#6e6e73`, green `#248a3d`, amber `#b25000`, red `#d70015`, violet `#5e5ce6`, pink `#d12f6a` | `#40c8e0`, `#2997ff`, `#98989d`, `#30d158`, `#ff9f0a`, `#ff5d53`, `#7d7aff`, `#ff6482` | Tag dots; 3:1 on cards and inset fills |

Status is shown as an 8 px dot plus text in the status colour at weight 500, not as a filled pill. Neutral status uses `--ink-2` text and an `--ink-3` dot.

The blue has three jobs: a filled control uses `--accent` (with `--on-accent` on it); a link, text button or active icon uses `--link`; focus rings and focused field borders use `--focus`. The selected sidebar row and the selected tab use `--ink`, never the blue.

### Type

One family. `--font-body` and `--font-head` hold the same stack (`--font-head` is `var(--font-body)`; both names stay so nothing breaks):

`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter Variable', 'Inter Fallback', 'Helvetica Neue', Arial, sans-serif`

San Francisco on Apple devices; self-hosted Inter Variable (with its metric-matched local fallback, `styles/fonts.css`) elsewhere. `--font-mono` is `ui-monospace, "SF Mono", Menlo, Consolas, monospace` (pairing codes, IDs, hashes).

| Style | Class / element | Size / line | Weight | Tracking |
|---|---|---|---|---|
| Big numerals (dashboard counts) | `.tx-numeral` | 44 / 48 | 600 | -0.03em, tabular |
| Page title | `h1`, `.tx-h1`, `.tx-display` | 34 / 40 | 700 | -0.022em |
| Card title | `h2`, `.tx-h2` | 21 / 28 | 600 | -0.01em |
| Heading | `h3`, `.tx-h3` | 15 / 20 | 600 | -0.01em |
| Row title | `.tx-row-title` | 15 / 20 | 500 | -0.01em |
| Body | `body`, `.tx-body` | 14 / 20 | 400 | -0.005em |
| Body strong | `.tx-strong` | 14 / 20 | 600 | -0.005em |
| Caption | `.tx-small` (with `.tx-muted` for `--ink-2`) | 13 / 18 | 400 | 0 |
| Label, table header | `.tx-caption` | 12 / 16 | 600 | 0, sentence case, `--ink-2` |
| Capsule ("Prototype", "Planned", badges) | component | 11 to 12 | 600 | `--ink-2` on `--fill`, pill radius |

Numbers in tables, counters and durations use `font-variant-numeric: tabular-nums`. Links keep a soft underline, because the link blue alone is under 3:1 against body text.

### Shape, space, depth, motion

| Token | Value |
|---|---|
| Radius | `--r-xs: 6px`, `--r-sm: 10px` (sidebar rows, menu items, small tiles), `--r-md: 12px` (fields, search, segmented track, thumbnails), `--r-lg: 20px` (cards, dialogs), `--r-pill: 980px` (buttons, chips, capsules). The selected segment uses 9 px |
| Space scale | 4, 8, 12, 16, 20, 24, 32, 40, 56 as `--s-1` to `--s-9` |
| Control heights | `--h-sm` 32, `--h-md` 40 (buttons, search field), `--h-lg` 44 (text inputs, page primary, sign-in) |
| Shadows | Cards have none. `--shadow-1: 0 1px 3px rgb(0 0 0 / 0.12)` lifts a thumb (selected segment, switch knob); `--shadow-2` for menus, popovers and toasts; `--shadow-3` for dialogs and drawers. Dark adds a white 8% hairline ring to the floating layers |
| Motion | `--ease: cubic-bezier(.2, .7, .2, 1)`; `--t-fast: 120ms`; `--t: 200ms`; `--t-slow: 320ms`. Under `prefers-reduced-motion: reduce` all durations are 0 and transforms are removed. |
| Layout | Sidebar 240 px (collapsed 72 px). Content column fluid with 32 px side padding (16 px under 900 px wide), maximum 1440 px. |

### 3a. Restyle 2026-11: what changes in components and shell

Phase 1 (done) replaced the tokens, the type scale and the fonts. Phase 2 restyled the components and phase 3 the shell (section 4 is up to date). Phase 4 brought every page to the same language; the page rules are at the end of this list.

- **Cards:** white on the grey page, 20 px radius, no border, no shadow; inset areas inside a card use `--surface-2`.
- **Buttons:** pills, 40 px. Primary `--accent` with `--on-accent`; secondary `--fill` with ink text at weight 500; text buttons transparent in `--link`; destructive `--danger` text on `--danger-bg`; disabled `--fill-disabled` with `--ink-3`.
- **Segmented control:** `--surface-3` track, 12 px radius, 3 px padding; the selected segment is `--surface`, 9 px radius, `--shadow-1`, weight 600.
- **Fields:** search is filled `--surface-3`, 12 px radius, 40 px, no border. Text inputs are `--surface`, 12 px radius, 44 px, a 1 px `--line-control` border; on focus a 1 px `--focus` border and a 4 px `--focus-halo` ring.
- **Status:** an 8 px dot and coloured text at weight 500 replaces the filled status pill. Capsules ("Prototype", "Planned", badges) are 11 to 12 px, weight 600, `--ink-2` on `--fill`.
- **Tables:** inside one white card, no outer border, no zebra; header row 12 px / 600 `--ink-2` with no fill; rows separated by `--line`.
- **Sidebar:** flat on `--bg` with a `--line` on its right edge; rows 40 px, 10 px radius; the selected row is `--fill` with `--ink` text at weight 600; section icons in the accent colour, Settings and Audit log icons in `--ink-2`. The Media sub-items keep their structure.
- **Tabs:** the selected tab is `--ink`, not the accent.
- **Pages (phase 4):**
  - The count line of a list page is the page header's subtitle ("35 screens, as each player last reported.", "47 files · 4.3 MB of 5.0 GB used"), not a line inside the first card.
  - A box inside a card is an inset fill (`--surface-2`, 12 px radius, no border). No 1 px outlined boxes; `--line` only between the rows of a list.
  - A row's main link is a row title (`.tx-row-title`, 15/500, `--ink`), underlined on hover and focus. It is not blue.
  - Card titles are 21/600; the 13 px label style is for sub-sections inside a card.
  - Big counts use `.tx-numeral`. The dashboard shows four separate status cards, then Changes waiting beside Library, Needs attention, and Recent activity.
  - The playlist editor puts the sequence in the wide column with Details and Push beside it from 1100 px, and the media library underneath.
  - The screen page's tab card spans the full width under the top cards so every tab fits at 1440 px.
  - Page header between 760 and 1199 px: the organisation capsule is hidden, the heading keeps at least 260 px, and the global controls drop to a second line only when they still do not fit, so a page title is never cut. Editor titles still shorten with an ellipsis.

## 4. Application shell

Restyled in phase 3 of the 2026-11 restyle (DEC-34). Mockups: `restyle-mockups/Main.dc.html`, `DashboardDark.dc.html`, `Playlist.dc.html`.

```
+------------------------+--------------------------------------------------------+
| TINNOX (Prototype)     |  Page title           [Org] (MF) [Push to screens (2)]  |
|                        |  optional subtitle                                     |
| [Dashboard          ]  |                                                        |
|  Media               v |  page content (cards 24 px apart)                       |
|    All media           |                                                        |
|    Images              |                                                        |
|    Videos              |                                                        |
|    Audio      Planned  |                                                        |
|    ...                 |                                                        |
|  Apps         Planned  |                                                        |
|  Playlists             |                                                        |
|  Layouts      Planned  |                                                        |
|  Schedules    Planned  |                                                        |
|  Screens               |                                                        |
|                        |                                                        |
|  Settings              |                                                        |
|  Collapse sidebar      |                                                        |
+------------------------+--------------------------------------------------------+
```

- **Sidebar:** 240 px, sticky, full height, flat on `--bg` (no glass, no card) with a `--line` hairline on its right edge. At the top the wordmark (section 6) and the "Prototype" capsule. Rows are 40 px tall, 10 px radius (`--r-sm`), 10 px inner padding, an 18 px icon and a 14 px label; hover is `--fill`. The current page is `--fill` with `--ink` text at weight 600, never the accent colour. Section icons are drawn in `--link` (the accent blue for text and icons); Settings and the collapse control in `--ink-2`; Media's sub-items (one step in, 36 px rows, 13 px, 16 px icons) in `--ink-2`, the current one in `--link`. A closed group that holds the current page (and, collapsed, the Media icon) also gets the `--fill`. "Planned" is a capsule: 11 px at 600, `--ink-2` on `--fill`; on a filled row (hover or current) the capsule turns `--surface` so its text keeps 4.5:1. Media is a disclosure group; it opens automatically on any media route and can be closed by hand. The collapse button reduces the sidebar to 72 px of icons with tooltips (Media opens as a menu); the choice lasts for the page session only, held in memory (the portal uses no web storage: the lint rule and an end-to-end test forbid it). The audit log is reached from the account menu, not from the sidebar (unlike the mockup), so the navigation structure is unchanged.
- **Navigation drawer:** under 900 px the sidebar becomes a native modal `<dialog>` drawer (at most 304 px wide, `--bg`, `--shadow-3`, `--scrim` behind), opened by a menu button at the start of the header. It has a close button, closes on Escape, the backdrop and any navigation, and then puts focus on the page content.
- **Page header:** sticky and frosted (`.tx-glass`: `--glass` with `backdrop-filter`). Unscrolled it reads as part of the page; a `--line` hairline fades in over the first 16 px of scrolling (a CSS scroll-driven animation; browsers without it show the hairline all the time). It is 88 px tall on a wide window (`--header-h` is redefined to 88 px inside `.tx-shell`; 72 px under 900 px, where the header may wrap). Left: the page `h1`, the large title (34/40 at 700, tracking -0.022em; 28/34 under 760 px), cut with an ellipsis, and an optional subtitle (`Page`'s `subtitle` prop, 15 px `--ink-2`). Right, 10 px apart: the organisation capsule (`--fill`, `--ink` text at 500, 40 px, pill, width capped so a long name is shortened; it becomes the workspace switcher later), the account button (a 40 px circle with the initials on `--surface-3`; a 3 px `--fill-hover` ring on hover; menu: name and role, Settings, Users, Audit log, Sign out), and the primary pill **Push to screens** with a white count badge when changes are waiting. Under 480 px the push button shows its send icon and the count only; its name stays for assistive technology.
- **Editor pages** (`EditorPage`, for example the playlist editor and the screen page): the back link ("‹ All playlists") above the object name as `h1`; at the right, aligned with the title, the status ("Saved", "Unsaved changes"), quiet Discard or Cancel and primary Save, then the account button. Under 760 px the header keeps to two lines: back link, title and account button, then the status and the actions.
- **Content column:** `main#main`, at most `--content-max` (1440 px) wide, 36 px gutters (16 px under 900 px; `--gutter` is redefined inside `.tx-shell`), 12 px under the header and 56 px at the bottom. Pages space their cards 24 px apart (`tx-stack--loose`).
- **Prototype notice:** there is no environment strip any more. The "Prototype" capsule beside the wordmark replaces it: its pointer tooltip (`title`) is "Internal engineering prototype. Synthetic data only.", and the same sentence is in the document as visually hidden text, so assistive technology reads it. The sign-in screen keeps the sentence as a note under the Sign in button.
- **Screens without the shell** (sign-in, session check, session error, route error): one centred `--surface` card, 24 px radius, no border or shadow, on `--bg`; the wordmark, the 34 px title (28 px on a phone), the explanation in `--ink-2`, and a full-width accent pill button.
- **Identity provider pages** (username and password, one-time code, their errors): served by the development Keycloak, not by the portal. The login theme `infra/keycloak/themes/tinnox` restyles Keycloak's own `keycloak.v2` pages to the same card, fields and pill button, with a "Local development" capsule beside the wordmark. It only adds a stylesheet and two wordings; templates and element ids are Keycloak's. Its colours are a copy of the portal tokens (Keycloak is another origin and cannot load the portal stylesheet), so a token change must be repeated in `resources/css/tinnox.css`. The realm selects the theme with `loginTheme` in `infra/keycloak/realm-template.json`; an existing local realm picks it up when the Keycloak container is recreated (`npm run setup`, then `npm run infra:up`). Production uses a separately reviewed identity provider and needs its own theme.
- A skip link to `#main` stays first in the tab order.

## 5. Components

Each lives in `apps/portal/src/ui/` with its styles in `apps/portal/src/styles/`. Class names are prefixed `tx-`.

| Component | Spec |
|---|---|
| `Button` | Pill. Variants: `primary` (`--accent` fill, `--on-accent` text), `secondary` (`--fill`, ink text at weight 500), `ghost` (transparent, `--link` text), `danger` (`--danger` text on `--danger-bg`), `danger-solid` (filled, only inside a confirm dialog). Sizes 32, 40, 44. Optional leading icon. Busy state shows a spinner and keeps the width. |
| `IconButton` | 36 px circle, ghost by default, needs an `aria-label`, shows a tooltip. |
| `SplitButton` | Primary action plus a chevron segment opening a menu of related actions. |
| `Menu` | Popover on `--surface` with `--shadow-2` and `--r-md`; items 36 px, icon plus label, destructive items in `--danger` after a divider. Arrow keys, Home, End, typeahead, Escape. Used by row action buttons, the account menu and split buttons. |
| `Dialog` | Built on the native `<dialog>` element with `showModal()`. `--r-lg`, `--shadow-3`, scrim, title row with a close button, a scrolling body, a footer with the secondary action on the left of the primary. Widths 480, 640, 880. |
| `ConfirmDialog` | A dialog that names the object and the consequence; the destructive button is never the default focus. |
| `Toast` | Bottom centre, pill-shaped, auto-dismiss after 5 s unless it reports an error; announced through an `aria-live` region. |
| `Field` | Label above the control, optional hint below, error text in `--danger` with an icon, wired with `aria-describedby`. |
| `TextInput`, `Textarea`, `Select` | 44 px tall, `--r-md`, `--surface` with a 1px `--line-control` boundary (3:1); focus is a 1px `--focus` border and a 4px `--focus-halo` ring. Native `<select>` with a custom chevron. |
| `SearchField` | 40 px, `--r-md`, filled `--surface-3` without a border, a leading search icon and a clear button. Accepted deviation: the filled field has no 3:1 boundary by design; it is identified by its magnifier icon, its placeholder and its accessible name. |
| `Switch` | 36 by 22 px track, `--accent` when on; a real checkbox with `role="switch"`. |
| `Checkbox` | 18 px, `--r-xs`, `--accent` when checked, supports the mixed state for "select all". |
| `Stepper` | Minus, numeric input, plus, in one pill; arrow keys step; used for durations. |
| `Segmented` | Apple-style segmented control for two to four exclusive choices (list or grid, calendar view, "My apps" or "Discover"). |
| `Tabs` | Underline tabs for longer sets (the screen settings tabs, the add-media dialog). ARIA tabs pattern. |
| `Chip` | Pill for filters and tags; selectable chips fill with `--surface-3`; removable chips have a close button. |
| `StatusPill` | An 8 px dot and the words in the status colour at weight 500, no fill: ok, warn, danger, neutral. Text always present. Lists and rows use the dot; an icon replaces it only in the screen page's status headline and where the words are hidden on a phone (the audit result column). |
| `DataTable` | See section 7. |
| `Pagination` | "1 to 10 of 42", per-page select, previous and next icon buttons. |
| `Card` | `--surface`, `--r-lg`, hairline border, 24 px padding. `CardHeader` holds a caption-style title. |
| `EmptyState` | Centred icon in a soft circle, display-style heading, one sentence, one primary button. |
| `Thumb` | Media thumbnail with `--r-md`, fixed aspect box, a type badge in the corner, a neutral placeholder while loading or when there is no image. |
| `Skeleton` | Shimmering neutral blocks for loading lists; no spinners on whole pages. |
| `Banner` | Inline notice with tone (info, warn, danger, ok), an icon, text and an optional action. Replaces the old `Notice`. |
| `Tooltip` | Appears on hover and focus after 400 ms; never the only place a label exists. |

Icons come from the open-source `lucide-react` package (ISC licence), 20 px, 1.75 stroke, imported one by one.

## 6. Brand mark

Until TINNOX supplies official files, the mark is text: "TINNOX" in the system face, 17 px at 700 with 0.14em tracking in `--ink` (21 px on the sign-in screen). The link's accessible name is "TINNOX CMS" ("CMS" is visually hidden). In the shell a "Prototype" capsule follows it, outside the link (section 4). Collapsed sidebar: a 36 px rounded square in `--accent` with an `--on-accent` "T".

## 7. The list page pattern

Every list (media, apps, playlists, layouts, schedules, screens, users, audit) uses the same parts, top to bottom:

1. **Filter row:** `SearchField` (left), then filter chips or menus specific to the object (tags, status, type).
2. **Toolbar row:** a count ("12 items") on the left. On the right: New folder (where folders apply), a `Segmented` list or grid toggle, and a refresh icon button.
3. **Table:** one `--surface` container with `--r-lg` and a hairline border. The header row is transparent with caption-style labels; sortable headers are buttons with an arrow. Rows are 64 px tall, separated by hairlines, `--surface-2` on hover and when selected. First column: checkbox. Then a 44 px `Thumb` and the name as the row's link. Last column: a three-dot `IconButton` opening the row `Menu`. This grouped, hairline-separated list is the deliberate departure from Yodeck's separate row cards.
4. **Grid view:** cards of `--r-lg` with a 16:9 `Thumb`, name and a type icon; a checkbox appears on hover and focus and stays when ticked.
5. **Selection bar:** when one or more rows are ticked, a floating pill bar appears at the bottom centre: "3 selected", the bulk actions, and Clear. This replaces a disabled Actions button.
6. **Create:** the primary create button sits at the right end of the filter row ("Add media", "New playlist", "Add screen"), so it is visible without scrolling.
7. **Pagination** at the bottom right of the table.
8. **Empty state** when there is nothing to list; a "no results" variant when a search or filter hides everything, with a Clear filters button.

## 8. The editor page pattern

- Two columns from 1100 px up: a narrow "details" card (preview, facts, where used) and a wide "settings" card. One column below that.
- Settings are grouped under caption-style group titles with a hairline above each group.
- Form rows are label-above on narrow layouts and label-left (200 px label column) from 900 px up.
- Unsaved changes: Save becomes enabled, a quiet "Unsaved changes" label appears next to it, and leaving the page asks for confirmation.
- Save reports with a toast. Validation errors are shown at the field and summarised in a `Banner` at the top of the form with links to the fields.

## 9. States every page must show

Loading (skeleton), empty, error with a Retry button (the existing `ErrorNotice` behaviour, restyled), partial failure, and success confirmation. Processing media shows a `warn` pill "Processing" and refreshes itself. Failed media shows a `danger` pill and the reason. A screen shows what its player last reported, in the words of P2-04 (In sync, Updating, Not reporting, Error, Waiting for player, Nothing pushed, Not paired), always with when that report arrived; the portal has no "online" or "offline".

## 10. Responsive behaviour

The portal is used on laptops and large monitors first. It must stay usable at 768 px wide: the sidebar becomes a drawer, tables drop their least important columns (declared per table) before they scroll horizontally, two-column editors stack, and dialogs become full-width sheets under 560 px.
