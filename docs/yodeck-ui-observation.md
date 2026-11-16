# Yodeck UI observation

Date: 2026-11-15. Status: **DIRECTLY OBSERVED**. This is the companion to `yodeck-workflow-audit.md`, which was a documentation audit and observed nothing. Here the signed-in Yodeck portal (`app.yodeck.com`, a trial account on the free plan with one Web Player screen) was walked through in a browser, read-only. Nothing was saved, pushed, created or deleted in that account.

Purpose: a structural reference for the TINNOX CMS portal redesign (`docs/portal-v2/`). TINNOX decided on 2026-11-15 to follow Yodeck's information architecture and interaction patterns, with TINNOX's own visual identity.

What is and is not taken from Yodeck:

- **Taken:** the shape of the product. Which sections exist, how lists, editors and dialogs are organised, and which functions each screen offers.
- **Not taken:** code, images, icons, illustrations, template artwork, fonts as shipped, colours, the logo, product names and wording. TINNOX CMS uses its own names, its own copy, an open-source icon set and the TINNOX palette. No Yodeck screenshot is committed to this repository.

Account-specific values (e-mail, IDs, IP addresses, screen names) are left out on purpose.

## 1. Application shell

| Part | Observed |
|---|---|
| Left sidebar | About 173 px wide at a 1568 px viewport, light, collapsible with a small chevron at its top-right edge. Logo at the top. One item per section, icon plus label. The active item has a tinted background and accent-coloured text. A help menu sits at the bottom. |
| Sidebar order | Welcome, Dashboard, Media (expands to All Media, Images, Videos, Audio, Documents, Web Pages), Apps, Playlists, Layouts, Schedules, Screens. |
| Page header | Page title at the left (about 20 px, medium weight). At the right: a workspace selector, a user menu and one primary button, **Push to Screens**, present on every list page. |
| Workspace selector | Popover with a search box, "All Workspaces", one row per workspace and a "Manage Workspaces" link. |
| User menu | My Profile, Account Settings, Upgrade, Buy Players, Users, Audit Log, Logout. |
| Trial banner | A full-width strip above the header with the plan message, an Upgrade button and a close button. |
| Type and colour | Inter 14 px body, near-black text on a very light grey page (`#f9f9f9`), white cards and rows, one warm accent colour for primary buttons, links and active states, 5 to 8 px radii, almost no shadows. |
| Editors | Detail and editor pages drop the page header. They show a back link, the object title, and Cancel and Save at the top right. Save is a split button whose menu offers "Save and Add to Playlist" and "Save and Set to Screen". |

## 2. The list page pattern

Media, Apps, Playlists, Layouts, Screens, Users and Emergency Alerts all use one pattern:

1. A search box ("Search in All Items") and, where the object has tags, a Tags filter button.
2. A section heading ("All Items"), then on the right: a filter (by availability: Expired, Non-expired; on Screens: by player status), **Add folder**, a grid/list toggle and a reload button.
3. A count ("3 items") and a per-page selector.
4. A table with a header row on a grey pill-shaped band. Each data row is its own white rounded card with a gap between rows. First column is a checkbox, then a thumbnail and name, then object-specific columns, then an Actions column with a three-dot menu. Columns sort on click.
5. Pagination (Prev, page numbers, Next) at the bottom right.
6. Below the table: the primary create button ("Add Media", "Create App", "Add Playlist", "Create New Layout", "Add Screen") and an **Actions** button for the ticked rows. Actions is disabled until a row is ticked.
7. Grid view shows the same items as thumbnail cards with a checkbox, a type icon and the name.
8. An empty section shows a centred heading, an illustration, one sentence and the create button.

Row menus observed:

| Object | Row menu |
|---|---|
| Media | Edit, Add to Playlist, Set to Screen, Duplicate, Move, Item Details, Delete |
| Playlist | Edit, Set to Screen, Duplicate, Item Details, Delete |
| Screen | Edit, Duplicate, Takeover Screen, Item Details, Delete |

Bulk Actions on Screens: Turn screen On, Turn screen Off, Reboot Player, Shutdown, Clear Browser Session Data, Takeover Screen, Edit, Delete.

## 3. Welcome and Dashboard

- **Welcome:** three cards (start with a template, sequence content with playlists, a one-minute video) and an upgrade strip.
- **Dashboard:** a greeting card; **Screen Status** with four counters (Online, Offline, Registered, Unregistered), each linking to the filtered Screens list, and a "Manage Screens" link; **Recent Activities** (timestamp, who, what, with the object linked); the subscription plan; a "get a player" card; and a world map of **Screen Locations**.

## 4. Media

- Sub-sections filter by type: All Media, Images, Videos, Audio, Documents, Web Pages. The create button is renamed per section ("Add Video").
- **Add Media dialog** has six tabs:
  - Upload: one drop zone ("drag and drop, browse or import from") with My Device and five cloud drives; supported types listed; limit of 100 files per import.
  - Images: Image file or Stock Images; then "Upload Files" or "Import from URL"; maximum 50 MP.
  - Videos: Video File, YouTube, Vimeo, PPT File, Stream, Video Wall, Video Input, Stock Videos; a "Skip video encoding" switch.
  - Audio: Audio File, YouTube, Vimeo, Stream.
  - Documents: PDF, Word, PPT, Excel.
  - Web Pages: a URL and a name, then "Proceed to the Form".
- **Edit Image:** left card with a preview, an "open in image editor" link, ID, upload date, resolution and "See where this image is being used". Right card with Source (and Change), Name, Add Description, Default Duration (a stepper, default 5 s), Tags (with Manage Tags) and Availability: a switch, From and To date-times, "Non-expiring" and "Add Scheduled Availability".
- **Edit Video:** the same, with a player in the preview, no default duration, and Rotate Video and Crop Video switches.

## 5. Apps

- Two tabs: **My apps** (the standard list, with an App Type column) and **Discover apps**.
- Discover: a search box, category chips (Video & Web, Design & Slideshows, Weather & Environment, Social Media, Interactivity, News & Alerts, Communication & Culture, Clocks & Timers, Meetings & Calendars, Dashboards, Projects & Planning, General, Custom Apps), a "For You" row, then one card grid per category. Roughly 100 apps, most of them connectors to third-party services; paid ones carry a crown.
- Self-contained apps seen in the gallery: Date & Time, Analog Clock, Word Clock, World Clock, Counter Up, Counter Down, Ticker, QR Code, WiFi Share, Web Pages, Embed (iframe), Custom RSS, Daily Feed, Custom HTML App.
- **App form** (Date & Time): left card with a live preview, ID, date and category; right card with Name, Description, a time-zone switch, Time Format, Show Time, Show Seconds, Show Date, Date Format, Language; a Style group (Theme, Theme Style, Background Colour, Font Colour, Font Family, Font Style, Font Weight); an Advanced group (Custom Format, Tags, Default Duration, Availability). Buttons: Cancel, Preview, Save.

## 6. Playlists

- List columns: Name, Description, Modified, Media Type (icons for the kinds of item inside).
- **Editor:**
  - Name and Description.
  - **Transition Options** (collapsible): "Add black gap between videos", "Image Transitions".
  - **Playback Options** (collapsible): "Sync Playback", "Random Playback".
  - A "Folder View" switch.
  - **Playlist** card: a horizontal strip of fixed-size tiles. A filled tile shows the thumbnail, the name and a duration stepper (minus, value in seconds, plus). Video tiles show their own length, greyed. Hovering a tile shows its full name and a remove button. Empty tiles are grey placeholders. Top right: "Upload Media", "Total duration 0:00:39" and a menu with "Remove expired items".
  - **Library** card under the strip: filter chips (All Media, Images, Videos, Audio Assets, Documents, Web Pages, Apps, Playlists, Layouts), a search box and a thumbnail grid. Items are dragged or clicked into the strip.
  - Buttons: Cancel, Preview, Save (split), and "See where this playlist is being used".
- A playlist can contain layouts and, on higher plans, other playlists.

## 7. Layouts

- List tabs: My Layouts, Branded Templates, Discover Templates. Buttons: Create New Layout, Create with AI.
- **Editor** is a full-window canvas editor:
  - Top bar: back, info, the layout name (editable), screen type, undo, redo, zoom (minus, percentage, plus), BG Color, Layers, hand tool, full screen, Preview, Cancel, Save (split).
  - Screen type popover: Landscape, Portrait or Custom, an Aspect Ratio selector (for example 16:9 (4K)), "Remember my selection", Apply.
  - Left rail: Templates, Media, Apps, Playlists, Text, Elements, Settings. Each opens a panel beside the canvas.
  - Templates: search, category chips, thumbnail grid.
  - Media and Playlists: search and thumbnails from the library; Media has an Upload button and type chips.
  - Text: "Add a Text Box" and three presets (heading, subheading, body).
  - Elements: Shapes (star, triangle, hexagon, rectangle, circle, lines) and Graphics (arrows and similar).
  - Settings: Background Audio, Snap to Grid, a lock for non-admins, and Availability.
  - Layers panel: every element in z-order with a checkbox and a drag handle, "Select All", and "Apply Background Color".
  - Selecting a text element shows a floating toolbar: font family, size stepper, text colour, fill colour, weight, italic, underline, alignment, line spacing, letter spacing, direction, duplicate, Position, lock and delete. The element shows a selection box with side handles.

## 8. Schedules

- Empty state: "A schedule is a calendar of events that sets what plays on your screen and when."
- **Editor:** an editable name; a calendar with Month, Week and Day views, Today, previous and next, and an add button; a right panel, **Events List** ("the order shows priority for display during overlaps"), holding scheduled events and a **Filler Content** entry ("shown on the screens when no events are scheduled"); "View assigned screens".
- **New Event dialog:** Event Type (Schedule Content or Turn screen Off); Content (type: Layout, Playlist or Media; then a picker); Event Starts and Event Ends (date and time each); Repeat (Does not repeat, Daily, Every weekday, Weekly on the same weekday, Monthly on the same day, Annually on the same date); and the note "The schedule runs on the screens' local time zone."

## 9. Screens

- List columns: Name, Player Status (a pill: Online, Offline or Unregistered, plus a tick when content is up to date), Player Type, ID, Screen Content (a link to the assigned object), Working Hours. Manage Columns adds TV Status, HDMI Connected, Uptime, Screen Resolution, Power Supply, CPU Temperature, Locked Down, Encrypted, Tags, Hardware Version, Description, Workspace, Hostname, Offline Time. Also: Player status filter, Enable Working Hours, Export (CSV), Columns.
- **Add Screen:** first a dialog asking for the hardware path (a player, a smart TV, or "try in my browser"); then a two-step page, "Registration code" then "Screen content". Step one is a single large code box ("8 or 9 characters") and a Register button, with "Advanced setup" and a help strip.
- **Screen Details:**
  - Left card: the latest screenshot in a monitor frame, an Online pill, Last screenshot, Last seen online, Content status ("Updated"), Workspace name, a **Takeover Screen** button, a primary **Save & Push to this Screen** button and an Actions menu (Turn screen On, Turn screen Off, Reload Player).
  - Right: Name, the player URL, "Register a Different Device", Add Description, and **Screen Content**: a type selector (Layout, Playlist, Media, App, Schedule) with a picker.
  - Ten tabs: **Basic** (Tags, Screen Orientation), **Sound/Display** (Volume Schedule, Overscan), **Media Filtering** (filter media by tag), **Working Hours** (Screen always on, Workspace Working Hours or Custom; "Screens will be turned off outside of working hours"), **Location** (Auto Detect Location), **Email notifications** (notify after N hours offline, notify during scheduled turn-off, notify when back online, recipients), **Status** (screen ID, last status update, browser, software version, resolution, storage, uptime, RAM, and a Refresh button), **Advanced** (Timed Events, Customization, scheduled reboot), **Emergency Alerts** (alert types allowed on this screen), **Interactivity** (touch screen switch).

## 10. Account

- **Account Settings** is one long page of rows, grouped: Subscription (plan, upgrade, players, billing entities, add-ons); Users (Users, Groups, Workspaces, Security Policies, SSO, Custom Roles); Player (boot logo, volume schedules, playback reports); Content (AI content creation, branded templates, content flows, custom ratios, media/app tags, screen tags, custom fonts, 4K video option); Advanced (API tokens, personal data and compliance, audit log, system appearance); Alerts (emergency alerts). Each row has an icon, a title, one line of description and the current value on the right.
- **Users:** the standard list (User, Primary Workspace, Group, Explicit Access, Last Login, Date Added) with role badges next to the name. Invite form: Email, Allowed IP addresses, Primary Workspace, Groups (All Users, Global Admins, Billing Access, Content & Device Managers, Content Managers, Restricted Content Managers, Content Viewers, Template Managers, Playback Reports Viewers, Workspace Admins) and per-workspace roles.
- **Audit Log:** tabs Audit Log and Log Files; a search box; From and To date-times; columns Time, Session (IP and session code), Workspace, User/Token, Section, Name, Action, Source.
- **Emergency Alerts:** tabs Alert Types, Player Broadcast Groups, CAP Handlers and a US weather service; alert types have Name, Category, Headline, Description and Instructions.
- **Workspaces:** list with Name, screen count and limit, and a create button.

## 11. TINNOX website look (observed the same day)

`tinnox.com.au` supplies the palette and feel. Values read from the page's CSS variables confirm and extend the table in `tinnox-context.md` section 7.

| Token | Value |
|---|---|
| Deep Teal (brand, buttons, links) | `#0f4761`; dark `#0d384d`; scale 50 `#eff5f7`, 100 `#dce9ed`, 200 `#b7d3dc`, 400 `#6099ac` |
| Midnight (text, dark surfaces) | `#12212a` |
| Slate (secondary text) | `#5d6b73` |
| Signal Sky (focus, accent) | `#72afc2` |
| Mist (lines) | `#dce7ea` |
| Porcelain (light surface) | `#f6f8f8`; neutral 100 `#eaf0f1`; neutral 400 `#93a1a7` |
| Error | `#a4262c` |
| Headings | Manrope, weight 700, line height 1.2 |
| Body | Inter, 16 px, line height 1.35; buttons weight 500 to 600 |
| Shape | Pill buttons (radius 999 px, 40 and 48 px tall), 24 px card radius, 16 px image radius |
| Motion | `cubic-bezier(.2, .7, .2, 1)` |
| Header | A white bar that becomes a floating, rounded, translucent pill on scroll |
| Feel | Large type, generous white space, full-bleed photography, dark Midnight sections, one colour used sparingly. Close to Apple's product pages. |

Both typefaces are under the SIL Open Font License and are self-hosted on the site. The logo is not embedded in the portal until TINNOX supplies official files (`tinnox-context.md` section 7); the portal uses a text wordmark until then.
