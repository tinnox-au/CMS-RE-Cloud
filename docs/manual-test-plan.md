# TINNOX CMS manual test plan

Version of the software: `main` at the Layouts release (stage B, slice 4; migrations 0001 to 0012; player `player-web/0.5.0`). Written 2026-11-18; revised 2026-11-19 after the first manual run (`docs/reviews/2026-11-19-manual-user-test/`).

This plan is for a person, not a script. You follow the steps in order, compare what you see with the **Expected** lines, and tick each box that matches. Anything that does not match goes into the issue log at the end (section 20). Nothing here is deployed anywhere: everything runs on your own computer with synthetic data.

Allow **about 3 hours** for the whole plan. Sections 1 to 10 are the core journey and take about 90 minutes; sections 11 to 19 can be done in any order after that.

## How to use this plan

- Work through the sections in order the first time. Later sections assume the objects created earlier (a screen, three playlists, a paired player).
- Each test has a reference such as **T4.3**. Quote it in the issue log.
- A box is ticked only when what you see matches the Expected line. If it almost matches (different words, same meaning), tick it and add a note in the issue log with severity *Cosmetic*.
- Do not guess. If you cannot tell whether something worked, leave the box empty and write what you saw.
- Never type a real password or a real customer's content anywhere. The sign-in details come from a script (section 2) and exist only in your local Keycloak.
- Do not share screenshots of the sign-in page or of the terminal output that prints the password or the one-time code.

### Severity guide for the issue log

| Severity | Meaning |
|---|---|
| Blocker | You cannot continue the plan (cannot sign in, cannot pair, the player never plays). |
| Major | A client-facing function does not do what the plan says (wrong content on screen, lost data, a push that silently does nothing). |
| Minor | It works, but with friction: an unclear message, a state that needs a refresh to update, a control that is hard to find. |
| Cosmetic | Wording, alignment, colour, spacing. |

### Known limitations: do not log these as new issues

- The **player** pairing screen says "open the display", while the portal says "screen". Known wording mismatch.
- The README "Walkthrough" section uses old names ("Displays", "Publish to display"). This plan uses the current names.
- The player shows **no "updating" indicator** while it downloads new content. Progress is visible only in the portal (Overview tab) and in the player's diagnostics overlay.
- **Video always plays muted.** This is by design.
- Tabs and settings marked **Planned** (Alerts, Advanced, Users and roles, Stock, Web page, Document, Audio) do nothing. They are not in scope.
- In the development mode used here, the player has **no offline reload**: if you reload the player page while its network is off, it will not load. Keep playing without reloading. (Offline reload exists only in the production build, `npm run start:built`.)
- Status in the portal is what the **player software** reported. It is evidence, not proof of what a physical screen shows. The portal says so in several places on purpose.

---

## 1. Start the local system

**What you need**

- A Mac or Linux computer with **Docker Desktop running**, **Node.js 22.13 or newer** and **Google Chrome** (or Chromium).
- The repository checked out on `main`, with a terminal open at its root folder.
- Free local ports 4000, 5173, 5174, 8080 and 54329 (or 54330).
- About 15 minutes for this section the first time.

### T1.1 First-time setup (skip if the repository has been set up on this computer before)

Run these one at a time and wait for each to finish:

```bash
npm ci
```

```bash
npm run setup
```

```bash
npm run infra:up
```

```bash
npm run db:migrate
```

```bash
npm run db:seed -- --second-org
```

```bash
npm run fixtures
```

Expected:

- [ ] Every command ends without an error message. `npm run infra:up` ends with the three containers (postgres, keycloak, media-worker) reported healthy.
- [ ] `npm run db:migrate` lists the applied migrations and ends at `0012`.
- [ ] `npm run db:seed` prints two organisations: "TINNOX Internal" with the site "Melbourne Workshop" and "Isolation Test Organisation" with the site "Isolation Test Site".
- [ ] `npm run fixtures` writes sample files into `apps/api/test-fixtures/out/` (you will see `landscape.jpg`, `portrait.png`, `h264.mp4`, `hevc.mp4` and others there).

### T1.2 Start the servers

```bash
npm run dev
```

Expected:

- [ ] Three coloured prefixes appear in the terminal, `api`, `portal` and `player`, and none of them prints an error. The terminal keeps running (leave it open for the whole session; Ctrl+C stops everything).
- [ ] Open http://localhost:4000/readyz in a browser: it shows a short JSON answer in which every item reads ready or true.
- [ ] Open http://localhost:5173 : the sign-in page appears, with the heading **Operator sign-in**, a **Sign in** control and the note "Internal engineering prototype. Synthetic data only."

Always use `localhost` in the address bar, never `127.0.0.1`.

---

## 2. Sign in

### T2.1 Get the sign-in details

In a **second terminal** at the repository root:

```bash
npm run otp -- --show-password
```

It prints the username (`operator`), the password and a six-digit one-time code with the seconds it is still valid for. The code changes every 30 seconds and each code is accepted once. If it says it is valid for fewer than 10 seconds, run the command again and use the new code.

- [ ] The command prints a username, a password and a one-time code.

### T2.2 Sign in with password and one-time code

1. On http://localhost:5173 press **Sign in**.
2. You are taken to the identity provider (Keycloak, address starts with `localhost:8080`). Enter the username and password, continue.
3. Enter the one-time code, continue.

Expected:

- [ ] After the code you land back in the portal on the **Dashboard**. The organisation name **TINNOX Internal** appears at the top right, with a round initials button and a **Push to screens** button.
- [ ] The sidebar lists: Dashboard; Media (with All media, Images, Videos, and Audio, Documents, Web pages marked *Planned*); Apps; Playlists; Layouts; Schedules; Screens; and Settings at the bottom.

### T2.3 A wrong one-time code is refused

1. Open the initials button (top right) and choose **Sign out**.
2. Press **Sign in** again, enter the username and password, and then enter a wrong code (for example `000000`).

Expected:

- [ ] After signing out, the sign-in page shows the message "You have signed out."
- [ ] The wrong code is refused by the identity provider and you stay on its code page. Enter a fresh code from `npm run otp` and you get in.

Do not try wrong **passwords**; the account would lock.

---

## 3. Dashboard on an empty organisation

You are signed in with no screens, no media and no playlists.

### T3.1 Empty state

Expected:

- [ ] The page is titled **Dashboard** with the subtitle "What each player last reported."
- [ ] A **Get set up** card shows "0 of 4 steps done" and four steps: Add a screen, Pair its player, Upload media, Push a playlist. Each has a button that leads to the right place.
- [ ] The Screens card shows "No screens yet".
- [ ] The **Changes waiting** card reads "Nothing to push yet".
- [ ] The **Library** card reads "0 media files" and "0 playlists" with a storage meter at 0.
- [ ] **Recent activity** lists your sign-in: "Operator signed in".

---

## 4. Media library

Open **Media → All media**. The sample files are in `apps/api/test-fixtures/out/` (created by `npm run fixtures`).

### T4.1 Empty state and the Add media dialog

Expected:

- [ ] The library shows "No media yet" with a hint that you can drop files anywhere on the page.
- [ ] **Add media** opens a dialog. Its **Upload** tab is active; **Stock**, **Web page**, **Document** and **Audio** are disabled and marked Planned.
- [ ] The drop zone says it accepts JPEG and PNG images and MP4 video (H.264) up to 200 MB per file.

### T4.2 Upload files that should be accepted

Use **Choose files** (or drag and drop) and pick these four files together: `landscape.jpg`, `portrait.png`, `h264.mp4`, `h264-with-audio.mp4`.

Expected:

- [ ] Each file gets its own row. The rows move through *Waiting*, a percentage, "Uploaded, being checked" and end at **Ready**.
- [ ] Once every check has finished, the summary at the bottom of the dialog reads "4 of 4 ready" (while checks run it also says how many are being checked). If you close the dialog while files are still sending, a toast "4 files uploaded" appears when they are sent (toasts appear at the edge of the window and close by themselves after a few seconds).
- [ ] After **Done**, the four files are listed with Status **Ready**, Kind image or video, and dimensions in the Details column (the videos also show a length).
- [ ] Images and videos each show a thumbnail.

### T4.3 Upload files that should be refused

Upload these together: `hevc.mp4`, `vp9.mp4`, `h264-yuv444.mp4`, `too-wide.png`, `jpeg-signature-then-garbage.jpg`, `text-renamed.jpg`, `html-renamed.png`.

Expected (the server takes five of them in and its check refuses each one, so the row ends at **Failed** with a reason in plain words and a code in small text; the two renamed files are refused as they arrive and are never stored):

- [ ] `hevc.mp4` and `vp9.mp4`: "The video codec is not supported. Re-encode the video as H.264 in an MP4 container." (`unsupported_codec`)
- [ ] `h264-yuv444.mp4`: a message about re-encoding as H.264 with 8-bit 4:2:0 colour (`unsupported_pixel_format`)
- [ ] `too-wide.png`: "The image dimensions exceed the allowed size…" (`image_too_large`)
- [ ] `jpeg-signature-then-garbage.jpg`: "The file is damaged or incomplete and could not be read." (`corrupt`)
- [ ] `text-renamed.jpg` and `html-renamed.png`: refused at once with **Upload failed**, the message that the content is not a JPEG, PNG or MP4 file (`unsupported_media_type`) and a **Try again** button. They are not added to the library.
- [ ] The summary at the bottom of the dialog reads "0 of 7 ready · 5 failed the check · 2 not uploaded".
- [ ] In the list, the **Failed** status chip filters to these five files. Each failed row shows its reason. Their row menu has **Add to playlist** disabled with the hint "Failed its check".
- [ ] Open one failed file (row menu → **Open**): the page says "This file was not accepted", shows the reason, and offers **Delete file**. Delete it. Repeat until all 5 failed files are gone. (Each delete shows a confirmation dialog, then a toast.)

### T4.4 The media file page

Open `landscape.jpg`.

Expected:

- [ ] A preview of the image, and a **File details** panel with File name, Kind, Dimensions, Size, Uploaded, SHA-256 and ID. The copy buttons next to SHA-256 and ID show a toast "… copied".
- [ ] **Used in** reads "Not in a playlist yet, and not part of what any screen was last pushed."
- [ ] Change **Name** to `Welcome poster` and set **Default duration** to `8`. The header changes to "Unsaved changes". **Save** shows the toast "Changes saved".
- [ ] Set **Default duration** to `0.5` and press Save: the field shows "Must be at least 1 s." and nothing is saved. Set it back to `8` and Save.
- [ ] In **Playback**, set **Available until** to a date and time **before** **Available from** and press Save: the error "Must be after Available from." appears. Clear both fields and Save.

Open `h264.mp4`.

- [ ] The video preview starts muted, with the note "Starts muted. Screens always play video without sound."
- [ ] Under Playback it says a video always plays for its own length (there is no duration field).

### T4.5 Folders and tags

Back in **All media**:

1. Press **New folder**, name it `Campaign A`, create it.
2. Select `portrait.png` and `h264.mp4` with their checkboxes; in the selection bar choose **Move to folder** → `Campaign A` → **Move here**.
3. Open the row menu of `Welcome poster` → **Edit tags**. Type `hero` and choose **Create tag "hero"** (the tag is created at once with the default colour; colours are changed later on the Media tags page), then **Save tags**.

Expected:

- [ ] Toast "Folder Campaign A created"; a folder chip **Campaign A** appears next to **All** and **Not in a folder**.
- [ ] Toast "2 files moved to Campaign A"; the **Campaign A** chip shows only those two files; **Not in a folder** shows the other two.
- [ ] Toast "Tags saved for Welcome poster"; the tag `hero` shows in its Tags column; the tag filter at the top can filter the list to that one file.
- [ ] With the Campaign A chip chosen, the folder's own menu offers **Rename folder** and **Delete folder**. Rename it to `Campaign B`: toast "Folder renamed to Campaign B".

### T4.6 Library views and search

- [ ] **Grid** shows thumbnails as tiles; **List** returns to the table.
- [ ] Typing `welcome` in **Search media** leaves only `Welcome poster`; clearing the search (Escape works) brings everything back.
- [ ] **Images** in the sidebar lists only the two images; **Videos** lists only the two videos.
- [ ] **Sort by → Largest first** puts the videos first.

---

## 5. Apps

Open **Apps**.

### T5.1 Create a Ticker

1. Press **Create app**, choose the type **Ticker**, keep the name `Ticker`, **Create app**.
2. In the editor set **Text** to `Open late every Friday · Free parking after 6 pm` and **Speed** to Fast.
3. **Save**.

Expected:

- [ ] The create dialog lists six types with a one-line description each: Clock, Date, Countdown, Ticker, QR code, Text.
- [ ] Toast "App created" and the editor opens with a live **Preview** of the scrolling text on a 1920 × 1080 canvas.
- [ ] **Preview on** offers Landscape, Portrait and (later, once a screen exists) each screen.
- [ ] Toast "App saved".

### T5.2 Contrast warning

In the same editor set **Text colour** to `#111111` (background stays `#000000`).

- [ ] A warning appears: "The text and background colours are hard to tell apart (…). Choose colours with more contrast; 4.5:1 or more reads well from a distance." Saving is still allowed.
- [ ] Set the text colour back to white (`#ffffff`); the warning disappears. Save.

### T5.3 Create a Clock and a Text app

- [ ] Create a **Clock** named `Clock`: the preview shows the current time; **Time format** switches between 12-hour and 24-hour; **Show seconds** adds seconds. Below the preview a note says the preview uses this computer's time zone and each screen uses its site's time zone. Save.
- [ ] Create a **Text** app named `Welcome text` with heading `Welcome` and message `Visit reception for your badge`. Clear both heading and message and press Save: the error "Enter a heading or a message." appears. Put the heading back and Save.
- [ ] The Apps list now shows three apps, each with **Used in** reading "Not used".

### T5.4 Validation and delete guard (checked later)

- [ ] In the Ticker editor, clear the **Text** field and Save: "Enter the text to scroll." is shown and the save is refused. Put the text back and Save.
- [ ] Delete is checked in T6.7, after the app is in a playlist.

---

## 6. Playlists

Open **Playlists**.

### T6.1 Create "Main loop"

1. Press **New playlist**, name `Main loop`, **Create playlist**.
2. In the **Add media or apps** card below the sequence, click `Welcome poster`, then `portrait.png`, then `h264.mp4`, then switch the kind chips to **Apps** and click `Clock`.
3. Press **Save draft**.

Expected:

- [ ] The dialog says the editor opens next; the editor opens with the title `Main loop`, an empty **Sequence** card that says the playlist needs at least one item before it can be pushed, and the header says "Saved".
- [ ] Each click adds a tile at the end of the sequence. Images and the app show a **Seconds on screen** stepper (the poster shows **8**, its default duration; the others **10**); the video shows its fixed **Length** and "plays in full".
- [ ] The card header counts **4 items** and shows a **Loop length**.
- [ ] With the **Apps** chip chosen, the folder and tag filters are disabled and the note "Apps have no folder or tags." appears.
- [ ] Toast "Playlist saved" with the detail "Nothing changes on a screen until you push."

### T6.2 Reorder, fit, duration, transition

1. On the `Clock` tile use **Move … earlier** until it is first.
2. On the `portrait.png` tile open **Fit** and choose **Cover**.
3. Set the `Clock` tile to `6` seconds.
4. In the **Details** card set **Transition** to **Fade** and leave **Shuffle** off.
5. Save draft.

Expected:

- [ ] The sequence now reads Clock, Welcome poster, portrait.png, h264.mp4, with position numbers updated.
- [ ] Drag and drop also reorders a tile (try moving the video to second place, then move it back with the arrow buttons).
- [ ] The Fit menu has three options: Screen default, Contain, Cover.
- [ ] Setting a duration to `0` shows an invalid-duration message and Save is refused until it is fixed.
- [ ] Toast "Playlist saved".

### T6.3 Leave guard

Change the **Playlist name** to `Main loop X` (do not save) and click **Dashboard** in the sidebar.

- [ ] A dialog **Leave without saving?** appears with **Leave and discard changes** and **Stay on this page**. Choose Stay. Press **Discard changes** in the header; the dialog "Discard your changes?" appears; confirm. The name returns to `Main loop`.

### T6.4 Create "Lunch specials" and "Ticker band"

- [ ] Create `Lunch specials` with the items `Welcome text` (app) and `portrait.png`. Save.
- [ ] Create `Ticker band` with the single item `Ticker` (app) at `20` seconds. Save.
- [ ] Create `Empty playlist` and save nothing in it (leave it empty). Go back to **All playlists**.

### T6.5 The playlists list

Expected:

- [ ] Four playlists are listed with Items, Length and Screens ("Not assigned") columns. `Main loop` shows a small mosaic of its images.
- [ ] Row menu of `Main loop` → **Duplicate**: toast 'Duplicated as "Copy of Main loop"' with an **Open copy** action. The copy appears in the list.
- [ ] Row menu of the copy → **Delete**: the dialog "Delete this playlist?" explains that the media stays in the library; confirm. Toast that it was deleted.

### T6.6 Media delete guard

Go to **Media → All media**, row menu of `Welcome poster` → **Delete**.

- [ ] The dialog warns **Used in a playlist** ("It is used in 1 playlist, so the server will refuse…"). Confirm anyway: the server refuses with an error that says the file is in a playlist (`media_in_use`). The file is still there.

### T6.7 App delete guard

Go to **Apps**, row menu of `Clock` → **Delete**, confirm.

- [ ] The delete is refused: "This app is used in a playlist", naming `Main loop`. The app stays.

---

## 7. Add a screen

Open **Screens**.

### T7.1 Empty state

- [ ] "No screens yet" with an **Add screen** button.

### T7.2 Wizard step 1: details

Press **Add screen**.

1. Leave **Name** empty and press **Create screen**.
2. Enter Name `Reception TV`, Site `Melbourne Workshop` (preselected), preset **Landscape 1920×1080**.
3. Type `10` into **Width (px)**, press Create screen.
4. Set Width back to `1920`, keep Height `1080`.
5. Tick **Limit content to a rectangle inside the canvas** and enter Left `0`, Top `0`, Content width `3000`, Content height `1080`.
6. Untick the rectangle box. Default fit **Contain**. Press **Create screen**.

Expected:

- [ ] Step 1 refuses with "Enter a name." and a summary "One field needs attention."
- [ ] Width `10` is refused with "Width must be between 16 and 16384 px." (the minimum side is 16 px).
- [ ] With the rectangle wider than the canvas, the shape preview warns "The content rectangle does not fit inside the canvas."
- [ ] The shape preview shows the canvas proportions (16:9) and the hint names the preset.
- [ ] Toast "Screen created"; the wizard moves to step 2 **Pair**, and the header reads "Screen created". The text says the screen is listed under Screens and you can finish later.

### T7.3 Wizard step 2: pairing instructions

Expected:

- [ ] Step 2 lists three instructions: open the player on the screen's device (with a link to http://localhost:5174), read the code it shows, enter it here.
- [ ] The code field has the placeholder `ABCD-2345` and the hint "Upper or lower case; the dash is added for you."
- [ ] Type `ABC` and press **Pair player**: "A pairing code has 8 letters or digits, for example ABCD-2345. It never contains 0, 1, I, L, O or U."

Leave this page open and continue with section 8.

---

## 8. Pair the player

Open a **second browser window** (same browser is fine; a separate Chrome profile is nicer because the player can then be left full screen) at http://localhost:5174 . Arrange the two windows so you can see both.

### T8.1 The pairing code

Expected (player):

- [ ] "Pair this screen" with an 8-character code in the form `ABCD-EFGH` and the line "This code expires in M:SS. A new one appears automatically."
- [ ] Press `d`: the **Player diagnostics** overlay opens. State reads `pairing`; Build reads `player-web/0.5.0 (development server)`. Press `d` again to close it.
- [ ] Reload the player page: the same code is shown again (it is kept while it has at least 20 seconds left).

### T8.2 A wrong code

In the portal (wizard step 2) enter a valid-looking but wrong code: take the player's code and change its last character to another allowed one (allowed: 2-9 and A-Z except I, L, O, U). Press **Pair player**.

- [ ] The portal says the code was not accepted: it is mistyped, has expired or was already used, and tells you to read the code on the player. The player still shows its code.

### T8.3 Pair

Enter the player's code exactly (lower case is fine, with or without the dash) and press **Pair player**.

Expected:

- [ ] Portal: banner **Code accepted**: "The player collects its credential the next time it checks in, usually within a few seconds…"; below it a live status that changes from waiting to a report.
- [ ] Player, within about 15 seconds: the code disappears and the player shows **Reception TV** and "Waiting for content".
- [ ] Portal: the status pill becomes **Nothing pushed** (a player is paired but nothing was pushed) and the footer button changes to **Continue**. Press Continue.

### T8.4 Wizard step 3: content

- [ ] The step lists the playlists; `Empty playlist` is listed last with "No items · Cannot be pushed until it has items".
- [ ] Choose `Main loop` and press **Assign playlist**: banner "Assigned: Main loop" with **Push now**, and the note that nothing changes on the screen until you push. **Do not push yet.** Press **Finish**.
- [ ] The screen page for `Reception TV` opens.

### T8.5 Dashboard progress

Open **Dashboard**.

- [ ] **Get set up** shows "3 of 4 steps done" (Add a screen, Pair its player, Upload media done; Push a playlist still to do).
- [ ] **Changes waiting** reads "1 screen has changes waiting" and the header's **Push to screens** button shows the badge **1**.

---

## 9. Push and play

### T9.1 The push dialog

Press **Push to screens** in the header.

Expected:

- [ ] The dialog is titled **Push to screens**. `Reception TV` sits in the group **Changes waiting**, ticked, with the content `Main loop`, "Never pushed" (or similar) and the pill **Not pushed yet** or **Changes waiting**.
- [ ] The primary button reads **Push to 1 screen**. Press it.
- [ ] A result banner "Pushed to 1 screen" appears; the row shows the pill **Pushed**. Press **Done**.

### T9.2 The player plays

Watch the player window for about a minute.

Expected:

- [ ] Within about 30 seconds the player starts playing: the clock (6 s), then the welcome poster (8 s), then the portrait image **cropped to fill** the frame (Cover), then the video (muted), then round again.
- [ ] Between the two images the change is a short **fade** (Transition Fade); the video **cuts**.
- [ ] Press `d`: in **Content**, *Activated* names a publication, *On screen* reads "… item N" and changes as items change, and *Schedule picks* reads "— (no schedule)". *Recent problems* reads "None recorded." Close with `d`.

### T9.3 The portal reflects the player's report

Open **Screens → Reception TV**.

- [ ] The status pill is **In sync** with "Last report … seconds ago" and the explanation that this is a report from the player software, not proof of what the physical screen shows.
- [ ] The **Content** card shows caption Playlist, `Main loop`, an **Open playlist** link and a **Change** menu. The **Push state** reads **Up to date** with "Last pushed …".
- [ ] **Overview** tab: *Desired publication* shows an id and "Pushed …"; *Downloaded publication* and *Active publication* both read **matches desired**; *Active item* reads "Item N of the active publication" and advances; *Player state* reads **Playing**; *Delivery errors* reads "None in the last report."
- [ ] The **Assigned content preview** at the top shows a mock-up of the first item, labelled as a mock-up (for an app: drawn by the code the player uses for apps), not a picture of the screen.
- [ ] **Screens** list: the row shows **In sync**, Content `Main loop` and Canvas "1920 × 1080 px"; the footnote under the table says the status is what the player last reported.
- [ ] **Dashboard**: the Get set up card has disappeared (all 4 steps done, or it reads 4 of 4), the **In sync** counter is 1 and **Changes waiting** reads "Everything is up to date".

### T9.4 Editing a draft changes nothing until the next push

1. Open **Playlists → Main loop**. Remove `h264.mp4` from the sequence and Save draft.
2. Watch the player for one full round.
3. Go to the screen page.

Expected:

- [ ] The player **keeps playing the video**: the live content is a snapshot of the last push.
- [ ] The screen page's **Push state** now reads **Changes waiting**. (Like every editor page, the screen page has no header **Push to screens** button; it has **Push to this screen**.) Open **Dashboard**: the header badge reads **1**. Go back to the screen page.
- [ ] Press **Push to this screen**, push. Within a minute the player's round no longer includes the video; the switch happens at an item boundary, never mid-item, and there is no blank moment.
- [ ] Overview: *Desired*, *Downloaded* and *Active* match again; the Screens list shows **In sync**.

### T9.5 The playlist editor's Push card

Open **Playlists → Main loop**.

- [ ] The **Push** card lists `Reception TV` with "Last pushed …" and says 1 screen has this playlist assigned and all are up to date.
- [ ] Change a duration and do **not** save: **Push now** is held, with the tooltip that the draft must be saved first. Discard the change.

---

## 10. Screen page settings

Open **Screens → Reception TV**.

### T10.1 Details

- [ ] Change **Description** to `Lobby, left of the lifts` and Save: toast "Details saved". The description appears under the name in the Screens list.
- [ ] Clear the **Name** and Save: "Enter a name." Put the name back.
- [ ] The facts show **Site** "Melbourne Workshop (Australia/Melbourne)", **Delivery route** "Browser player", **Added** and **Screen ID** with a copy button.

### T10.2 Canvas tab

1. Open the **Canvas** tab, choose the preset **Portrait 1080 × 1920**, Save changes.
2. Push (**Push to this screen**).
3. After the player has switched, set the canvas back to Landscape 1920 × 1080, Save, and push again.

Expected:

- [ ] Toast "Canvas saved" with the detail that you must push to deliver content for the new canvas. The Push state reads **Changes waiting**.
- [ ] After the push the player draws a **tall frame** inside the browser window (black bars left and right) and the images are fitted to it; the portrait image now fills it.
- [ ] A note on the Canvas tab says changing the canvas does not change what the screen is already showing.
- [ ] **Rotation** offers None, 90° clockwise, Upside down (180°), 90° counter-clockwise. (Optional: set 90° clockwise, save, push: the player turns the picture; set it back and push.)
- [ ] After restoring Landscape and pushing, the player is back to the wide frame and the screen reads **In sync**.

### T10.3 Tags tab

- [ ] Add a screen tag `lobby` (create it from the tag picker, with a colour) and **Save tags**: toast that tags were saved. In the **Screens** list the tag shows and the **Filter by tag** control filters to this screen.

### T10.4 Working hours (the screen goes black outside its hours)

The site time zone is **Australia/Melbourne**. If your computer is in another zone, read the current site time from the player: press `d` and look at *Local time there* under Content.

1. Open the **Working hours** tab. Turn **Always on** off.
2. Untick every day except **today**. Set today's hours so that **now is outside them** (for example, if it is 14:20 there, set 15:00 to 17:00).
3. **Save working hours**, then push to this screen.
4. Wait up to about a minute.

Expected:

- [ ] When Always on is turned off, the hours group proposes Monday to Friday 09:00 to 17:00 and says "Times are in Australia/Melbourne. Outside these hours the screen shows black."
- [ ] Set an end earlier than its start and Save: "End must be after start." Untick all days and Save: "Choose at least one day, or turn on Always on." Fix both.
- [ ] Toast "Working hours saved"; Push state **Changes waiting**; after the push the player goes **black** (no text on it) at the next item boundary.
- [ ] The screen's status pill reads **Standing by** with the explanation "Has the latest push; nothing in it is due to show right now." The Dashboard counts it under **In sync**.
- [ ] Now change the hours so that **now is inside them**, Save, push: the player resumes playing within about a minute and the pill returns to **In sync**.
- [ ] Turn **Always on** back on, Save, and push once more.

### T10.5 The More menu and status refresh

- [ ] The screen page's **More** menu (next to Push to this screen) offers **Refresh status**, **Pair a different player** and **Revoke player**.

---

## 11. Schedules

A schedule plays different playlists at different times and a default playlist the rest of the time. Times follow the site's time zone (Australia/Melbourne; see T10.4 for how to read it). Images and apps change **on the minute**; a video finishes first.

### T11.1 Create a schedule

Open **Schedules**.

- [ ] "No schedules yet" with the explanation of what a schedule is and a **Create schedule** button.
- [ ] Press **Create schedule**. Leave the default playlist on "Choose a playlist" and submit: "Choose a default playlist." Name it `Weekday schedule`, choose **Default playlist** `Main loop`, create: toast "Schedule created" and the editor opens.
- [ ] The editor shows a **Default playlist** card with an **Open playlist** link, an **Events** card that reads "No events yet. The default playlist plays all the time." and three paragraphs of help (events are checked from the top; times follow the site time zone; screens need player 0.4.0 or later).

### T11.2 Validation of an event

Press **Add event**, then **Save** without filling anything in.

- [ ] An error summary appears with one entry per problem, for example "Event 1: Choose a playlist." and "Event 1: Enter a start and an end time." Clicking an entry moves focus to that field.
- [ ] Set Start `10:00` and End `10:00`: "Start and end must differ. For the whole day, set both to 00:00."
- [ ] Set Start `00:00` and End `00:00`: a hint "The whole day." appears.
- [ ] Set Start `22:00` and End `06:00`: the hint "Ends the next day." appears (overnight events are allowed).
- [ ] Untick all seven days: "Choose at least one day."

### T11.3 An event that starts in two minutes

Read the current site time (player diagnostics, *Local time there*). Call the next whole minute plus one **M** (for example at 14:20:40, M = 14:22).

1. In Event 1 choose **Playlist** `Lunch specials`, tick today only, Start `M`, End `M + 3 minutes`.
2. **Save**.
3. Open **Screens → Reception TV**, open the **Change** menu in the Content card, choose **Choose a schedule…**, pick `Weekday schedule`, **Assign schedule**.
4. Push to this screen.

Expected:

- [ ] Toast "Schedule saved" with the detail "Screens that use it show Changes waiting until you push."
- [ ] The schedule picker's description says screens need player 0.4.0 or later to play a schedule's events. Toast "Weekday schedule assigned".
- [ ] The Content card now shows caption Schedule, `Weekday schedule`, "Default playlist: Main loop" and an **Open schedule** link. The preview caption says this is the default playlist of the schedule and events may show other playlists.
- [ ] Before M: the player keeps playing `Main loop` (default). Player diagnostics *Schedule picks* reads "default playlist".
- [ ] At M (within a minute, at the next item boundary): the player switches to `Lunch specials` (the Welcome text app, then the portrait image). *Schedule picks* reads "playlist 1 of 2" or similar.
- [ ] At M + 3: the player returns to `Main loop`.
- [ ] Overview tab: *Active item* carries the note "With a schedule, items are counted across all of its playlists, default playlist first."
- [ ] The Screens list's Content column reads "Schedule: Weekday schedule". The push dialog row shows a calendar icon and "Schedule: Weekday schedule".

### T11.4 Delete guards with a schedule

- [ ] **Playlists**, row menu of `Lunch specials` → Delete, confirm: refused with "Used by the schedule Weekday schedule." and a **Go to Schedules** button.
- [ ] **Schedules**, row menu of `Weekday schedule` → Delete, confirm: refused with "This schedule is assigned to a screen" naming `Reception TV`.
- [ ] Row menu of `Main loop` (the default playlist) → Delete, confirm: refused as well (used by the schedule).

### T11.5 Assigning a playlist over a schedule says so

**Screens** list, row menu of `Reception TV` → **Assign content**.

- [ ] The dialog says "A screen that has a schedule or a layout gets this playlist instead." and offers no **No playlist** option (content is removed on the screen's page instead). Cancel.

Leave the schedule assigned for now; section 12 replaces it.

---

## 12. Layouts

A layout splits a screen into a **main zone** and a **band** along the bottom, each with its own playlist. Screens need player 0.5.0 (the player you are running).

### T12.1 Create a layout

Open **Layouts**.

- [ ] "No layouts yet" with the explanation and **Create layout**.
- [ ] Press **Create layout**. Submit with nothing chosen: "Enter a name.", "Choose a playlist for the main zone.", "Choose a playlist for the band."
- [ ] Name `Lobby with ticker`, **Main zone playlist** `Main loop`, **Band playlist** `Ticker band` (the hint recommends a Ticker or Text app for the band). Create: toast "Layout created"; the editor opens.

### T12.2 The editor and preview

- [ ] The **Zones** card shows **Band height (%)** at 15 with the hint about the content area, then two fieldsets **Main zone** and **Band**, each with a Playlist select and an **Open playlist** link.
- [ ] The **Preview** card draws two outlined boxes on a landscape frame, labelled "Main zone: Main loop" and "Band: Ticker band". **Preview on** switches to Portrait and to `Reception TV`.
- [ ] Set Band height to `4`: the preview says "Enter a band height from 5 to 50 to see the zones." Press **Save**: the field shows "Enter a whole number from 5 to 50." and nothing is saved. Set `25`: the band grows in the preview. Set it back to `15`.
- [ ] Set Band height to `30` and **Save**: toast "Layout saved" with the detail "Screens that use it show Changes waiting until you push."

### T12.3 Assign and push the layout

Open **Screens → Reception TV**, **Change → Choose a layout…**, pick `Lobby with ticker`, **Assign layout**, then push.

Expected:

- [ ] The picker's description says screens need player 0.5.0 or later to show a layout. Toast "Lobby with ticker assigned".
- [ ] The Content card shows caption Layout, `Lobby with ticker`, "Main zone: Main loop" and an **Open layout** link. The preview caption says "This is the main zone of the layout…".
- [ ] After the push the player shows **two zones**: `Main loop` playing in the top 70 % and the **ticker scrolling** in a band along the bottom 30 %. The ticker text is sized to the band. No blank moment at the switch.
- [ ] Overview tab: *Active item* carries the note "With a layout, this is the item in the main zone; other zones are not reported."
- [ ] The Screens list reads "Layout: Lobby with ticker"; the push dialog row says "Layout: Lobby with ticker".

### T12.4 Change the layout, push again

- [ ] In the layout editor set Band height to `15`, Save. The screen's Push state reads **Changes waiting**. Push: the band shrinks on the player within a minute.

### T12.5 A zone that is too small is blocked

1. **Screens → Add screen**: name `Tiny strip`, preset custom Width `200`, Height `100`, Create screen. Skip pairing (**Skip for now**), **Skip and finish**.
2. On the `Tiny strip` screen page assign the layout `Lobby with ticker` (band 15 % of 100 px = 15 px, under the 16 px minimum).
3. Open **Layouts → Lobby with ticker** and set **Preview on** to `Tiny strip`.
4. Open **Screens** and press **Push to screens** in the header (editor pages such as the layout editor have no header push button).

Expected:

- [ ] The layout preview shows a warning: "On Tiny strip…, the band is 200 × 15 px. A zone needs at least 16 px each way, so screens of this shape cannot show this layout. Make it larger."
- [ ] In the push dialog `Tiny strip` sits in the **Blocked** group with an issue that names the zone size and the 16 px minimum, and an **Open layout** link. It cannot be ticked. `Reception TV` is **Up to date**.
- [ ] On the `Tiny strip` screen page, **Push state** reads **Blocked** with the same issue.
- [ ] Remove the layout from `Tiny strip`: **Change → Remove content**, toast "Content removed". Push state: **Nothing assigned**.

### T12.6 Delete guards with a layout

- [ ] **Playlists**, row menu of `Ticker band` → Delete, confirm: refused with "Used by the layout Lobby with ticker." and a **Go to Layouts** button.
- [ ] **Layouts**, row menu of `Lobby with ticker` → Delete, confirm: refused with "This layout is assigned to a screen" naming `Reception TV`.

---

## 13. Push dialog: groups, blocked and bulk

### T13.1 A blocked screen

1. On `Tiny strip`, assign the playlist `Empty playlist` (Content card → **Assign playlist**).
2. Open **Push to screens** from the header.

Expected:

- [ ] `Tiny strip` is in **Blocked** with the issue "The playlist has no items. Add at least one image or video." and an **Open playlist** link. The group note says each screen keeps the version it has.
- [ ] `Reception TV` is in **Up to date**. With nothing to push, a banner at the top says "Nothing can be pushed right now" and "1 screen is blocked. Fix the assigned content, then push.", and the dialog's only button is **Close**. Close the dialog.
- [ ] Dashboard: **Changes waiting** says "No changes can be pushed" and a line "1 screen is blocked…". The **Needs attention** card is calm (a blocked push is not a player error).

### T13.2 Nothing assigned

- [ ] On `Tiny strip` choose **Change → Remove content**. In the push dialog it moves to **Nothing assigned** with an **Open screen** link, and the group note says to assign a playlist, a schedule or a layout first.

### T13.3 Bulk assign from the list

1. **Screens** list: tick both screens, in the selection bar press **Assign content**, choose `Lunch specials`, **Assign to 2 screens**.
2. Open **Push to screens**.

Expected:

- [ ] The dialog says every chosen screen gets this playlist, and (because `Reception TV` has a layout) "A screen that has a schedule or a layout gets this playlist instead." Toast "Lunch specials assigned to 2 screens".
- [ ] Both screens are in **Changes waiting** and ticked; **Select all** is offered. `Tiny strip` has no player, so pushing to it is allowed (a push hands content to the screen; the player collects it when paired). Press **Push to 2 screens**: "Pushed to 2 screens".
- [ ] The player switches to `Lunch specials` (full frame, no band). `Reception TV` reads In sync; `Tiny strip` reads **Waiting for player** or **Not paired** in the status column and **Up to date** in push state.
- [ ] Put `Reception TV` back on the layout `Lobby with ticker` (Content card → Change → Choose a layout…) and push, so the player shows the two zones again.

---

## 14. Network loss and recovery (player keeps playing)

Do this in the **player's** browser window. Do not reload the player while offline (see Known limitations).

1. Open the browser's developer tools (F12 or Cmd-Option-I), **Network** panel, and set the throttling drop-down to **Offline**.
2. Watch the player for 90 seconds, and watch the screen page in the portal.
3. Set the drop-down back to **No throttling** (online). Close developer tools.

Expected:

- [ ] The player **keeps playing** both zones with no blank moment for the whole 90 seconds.
- [ ] Player diagnostics (`d`): *Failures in a row* counts up and *Recent problems* lists a network error (`network_error`). *Network* shows what the browser itself reports; with DevTools throttling it may still read "browser reports online". Nothing is drawn over the content.
- [ ] Portal, after about 60 seconds: the status pill becomes **Not reporting** with a **STALE** badge and the explanation that the last report may no longer be true. The Dashboard counts it under **Needs attention**.
- [ ] Within about 30 seconds of going back online the pill returns to **In sync** and the Overview's *Last report received* is fresh again.

---

## 15. Revoke, reset and pair again

### T15.1 Revoke from the portal

On `Reception TV`, **Pairing** tab.

- [ ] The tab shows **Paired** with "A player has held a credential since …" and a **Revoke** section whose note says revoking cannot erase content already cached on a device that does not report.
- [ ] Press **Revoke player**, read the dialog "Revoke this player?" and confirm **Revoke player**: a banner says the player credential was revoked and content it already cached stays on the device until it is reset there.
- [ ] Player, within about 15 seconds: the content disappears and the player shows "This player was unregistered", 'The server no longer accepts this player for "Reception TV".', and a **Reset this player** button.
- [ ] Portal: the pill is **Not paired**; the Pairing tab now shows **Not paired** and a **Pair a player** form. The **Pending pairing** section explains cancelling a code accepted by mistake.
- [ ] **Audit log** (account menu): the newest events include "Player revoked on screen" with the screen named.

### T15.2 Reset the player and pair again

1. On the player press **Reset this player**.
2. It reloads and shows a new pairing code. Enter it on the Pairing tab, **Pair player**.

Expected:

- [ ] The player shows a **new** code (different from before).
- [ ] After pairing it may show "Reception TV" and "Waiting for content" briefly (often too short to see), then downloads and plays the layout again (the last push is still assigned; the media is downloaded again because the reset cleared the cache).
- [ ] The portal returns to **In sync** within about a minute.

### T15.3 Local reset from diagnostics (two-step)

- [ ] On the playing player press `d`. At the bottom, **Reset this player…** changes on the first click to **Confirm: remove registration and cached content**; the second click resets. The player shows a new code; the portal shows **Not paired** within about 15 seconds, and the audit log records "Player unpaired itself from screen".
- [ ] Pair it again (Pairing tab → the new code → Pair player) and confirm it plays.

---

## 16. Second organisation: isolation

Sign out (account menu → **Sign out**). In the second terminal:

```bash
npm run otp -- --second --show-password
```

Sign in as `second-operator` with that password and code.

Expected:

- [ ] The header shows **Isolation Test Organisation**. Dashboard: Get set up at 0 of 4; Screens "No screens yet"; Library 0 files, 0 playlists; **Recent activity** shows only this sign-in. Media, Apps, Playlists, Schedules, Layouts and Screens are all empty.
- [ ] Paste the address of `Reception TV` from the first organisation (copy it from your browser history, it looks like `http://localhost:5173/screens/<id>`): the page says **Screen not found** / "This screen could not be loaded", that it is not one of this organisation's screens.
- [ ] Do the same with a playlist address (`/playlists/<id>`) and a media address (`/media/<id>`): "Playlist not found" and "File not found".
- [ ] **Settings** shows the organisation name read-only, with the note that it cannot be changed here. There is no organisation switcher anywhere.
- [ ] Sign out, sign back in as `operator`, and confirm everything from the first organisation is still there.

---

## 17. Settings, tags and the audit log

### T17.1 Settings

Open **Settings**.

- [ ] Groups **Organisation** (name, read-only), **Content** (Media tags "1 tag", Screen tags "1 tag", Folders "1 folder", which opens the media library; the folders themselves, `Campaign B` with its file count, are listed at the bottom of the Media tags page), **Security** (Audit log; Sign-in and MFA "Identity provider") and **Planned** (Users and roles, Working hours, Alerts, API tokens), each Planned row saying which stage it is planned for.

### T17.2 Tags page

Open **Media tags**.

- [ ] Two tabs **Media tags** and **Screen tags** with counts. `hero` is listed with its colour and "Used on 1 file"; **Screen tags** lists `lobby` "Used on 1 screen".
- [ ] **New tag** → name `promo`, choose a colour, **Create tag**: toast 'Media tag "promo" created'. Create it again with the same name: "Another media tag already has this name."
- [ ] Row menu of `promo` → **Rename** to `promotion`: toast "Tag renamed". **Change colour**: toast "Tag colour changed".
- [ ] Row menu of `promotion` → **Delete**: the dialog says how many files lose the tag (0) and that it cannot be undone; confirm; toast 'Tag "promotion" deleted'.
- [ ] Row menu of `hero` → **Show files**: the media library opens filtered to that tag.

### T17.3 Audit log

Open the account menu → **Audit log**.

- [ ] The intro says records cannot be edited or deleted through the application. Columns: Time, Action, Result, Actor, Object, Detail. Newest first.
- [ ] The log contains, in plain words, the journey you did: "Operator signed in", "Screen added", "Pairing code accepted for screen", "Player paired with screen", "Media uploaded", "Media checked and ready", "Playlist created", "Pushed to screen", "Schedule created", "Layout created", "Player revoked on screen", "Player unpaired itself from screen". Actors read **Operator** or **Player software**.
- [ ] **Category → Pushes to screens** leaves only pushes. **Result → Refused** shows the wrong pairing code from T8.2 (under Pairing). The deletes refused in T6.6, T11.4 and T12.6 are not listed: a request that changes nothing writes no audit event.
- [ ] Open a row's **Detail**: a dialog with Time, Exact time (UTC), Action, Result, Actor, Object and the recorded detail as text; no password, token or URL appears in any detail.
- [ ] **Load older events** at the bottom ends with "This is the first recorded event."

---

## 18. Layout and keyboard checks (portal)

### T18.1 Narrow window and dark mode

- [ ] Make the portal window narrow (under 900 px wide, or use the browser's device toolbar at 390 px): the sidebar becomes a drawer behind an **Open navigation** button; pages (Screens, Media, the schedule editor) show no sideways scrolling; the event rows and zone fieldsets stack.
- [ ] Switch your operating system (or browser) to dark mode: the portal follows, text stays readable, and the status pills keep their meaning.

### T18.2 Keyboard only

With the mouse put aside, on the **Schedules** list:

- [ ] Tab reaches **Create schedule**; Enter opens the dialog; Tab moves through Name, Default playlist and the buttons; Escape closes it.
- [ ] In the Screens list, the row menu opens with Enter and its items move with the arrow keys.
- [ ] A **Skip to content** link appears as the first Tab stop on a page.

---

## 19. Shut down

- [ ] In the first terminal press Ctrl+C: the api, portal and player stop. The containers keep running; `npm run infra:down` stops them (data is kept).
- [ ] To start again later: `npm run dev` only.
- [ ] To wipe everything and start from an empty organisation: `npm run reset -- --yes`, then `npm run setup -- --quiet`, `npm run infra:up`, `npm run db:migrate`, `npm run db:seed -- --second-org`. The player keeps its own storage: use its local reset (`d`, then Reset this player twice) or clear the site data of http://localhost:5174.

---

## 20. Results

### Summary

| Section | Ticked | Of | Notes |
|---|---|---|---|
| 1 Start | | 7 | |
| 2 Sign in | | 5 | |
| 3 Dashboard empty | | 6 | |
| 4 Media | | 30 | |
| 5 Apps | | 11 | |
| 6 Playlists | | 19 | |
| 7 Add screen | | 9 | |
| 8 Pair | | 12 | |
| 9 Push and play | | 18 | |
| 10 Screen settings | | 16 | |
| 11 Schedules | | 20 | |
| 12 Layouts | | 19 | |
| 13 Push dialog | | 8 | |
| 14 Network loss | | 4 | |
| 15 Revoke and reset | | 10 | |
| 16 Second organisation | | 5 | |
| 17 Settings, tags, audit | | 11 | |
| 18 Layout and keyboard | | 5 | |
| 19 Shut down | | 3 | |

Tester: ______________________  Date: ____________  Browser and version: ______________________  OS: ______________________

### Issue log

One row per issue. Attach screenshots (never of the sign-in page or of terminal output that shows a password or code).

| # | Test ref | What you did | What happened | What the plan expected | Severity |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |

### Not covered by this plan

- Real hardware (a Pi-class player on an LED controller), long soaks over hours or days, and browser storage eviction.
- Uploads near the 200 MB limit and the 5 GB organisation quota.
- Fifty events in one schedule, 200 items in a playlist, more than 200 screens in one push.
- Daylight-saving edges and overnight events crossing midnight on a real clock.
- Screen readers (automated accessibility checks run in the test suite; a listening pass is a separate task).
