# Portal v2 design system

Date: 2026-11-15. Status: the binding visual and interaction spec for the redesigned operator portal (`apps/portal`). Source of the structure: `docs/yodeck-ui-observation.md`. Source of the look: the TINNOX website tokens in the same document, section 11.

## 1. Direction in one paragraph

The portal follows Yodeck's layout: a left sidebar of sections, a page header with a title on the left and account controls plus one primary "Push to screens" button on the right, list pages built from a search row, a toolbar, a table and a create button, and editor pages with a back link and Cancel and Save at the top right. On top of that structure it wears TINNOX's identity and a calmer, Apple-like finish: Deep Teal as the single brand colour, Manrope headings over Inter body text, pill buttons, large soft radii, hairline separators instead of boxes, translucent "glass" on the sidebar and the sticky header, generous spacing, and short eased motion. It must not look like a recoloured Yodeck: icons, wording, illustrations and the table treatment are our own.

## 2. Hard rules

1. No remote assets. Fonts and icons are bundled from npm packages and served from the portal's own origin. The production Content-Security-Policy in `apps/portal/index.html` stays as strict as it is today (`style-src 'self'`, `font-src 'self'`, `script-src 'self'`).
2. No inline `style="..."` in static HTML and no `dangerouslySetInnerHTML`. Dynamic geometry may use React's `style` prop (it writes through the CSSOM, which the policy allows).
3. Accessibility is WCAG 2.2 AA: every control reachable and operable by keyboard, a visible focus ring, text contrast at least 4.5:1, targets at least 24 by 24 px, no information by colour alone (status pills carry an icon or text), dialogs trap focus and restore it, menus follow the ARIA menu-button pattern, `prefers-reduced-motion` removes movement.
4. Light and dark themes both ship. Colours are only ever referenced through the semantic tokens in section 3.
5. Wording is TINNOX's own, in Australian English and sentence case ("Push to screens", "Add media"). The product name is "TINNOX CMS". The logo image is not embedded; the brand mark is the text wordmark described in section 6.
6. Nothing from Yodeck is reused: no icon, illustration, template artwork, screenshot or sentence.

## 3. Tokens

All tokens are CSS custom properties on `:root` in `apps/portal/src/styles/tokens.css`. Dark values go under `@media (prefers-color-scheme: dark)`. `src/styles/tokens.test.ts` checks every text and boundary pair against WCAG 2.2 AA in both themes.

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f6f8f8` | `#0c161c` | Page background |
| `--surface` | `#ffffff` | `#12212a` | Cards, table container, dialogs, inputs |
| `--surface-2` | `#eff5f7` | `#182c38` | Hover rows, selected nav item, soft fills |
| `--surface-3` | `#dce9ed` | `#21404f` | Pressed, selected chips |
| `--glass` | `rgb(255 255 255 / 0.72)` | `rgb(18 33 42 / 0.72)` | Sidebar and sticky header, with `backdrop-filter: saturate(180%) blur(20px)` |
| `--line` | `#dce7ea` | `#24404d` | Hairlines, input borders |
| `--line-strong` | `#b7d3dc` | `#35606f` | Hovered hairline, dividers that must show |
| `--line-control` | `#7b8f98` | `#577d8c` | Boundary of text inputs, checkboxes and switch tracks (added 2026-11-15: a control's boundary must reach 3:1, which `--line` and `--line-strong` do not) |
| `--ink` | `#12212a` | `#f1f6f7` | Primary text |
| `--ink-2` | `#5d6b73` | `#a9bcc4` | Secondary text, table headers |
| `--ink-3` | `#93a1a7` | `#7a8f98` | Disabled text only (never for text that must be read). Placeholders use `--ink-2` (changed 2026-11-15: a placeholder is read, and `--ink-3` is below 4.5:1) |
| `--brand` | `#0f4761` | `#72afc2` | Primary buttons, links, active nav, selected states |
| `--brand-hover` | `#0d384d` | `#8fc2d2` | Hover of the above |
| `--on-brand` | `#ffffff` | `#0c161c` | Text on a brand fill |
| `--focus` | `#3a8aa3` | `#b7d3dc` | Focus ring: `0 0 0 2px var(--surface), 0 0 0 4px var(--focus)`. Light value changed 2026-11-15 from `#72afc2`, which reaches only 2.4:1 on white; a focus indicator needs 3:1 |
| `--ok` / `--ok-bg` | `#1b6e45` / `#e6f4ec` | `#6fd3a0` / `#143526` | In sync, ready, success |
| `--warn` / `--warn-bg` | `#8a5a00` / `#fbf1dc` | `#f0c267` / `#3a2c0d` | Pending, processing, attention |
| `--danger` / `--danger-bg` | `#a4262c` / `#fbe9ea` | `#ff8f95` / `#42181b` | Errors, destructive actions |
| `--neutral-bg` | `#eaf0f1` | `#21343e` | Neutral pills, skeletons |
| `--scrim` | `rgb(18 33 42 / 0.36)` | `rgb(0 0 0 / 0.56)` | Dialog backdrop |

### Type

| Token | Value |
|---|---|
| `--font-head` | `"Manrope Variable", "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| `--font-body` | `"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| `--font-mono` | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` (pairing codes, IDs, hashes) |

| Style | Font | Size / line | Weight | Tracking |
|---|---|---|---|---|
| Display (sign-in, empty states) | head | 32 / 38 | 700 | -0.02em |
| Page title (`h1`) | head | 26 / 32 | 700 | -0.02em |
| Section title (`h2`) | head | 18 / 24 | 700 | -0.01em |
| Card title (`h3`) | body | 15 / 20 | 600 | -0.01em |
| Body | body | 14 / 20 | 400 | -0.005em |
| Body strong | body | 14 / 20 | 600 | -0.005em |
| Small | body | 13 / 18 | 400 | 0 |
| Caption, table header | body | 12 / 16 | 600 | 0.02em, sentence case, `--ink-2` |

Numbers in tables, counters and durations use `font-variant-numeric: tabular-nums`.

### Shape, space, depth, motion

| Token | Value |
|---|---|
| Radius | `--r-xs: 6px`, `--r-sm: 10px` (inputs, menu items), `--r-md: 14px` (rows, tiles, thumbnails), `--r-lg: 20px` (cards, dialogs), `--r-pill: 999px` (buttons, chips, pills, search) |
| Space scale | 4, 8, 12, 16, 20, 24, 32, 40, 56 as `--s-1` to `--s-9` |
| Control heights | 32 (small), 36 (default), 44 (large: page primary, sign-in) |
| Shadows | `--shadow-1: 0 1px 2px rgb(18 33 42 / 0.05)`; `--shadow-2: 0 4px 16px rgb(18 33 42 / 0.08), 0 1px 2px rgb(18 33 42 / 0.04)` (menus, popovers); `--shadow-3: 0 24px 64px rgb(18 33 42 / 0.18)` (dialogs). Cards use a hairline border and no shadow. |
| Motion | `--ease: cubic-bezier(.2, .7, .2, 1)`; `--t-fast: 120ms`; `--t: 200ms`; `--t-slow: 320ms`. Under `prefers-reduced-motion: reduce` all durations are 0 and transforms are removed. |
| Layout | Sidebar 240 px (collapsed 72 px). Content column fluid with 32 px side padding (16 px under 900 px wide), maximum 1440 px. |

## 4. Application shell

```
+----------------+----------------------------------------------------------+
| TINNOX  cms    |  Page title                 [org] [account] [Push to..]  |
|                |----------------------------------------------------------|
| Home           |                                                          |
| Dashboard      |  page content                                            |
| Media        v |                                                          |
|   All media    |                                                          |
|   Images       |                                                          |
|   Videos       |                                                          |
|   ...          |                                                          |
| Apps           |                                                          |
| Playlists      |                                                          |
| Layouts        |                                                          |
| Schedules      |                                                          |
| Screens        |                                                          |
|                |                                                          |
| Help         ^ |                                                          |
+----------------+----------------------------------------------------------+
```

- **Sidebar:** fixed, full height, `--glass` over the page background, a hairline on its right edge. Wordmark at the top. Items are 40 px tall rows with a 20 px icon and a label, `--r-sm` radius, 8 px side margin. Active item: `--surface-2` fill, `--brand` icon and text, weight 600. Media is a disclosure group; it opens automatically on any media route. A collapse button reduces the sidebar to icons with tooltips; the choice lasts for the page session only, held in memory (the portal uses no web storage: the lint rule and an end-to-end test forbid it). Under 900 px the sidebar becomes an overlay drawer opened by a menu button in the header.
- **Page header:** sticky, `--glass`, 72 px tall. Left: the page `h1`. Right, in order: the organisation label (a quiet pill with the organisation name; it becomes the workspace switcher later), the account menu (avatar circle with initials; menu: profile name and e-mail, Account settings, Users, Audit log, Sign out), and the primary pill button **Push to screens** with a count badge when changes are waiting.
- **Editor pages** replace the page header content with: a back link ("All playlists"), the object name as `h1`, then quiet Cancel and primary Save (a split button where the page defines extra save actions).
- **Environment strip:** a slim strip above the header reads "Internal engineering prototype. Synthetic data only." It replaces the old footer text and can be dismissed for the session.
- A skip link to `#main` stays first in the tab order.

## 5. Components

Each lives in `apps/portal/src/ui/` with its styles in `apps/portal/src/styles/`. Class names are prefixed `tx-`.

| Component | Spec |
|---|---|
| `Button` | Pill. Variants: `primary` (brand fill), `secondary` (surface with a hairline border), `ghost` (no border, `--surface-2` on hover), `danger` (danger text; filled only inside a confirm dialog). Sizes 32, 36, 44. Optional leading icon. Busy state shows a spinner and keeps the width. |
| `IconButton` | 36 px circle, ghost by default, needs an `aria-label`, shows a tooltip. |
| `SplitButton` | Primary action plus a chevron segment opening a menu of related actions. |
| `Menu` | Popover on `--surface` with `--shadow-2` and `--r-md`; items 36 px, icon plus label, destructive items in `--danger` after a divider. Arrow keys, Home, End, typeahead, Escape. Used by row action buttons, the account menu and split buttons. |
| `Dialog` | Built on the native `<dialog>` element with `showModal()`. `--r-lg`, `--shadow-3`, scrim, title row with a close button, a scrolling body, a footer with the secondary action on the left of the primary. Widths 480, 640, 880. |
| `ConfirmDialog` | A dialog that names the object and the consequence; the destructive button is never the default focus. |
| `Toast` | Bottom centre, pill-shaped, auto-dismiss after 5 s unless it reports an error; announced through an `aria-live` region. |
| `Field` | Label above the control, optional hint below, error text in `--danger` with an icon, wired with `aria-describedby`. |
| `TextInput`, `Textarea`, `Select` | 36 px tall, `--r-sm`, hairline border, `--surface`. Native `<select>` with a custom chevron. |
| `SearchField` | Pill input with a leading search icon and a clear button. |
| `Switch` | 36 by 22 px track, brand when on; a real checkbox with `role="switch"`. |
| `Checkbox` | 18 px, `--r-xs`, brand when checked, supports the mixed state for "select all". |
| `Stepper` | Minus, numeric input, plus, in one pill; arrow keys step; used for durations. |
| `Segmented` | Apple-style segmented control for two to four exclusive choices (list or grid, calendar view, "My apps" or "Discover"). |
| `Tabs` | Underline tabs for longer sets (the screen settings tabs, the add-media dialog). ARIA tabs pattern. |
| `Chip` | Pill for filters and tags; selectable chips fill with `--surface-3`; removable chips have a close button. |
| `StatusPill` | Small pill with a leading dot or icon: ok, warn, danger, neutral. Text always present. |
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

Until TINNOX supplies official files, the mark is text: "TINNOX" in Manrope 800 with 0.08em tracking in `--ink`, followed by "CMS" in Inter 600 at 11 px inside a small `--surface-3` pill. Collapsed sidebar: a 36 px rounded square in `--brand` with a white "T".

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
