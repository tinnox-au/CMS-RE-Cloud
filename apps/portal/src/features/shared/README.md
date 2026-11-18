# Shared feature parts

Parts that several portal v2 pages need: tags, folders, media thumbnails, playlist mosaics, picker dialogs and status pills. They are built from the component kit (`src/ui/`) and the API client (`src/api/`), and hold no page of their own.

```tsx
import {
  FolderSelect, MediaThumb, MoveToFolderDialog, PlaylistMosaic, PlaylistPickerDialog,
  PushStatePill, SchedulePickerDialog, ScreenPickerDialog, ScreenStatusPill, TagChips,
  TagFilter, TagPicker, TagsDialog, useFolders, useNow, useTags,
  type FoldersResource, type TagsResource, type TagsDialogItem, type MoveToFolderItem,
} from '../shared/index.ts';
```

Styles are in `shared.css` in this folder (class prefix `tx-shared-`); every component imports it itself. Pure logic is in `src/lib/` with unit tests beside it (see the last section).

## Rules

- **One list per page.** Call `useTags(scope)` and `useFolders()` once in the page component and pass the result (`tags`, `folders`) to every shared component on that page. Each call is its own request and its own copy of the list.
- **Who saves.** `TagPicker` and `FolderSelect` are form controls: they change a draft and the page saves it. `TagsDialog` and `MoveToFolderDialog` save by themselves (one `PATCH` per changed item), report with a toast, and tell the page through `onSaved` / `onMoved`. `PlaylistPickerDialog`, `SchedulePickerDialog` and `ScreenPickerDialog` only return a choice: the page does the work, passes `busy` while it runs and `error` if it fails, and closes the dialog.
- **Dialogs stay mounted.** Render a dialog always and toggle `open` (the kit's rule). Each opening starts fresh. `items` are read when the dialog opens.
- The two saving dialogs call `useToast()`, so they need the `ToastProvider` of `AppShell` above them (every page has it).
- Nothing here is a `<form>`, and Enter inside these parts never submits a form around them, so they are safe inside a page's own form.
- Wording: an operator sees "screen", never "display"; a screen's status uses only In sync, Standing by, Updating, Not reporting, Error, Waiting for player, Nothing pushed, Not paired, with the time of the last report.

---

## useTags(scope)

```ts
function useTags(scope: 'media' | 'display'): TagsResource;

interface TagsResource {
  scope: TagScope;
  status: 'loading' | 'error' | 'ready'; // 'error' only when the first load failed
  tags: readonly TagDto[]; // ordered by name; empty until ready
  byId: ReadonlyMap<string, TagDto>;
  error: unknown; // what the first load threw, while status is 'error'; else null
  refreshError: unknown; // what a later reload threw; `tags` is then the last good list
  reload: () => void; // fetch again, keeping the current list on screen
  createTag: (name: string, colour: TagColour) => Promise<TagDto>;
}
```

```tsx
const tags = useTags('media');
// after a save that changes which items carry which tag (usage counts):
tags.reload();
```

`createTag` resolves with the tag as the API stored it; it is in `tags` from the next render. It rejects with what the API answered (a name already in use is 409 `conflict`) and then reloads the list. Nothing is shown before the server has answered. `TagsDialog` reloads the list itself after a save.

## useFolders()

```ts
function useFolders(): FoldersResource;

interface FoldersResource {
  status: 'loading' | 'error' | 'ready';
  folders: readonly FolderDto[]; // ordered by name; empty until ready
  byId: ReadonlyMap<string, FolderDto>;
  error: unknown;
  refreshError: unknown;
  reload: () => void; // item counts change when media moves
  createFolder: (name: string) => Promise<FolderDto>;
}
```

```tsx
const folders = useFolders();
const place = folderLabel(media.folderId, folders.byId); // lib/folderChoice.ts: "Library root" for null
```

Same guarantees as `useTags`. `MoveToFolderDialog` reloads the list itself after a move.

## TagChips

```ts
interface TagChipsProps {
  tags: TagsResource;
  tagIds: readonly string[]; // tagIds of the media item or the screen
  max?: number; // chips before the rest fold into "+N"; default 2
  size?: 'sm' | 'md'; // 24 px (default, table cells) or 28 px
  label?: string; // accessible name of the list; default "Tags"
  testId?: string; // default 'shared-tag-chips'
  className?: string;
}
```

```tsx
{ id: 'tags', header: 'Tags', width: '220px', priority: 3,
  cell: (media) => <TagChips tags={tags} tagIds={media.tagIds} /> }
```

Read-only, in the tags' colours, in name order. Renders nothing for an item without tags. One tag over `max` is simply drawn (a "+1" chip would take the same room). The "+N" chip lists the hidden names in a tooltip and for assistive technology. While the tag list loads it shows a placeholder; if the list could not be loaded it shows "3 tags".

## TagFilter

```ts
interface TagFilterProps {
  tags: TagsResource;
  selected: ReadonlySet<string>; // tag ids filtered on
  onChange: (selected: ReadonlySet<string>) => void;
  label?: string; // accessible name of the group; default "Filter by tag"
  max?: number; // chips before the rest move into a "More tags" menu; default 6
  testId?: string; // default 'shared-tag-filter'
  className?: string;
  disabled?: boolean; // chips shown but not pressable (the playlist library's Apps chip)
}
```

```tsx
const [tagFilter, setTagFilter] = useState<ReadonlySet<string>>(new Set());

<div className="tx-filter-row__filters">
  <SearchField … />
  <TagFilter tags={tags} selected={tagFilter} onChange={(next) => { setTagFilter(next); setPage(1); }} />
</div>

applyListView(items, { filters: [(row) => matchesTagFilter(row.tagIds, tagFilter)], … });
```

Toggle chips (buttons with `aria-pressed`) in a labelled group. With no tags it renders nothing. A selected tag is always shown as a chip, even past `max`. If the tags cannot be loaded it says so with the API error code and "Try again". After a tag is deleted, drop it from the filter with `pruneSelection` from `lib/selection.ts`.

## TagPicker

```ts
interface TagPickerProps {
  tags: TagsResource; // new tags are created in its scope
  value: readonly string[]; // the chosen tag ids (the form's draft)
  onChange: (tagIds: readonly string[]) => void; // the complete new list; nothing is saved
  label?: string; // accessible name of the group; default "Tags"
  disabled?: boolean;
  collapsible?: boolean; // chips plus an "Add or remove tags" button that opens the list; default false
  testId?: string; // default 'shared-tag-picker'
  className?: string;
  // plus the control props of a kit Field: id, aria-describedby, aria-invalid, aria-required
}
```

```tsx
<Field label="Tags">
  {(control) => <TagPicker {...control} tags={tags} value={draft.tagIds} collapsible
    onChange={(tagIds) => setDraft({ ...draft, tagIds })} />}
</Field>
// then: api.patchMedia(id, { tagIds: [...draft.tagIds] })  or  api.patchDisplay(id, { tagIds: [...] })
```

The chosen tags as removable chips, then a search field over a list with ticks. Keyboard: type to search, Arrow Up and Down move through the list, Enter turns the tag on or off, Escape clears the search (the ARIA combobox pattern; focus stays in the field). When the typed name is not a tag yet, the list offers "Create tag “name”" and a row of eight colour swatches appears (radio buttons named Teal, Sky, Slate, Green, Amber, Red, Violet, Pink; the least used colour is proposed). Enter, the list row or the "Create tag" button creates it and adds it to `value`. A refusal by the server is shown under the list with its message and error code (for example `conflict` when someone took the name a moment ago) and the list is reloaded. A name over 40 characters or with control characters is refused before sending. One item carries at most 50 tags; at the limit the other tags are disabled.

Test ids (with the default `testId`): `shared-tag-picker`, `-chosen`, `-toggle` (collapsible), `-checklist`, `-checklist-search`, `-checklist-list`, `-checklist-create` (the list row), `-checklist-colours`, `-checklist-create-button`. Each option carries `data-tag-id` and `data-state` (`all`, `some`, `none`).

## TagsDialog

```ts
interface TagsDialogItem { id: string; name: string; tagIds: readonly string[] } // a MediaDto or DisplayDto fits

interface TagsDialogProps {
  open: boolean;
  onClose: () => void; // Cancel, Escape, the close button, and after a save that fully succeeded
  items: readonly TagsDialogItem[]; // one or many; read when the dialog opens
  tags: TagsResource; // its scope decides what is saved: 'media' → patchMedia, 'display' → patchDisplay
  onSaved?: (updatedIds: readonly string[]) => void; // per attempt that changed at least one item
  testId?: string; // default 'shared-tags-dialog'
}
```

```tsx
const [tagTarget, setTagTarget] = useState<readonly MediaDto[] | null>(null);

<MenuItem icon={Tags} onSelect={() => setTagTarget([media])}>Edit tags</MenuItem>
<Button variant="ghost" size="sm" icon={Tags} onClick={() => setTagTarget(selectedRows(items, selected))}>Add tags</Button>

<TagsDialog open={tagTarget !== null} onClose={() => setTagTarget(null)}
  items={tagTarget ?? []} tags={tags} onSaved={() => reload()} />
```

The same searchable list as `TagPicker`, with tag creation. One item: its tags are ticked. Several items: a tag on all of them is ticked, a tag on some shows a dash and "Some" and is left as each item has it unless it is pressed (first press: on all; second: off all). "Save tags" sends one `PATCH` per item whose tags actually change, one after another, with "Saving 2 of 5" in the footer; the dialog cannot be dismissed meanwhile. All saved: it calls `onSaved`, closes, and raises the toast "Tags saved for 3 files" (or "… screens", or the item's name). Some failed: it stays open and lists each failed item with the server's message and error code, says what was saved, and offers "Try again" for the failed ones only. It reloads `tags` after every attempt.

Test ids: `shared-tags-dialog`, `-save`, `-retry`, `-checklist…` (as in `TagPicker`).

## FolderSelect

```ts
interface FolderSelectProps {
  folders: FoldersResource;
  value: string | null; // folder id, or null for the root of the library
  onChange: (folderId: string | null) => void; // nothing is saved
  disabled?: boolean;
  allowCreate?: boolean; // the "New folder" button; default true
  testId?: string; // default 'shared-folder-select'
  className?: string;
  // plus the control props of a kit Field, and aria-label for use outside a Field
}
```

```tsx
<Field label="Folder">
  {(control) => <FolderSelect {...control} folders={folders} value={draft.folderId}
    onChange={(folderId) => setDraft({ ...draft, folderId })} />}
</Field>
// then: api.patchMedia(id, { folderId: draft.folderId })
```

The kit's native `Select` with "Library root (no folder)" first, and a "New folder" button that opens a small name field under it. Enter or "Create folder" creates the folder and chooses it; Escape or Cancel closes the field; focus returns to the select. An empty, over-long (80) or already used name is refused at the field; a refusal by the server is shown with its error code. Loading: the select is disabled and reads "Loading folders". Load error: an alert with the code and "Try again".

Test ids: `shared-folder-select`, `-control` (the select), `-new`, `-form`, `-form-name`, `-form-create`.

## MoveToFolderDialog

```ts
interface MoveToFolderItem { id: string; name: string; folderId: string | null } // a MediaDto fits

interface MoveToFolderDialogProps {
  open: boolean;
  onClose: () => void;
  items: readonly MoveToFolderItem[]; // one or many media items; read when the dialog opens
  folders: FoldersResource;
  onMoved?: (movedIds: readonly string[], folderId: string | null) => void; // per attempt that moved at least one
  testId?: string; // default 'shared-move-dialog'
}
```

```tsx
<MoveToFolderDialog open={moveTarget !== null} onClose={() => setMoveTarget(null)}
  items={moveTarget ?? []} folders={folders} onMoved={() => reload()} />
```

A radio list: "Library root" and every folder with its file count, a search field from nine folders up, and "New folder" (the new folder becomes the choice). When all items are in one place the dialog starts on it. "Move here" sends `patchMedia(id, { folderId })` for each item that is not there already, one after another; it is soft-disabled, with a note, when nothing would move. All moved: `onMoved`, close, toast "3 files moved to Promotions". Some failed: the same failure list and "Try again" as `TagsDialog`. It reloads `folders` after every attempt. Enter on a chosen radio confirms.

Test ids: `shared-move-dialog`, `-root`, `-folder` (each folder radio), `-search`, `-new`, `-new-form…`, `-confirm`, `-retry`.

## MediaThumb

```ts
interface MediaThumbProps {
  media: Pick<MediaDto, 'id' | 'kind' | 'status'>;
  size?: 'sm' | 'md' | 'lg' | 'fill'; // 44 px square, 72 px, 128 px, container width (default)
  ratio?: 'wide' | 'square' | 'classic'; // 16:9 (default), 1:1, 4:3; not for sm
  fit?: 'cover' | 'contain'; // default cover
  alt?: string; // leave out when the name is written next to it
  noBadge?: boolean; // hide the kind badge (drawn on lg and fill once loaded)
  className?: string;
}
```

```tsx
<NameCell name={mediaDisplayName(media)} to={`/media/${media.id}`} media={<MediaThumb media={media} size="sm" />} />
<Tile name={…} media={<MediaThumb media={media} />} />
```

The kit's `Thumb`. A ready image is fed from `ROUTES.mediaThumbnail(id)` (`GET /api/media/:id/thumbnail`: the worker's JPEG of at most 480 px, or the original when there is none, for example media uploaded before stage B); a video, or a cell of unknown kind, from `ROUTES.mediaPreview(id)`. `MediaPreview` on the media page stays on `/preview`. Ready image: `<img loading="lazy">`. Ready video: a paused, muted `<video preload="metadata">` that is given its address only once the thumbnail comes near the viewport (a list of videos does not start a request per row), is never played, has no controls and is not focusable. Processing: a working indicator, no request. Failed: a warning mark on the danger tint, no request. Decorative unless `alt` is given. The wrapper carries `data-status` (`ready`, `processing`, `failed`).

## PlaylistMosaic

```ts
interface PlaylistMosaicProps {
  mediaIds: readonly string[]; // PlaylistSummaryDto.previewMediaIds (the first four are used)
  kinds?: readonly PlaylistItemKind[]; // PlaylistSummaryDto.kinds; `app` is ignored (an app has no thumbnail)
  kindOf?: (mediaId: string) => MediaKind | undefined; // where the page knows the kind of each item
  size?: 'sm' | 'md' | 'lg' | 'fill'; // 44 px square, 72 px, 128 px, container width (default); 16:9 but sm
  className?: string;
}
```

```tsx
<NameCell name={playlist.name} to={`/playlists/${playlist.id}`}
  media={<PlaylistMosaic size="sm" mediaIds={playlist.previewMediaIds} kinds={playlist.kinds} />} />
```

One thumbnail fills the tile, two share it side by side, three put the first beside two stacked ones, four make a grid; none (an empty or app-only playlist) shows a playlist placeholder. Decorative (`aria-hidden`). A summary does not say which preview is an image and which a video: when `kinds` holds one kind, every cell is requested as that kind; in a mixed playlist without `kindOf`, a cell is tried as a video first and as an image second (two requests for an image), so pass `kindOf` where the media list is at hand.

## PlaylistPickerDialog

```ts
interface PlaylistPickerDialogProps {
  open: boolean;
  onClose: () => void; // Cancel, Escape, the close button
  onConfirm: (playlist: PlaylistSummaryDto | null) => void; // null = "No playlist", only with allowNone
  title?: string; // default "Choose a playlist"
  description?: ReactNode;
  confirmLabel?: string; // default "Choose playlist"; say what happens: "Assign playlist"
  currentId?: string | null; // chosen when the dialog opens; with allowNone, null starts on "No playlist"
  allowNone?: boolean; // offers "No playlist" first; default false
  noneHint?: string; // second line of "No playlist"
  busy?: boolean; // the caller is saving: not dismissable, button shows it
  error?: unknown; // what the caller's save threw; shown in the dialog with the API error code
  errorTitle?: string; // default "The change was not saved"
  disabledReason?: (playlist: PlaylistSummaryDto) => string | null; // row shown but not choosable, with the reason
  testId?: string; // default 'shared-playlist-picker'
}
```

```tsx
const [assign, setAssign] = useState<{ busy: boolean; error: unknown } | null>(null);

const assignPlaylist = async (playlist: PlaylistSummaryDto | null) => {
  if (playlist === null) return; // null comes only with allowNone, which this dialog does not offer
  setAssign({ busy: true, error: null });
  try {
    // A playlist id also takes a schedule off the screen.
    await api.patchDisplay(display.id, { assignedPlaylistId: playlist.id });
    setAssign(null);
    toast.success('Playlist assigned');
    refreshPending();
  } catch (error) {
    setAssign({ busy: false, error });
  }
};

<PlaylistPickerDialog open={assign !== null} onClose={() => setAssign(null)}
  title="Assign content"
  description={`Nothing changes on the screen until you push.${anyHasOtherContent([display]) ? ` ${CONTENT_REPLACED_NOTE}` : ''}`}
  confirmLabel="Assign playlist" currentId={display.assignedPlaylist?.id ?? null}
  busy={assign?.busy} error={assign?.error} errorTitle="The playlist was not assigned"
  onConfirm={(playlist) => { void assignPlaylist(playlist); }} />
```

Loads `api.listPlaylists()` afresh each time it opens. A search field (name and description) over a radio list; each row shows the mosaic, the name and "3 items · 0:45". Focus starts in the search field; Tab reaches the list, arrows move the choice, Enter confirms. The current choice is scrolled into view. States: skeleton rows, load error with "Try again", "No playlists yet" with a link to Playlists, "No playlist matches" with "Clear search". The footer shows the count ("4 of 34 playlists" while searching).

Test ids: `shared-playlist-picker`, `-search`, `-none`, `-option` (each playlist radio; its `value` is the playlist id), `-confirm`.

Since stage B slice 4 a screen has at most one of a playlist, a schedule or a layout. A non-null `assignedPlaylistId` also takes a schedule or a layout off the screen, so say so in `description` when a target has one: `CONTENT_REPLACED_NOTE` in `lib/assignedContent.ts` ("A screen that has a schedule or a layout gets this playlist instead."), with `anyHasOtherContent(displays)` to decide. `{ assignedPlaylistId: null }` alone leaves a schedule or a layout in place, so do not offer `allowNone` for such a screen (the screens list does not); the screen page removes content with its own "Remove content" item, which sends all three ids as null. `lib/assignedContent.ts` (`assignedContent`, `planRowContent`, `contentHref`, `CONTENT_KIND_LABEL`) is the one place that says what a screen or a push-plan row is about.

## PlaylistSelect, LibraryPickerDialog and LayoutPickerDialog

`PlaylistSelect` (moved here from the schedule editor) is a native select of playlists with an "Open playlist" link beside it; the schedule editor and the layout editor use it. `LibraryPickerDialog<T>` is the body that `SchedulePickerDialog` and `LayoutPickerDialog` share: it takes `load`, `meta`, `searchTexts`, `icon` and a `noun`, and builds its texts from the noun. `LayoutPickerDialog` has the props of `SchedulePickerDialog` with `onConfirm(layout: LayoutDto)`; defaults "Choose a layout", "Choose layout", `shared-layout-picker`; rows show the name and "Main zone: {playlist} · Band 15%".

## SchedulePickerDialog

```ts
interface SchedulePickerDialogProps {
  open: boolean;
  onClose: () => void; // Cancel, Escape, the close button
  onConfirm: (schedule: ScheduleSummaryDto) => void; // there is no "none"
  title?: string; // default "Choose a schedule"
  description?: ReactNode;
  confirmLabel?: string; // default "Choose schedule"; say what happens: "Assign schedule"
  currentId?: string | null; // chosen when the dialog opens
  busy?: boolean; // the caller is saving: not dismissable, button shows it
  error?: unknown; // what the caller's save threw; shown in the dialog with the API error code
  errorTitle?: string; // default "The change was not saved"
  testId?: string; // default 'shared-schedule-picker'
}
```

```tsx
<SchedulePickerDialog open={open} onClose={close}
  title="Assign content" confirmLabel="Assign schedule"
  description={`Choose the schedule for ${display.name}. Nothing changes on the screen until you push. Screens need player 0.4.0 or later to play a schedule's events.`}
  currentId={display.assignedSchedule?.id ?? null}
  busy={busy} error={error} errorTitle="The schedule was not assigned"
  onConfirm={(schedule) => { void api.patchDisplay(display.id, { assignedScheduleId: schedule.id }); }} />
```

A clone of `PlaylistPickerDialog` without the mosaic and without "none": content is removed from a screen on the screen's page. Loads `api.listSchedules()` afresh each time it opens. A search field (name, description and the default playlist's name) over a radio list; each row shows a calendar icon, the name and "Default: Reception loop · 2 events" (`scheduleSummaryLabel` in `lib/schedules.ts`). Keyboard, states and footer as in `PlaylistPickerDialog`: "No schedules yet" links to Schedules, "No schedule matches" offers "Clear search". Assigning a schedule takes a playlist off the screen (the API clears the other side).

Test ids: `shared-schedule-picker`, `-search`, `-option` (each schedule radio; its `value` is the schedule id), `-confirm`.

## ScreenPickerDialog

```ts
interface ScreenPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (displays: readonly DisplayDto[]) => void; // one element when `multiple` is off
  multiple?: boolean; // checkboxes instead of radio buttons; default false
  title?: string; // default "Choose a screen" / "Choose screens"
  description?: ReactNode | ((chosen: readonly DisplayDto[]) => ReactNode); // a function gets the screens chosen now
  confirmLabel?: string | ((count: number) => string); // default "Choose screen" / "Choose 3 screens"
  initialSelectedIds?: readonly string[]; // display ids ticked when the dialog opens
  disabledReason?: (display: DisplayDto) => string | null;
  busy?: boolean;
  error?: unknown;
  errorTitle?: string; // default "The change was not saved"
  testId?: string; // default 'shared-screen-picker'
}
```

```tsx
<ScreenPickerDialog open={open} onClose={close} multiple title="Assign to screens"
  confirmLabel={(count) => (count === 1 ? 'Assign to 1 screen' : `Assign to ${count} screens`)}
  disabledReason={(display) => (display.assignedPlaylist?.id === playlist.id ? 'Already has this playlist' : null)}
  busy={busy} error={error} errorTitle="The playlist was not assigned"
  onConfirm={(displays) => assignTo(displays)} />
```

Loads `api.listDisplays()` and `api.listDisplayStatuses()` afresh each time it opens. Each row: the screen's name, "Assigned: Reception loop", "Assigned: schedule Weekdays" (a screen with a schedule), "Assigned: layout Lobby split" (a screen with a layout) or "Nothing assigned", and its `ScreenStatusPill` with the time of the last report. Search matches the name, the description and the assigned playlist, schedule or layout. `description` may be a function of the chosen screens, because the picker loads the screens itself and the caller cannot otherwise know what they hold: the two playlist pages use it to add `CONTENT_REPLACED_NOTE` once a ticked screen has a schedule or a layout. With `multiple`: an "All screens" box (or "All screens found" while searching) with the mixed state, and "2 of 33 screens chosen" in the footer; Space toggles a row and Enter does not confirm. Single: Enter on a chosen radio confirms. If only the statuses cannot be read, the screens are still listed and a warning says so with the error code. Other states as in `PlaylistPickerDialog` ("No screens yet" links to Add screen).

Test ids: `shared-screen-picker`, `-search`, `-all`, `-option` (each row's input; its `value` is the display id), `-count`, `-confirm`.

## ScreenStatusPill

```ts
interface ScreenStatusPillProps {
  view: DeliveryStatusView | null | undefined; // api.getDisplayStatus or an item of api.listDisplayStatuses
  fetchedAt?: number; // state.fetchedAt of the useLoad state that delivered `view`
  detail?: 'below' | 'inline' | 'hidden'; // where "Last report 12 seconds ago" goes; default 'below'
  loading?: boolean; // a skeleton instead of "Status not loaded" while `view` is missing
  testId?: string; // default 'shared-screen-status'
  className?: string;
}
```

```tsx
const statuses = useLoad(loadStatuses, 10_000);
const byId = useMemo(() => new Map((statuses.state.status === 'ready' ? statuses.state.data : []).map((v) => [v.displayId, v])), [statuses.state]);

<ScreenStatusPill view={byId.get(display.id)} loading={statuses.state.status === 'loading'}
  fetchedAt={statuses.state.status === 'ready' ? statuses.state.fetchedAt : undefined} />
```

A kit `StatusPill` with an icon, and the time of the last report under it (`below`), beside it (`inline`), or for assistive technology only (`hidden`, where the page already shows that time next to the pill). With `fetchedAt` the age keeps counting once a second, on one shared timer however many pills are showing. The wrapper carries `data-summary` and `data-stale` exactly as the API sent them, plus `data-kind`.

| API summary | Label | Tone |
|---|---|---|
| `in_sync` (paired, not stale) | In sync | ok |
| `standing_by` | Standing by | neutral |
| `updating` | Updating | warn |
| `stale` | Not reporting | warn |
| `error` | Error | danger |
| `awaiting_player` | Waiting for player | warn |
| `nothing_published` | Nothing pushed | neutral |
| `unpaired` | Not paired | neutral |

Guarantees (unit-tested in `lib/screenStatus.test.ts`): the ok tone needs `in_sync`, paired and not stale together; an `in_sync` summary that arrives stale reads "Not reporting", and one that arrives unpaired "Not paired", both in the warn tone; staleness comes only from the API's flag, never from the age of a report; no text contains "online", "offline" or "display". For the M0 status facts of the screen page (desired, downloaded, active, player state, staging, the `STALE` badge) keep using `presentStatus` from `lib/status.ts`; `screenStatus(view, elapsedMs)` gives the pill's `label`, `tone`, `detail` and a screen-worded `explanation` for the headline.

## PushStatePill

```ts
interface PushStatePillProps { state: PushState; testId?: string; className?: string } // testId default 'shared-push-state'
```

```tsx
<PushStatePill state={row.state} />   // row of api.getPushPlan().items
```

| State | Label | Tone |
|---|---|---|
| `nothing_assigned` | Nothing assigned | neutral |
| `never_pushed` | Not pushed yet | warn |
| `changes` | Changes waiting | warn |
| `up_to_date` | Up to date | neutral |
| `blocked` | Blocked | danger |

"Up to date" is neutral on purpose: it compares what is assigned with what was pushed and says nothing about what the player reports, so it does not borrow the tone of "In sync". The wrapper carries `data-state`. `presentPushState(state).detail` is one sentence explaining the state.

## useNow

```ts
function useNow(ticking?: boolean): number; // performance.now() as of the last one-second tick
```

```tsx
const now = useNow();
const status = screenStatus(view, now - state.fetchedAt);
```

One timer for the whole page. Use it instead of `useTick` where many rows show a relative time.

## useRowFocusReturn, rowByTestId, elementByTestId

```ts
interface RowFocusSource {
  mode: 'row' | 'bulk'; // from a row menu, or from the selection bar
  order: readonly string[]; // ids of the rows or tiles on view, in the order shown
  row: (id: string) => Element | null; // the row or tile of an id
  primary: () => HTMLElement | null; // the page's primary add or new button
}
function useRowFocusReturn(open: boolean, deletedIds: readonly string[], source?: RowFocusSource):
  (() => HTMLElement | null) | undefined; // pass to Dialog or ConfirmDialog as returnFocus
function rowByTestId(...prefixes: string[]): (id: string) => Element | null;
function elementByTestId(testId: string): () => HTMLElement | null;
```

```tsx
<DeleteMediaDialog targets={deleteTargets} onClose={close} onDeleted={afterDelete}
  rowFocus={{ mode: deleteMode, order: list.rows.map((m) => m.id),
    row: rowByTestId('media-library-row-', 'media-library-tile-'),
    primary: elementByTestId('media-library-add') }} />
```

For delete dialogs (media, playlists, tags). The order is read when the dialog opens. When the control that opened it has gone, focus goes to the "Actions for …" button of the row after the deleted one, else the row before, else `primary()`; after a bulk delete to the first remaining row's actions button, else the select-all checkbox, else `primary()`. The choice of neighbour is `rowFocusCandidates` in `lib/rowFocus.ts` (unit-tested).

---

## Pure logic (src/lib, unit-tested, no DOM)

| Module | Exports |
|---|---|
| `lib/screenStatus.ts` | `screenStatus(view, elapsedSinceFetchMs)` → `{ kind, tone, label, detail, explanation, summary, stale, reportBadge, lastReportText, lastReportAgeSeconds }`; `SCREEN_STATUS_KINDS`, `SCREEN_STATUS_LABELS`, `screenStatusKindOf(summary)` (for the counters of `api.getOverview().displays.bySummary`), `screenStatusTone(kind)`, `screenStatusGroup(kind)` → `'in_sync' \| 'pending' \| 'attention' \| 'not_paired'` (`in_sync`: in sync, standing by; `pending`: updating, waiting for player, nothing pushed; `attention`: error, not reporting); types `ScreenStatus`, `ScreenStatusKind`, `ScreenStatusTone`, `ScreenStatusGroup` |
| `lib/screenStatusPush.ts` | `presentPushState(state)` → `{ state, tone, label, detail }`, `PUSH_STATE_PRESENTATIONS`, type `PushStatePresentation` |
| `lib/tagColours.ts` | `TAG_COLOUR_LABELS`, `tagColourLabel`, `suggestTagColour(tags)`, `sortTags`, `tagsById`, `resolveTags(tagIds, byId)`, `summariseTags(tags, max)`, `searchTags(tags, query)`, `findTagByName(tags, name)`, `tagNameProblem(name)` (message or null), `matchesTagFilter(itemTagIds, selected, mode = 'any')`, `tagCoverage`, `tagStateWithChanges`, `toggleTagChange`, `applyTagChanges`, `NO_TAG_CHANGES`, `MAX_TAGS_PER_ITEM`; types `TagSummary`, `TagCoverage`, `TagChanges` |
| `lib/folderChoice.ts` | `LIBRARY_ROOT_LABEL`, `sortFolders`, `folderLabel(folderId, byId)`, `findFolderByName`, `folderNameProblem(name, existing?)`, `searchFolders`, `itemsToMove(items, targetFolderId)` |
| `lib/mediaName.ts` | `mediaDisplayName(media)`, `mediaIsRenamed(media)`, `mediaKindLabel(kind)` ("Image"), `mediaKindPluralLabel(kind)` ("Images"), `mediaKindsLabel(kinds)` ("Images and videos"), `formatDimensions(width, height)` ("1920 × 1080 px" or null), `formatClock(ms)` ("1:05"), `mediaDetailsLabel(media)` ("1280 × 720 px · 0:12" or null), `mediaSizeLabel(media)` ("2.4 MB" or null), `presentMediaStatus(status)` → `{ tone, label }` (Ready, Processing, Failed), `playlistItemCountLabel(n)`, `playlistLengthLabel(totalDurationMs)`, `playlistSummaryLabel(playlist)` ("3 items · 0:45") |
| `lib/bulkOutcome.ts` | `runInSequence(items, action, onProgress?)` → `{ done, failed }` (one at a time, carries on after a failure), `mergeBulkOutcomes`, `countOf(n, 'file')`, `bulkFailureTitle(failed, total, singular, verb)`; types `BulkOutcome`, `BulkSuccess`, `BulkFailure` |

`formatBytes`, `formatDurationMs`, `formatAge` and `formatTimestamp` stay in `lib/format.ts`.

## Internal parts (not exported from index.ts)

`TagChecklist` (the list behind `TagPicker` and `TagsDialog`), `NewFolderForm`, `PickRow` and `PickRowSkeletons` (the rows of the picker lists), `BulkFailures` (the failure list), `PreviewThumb` (in `MediaThumb.tsx`), `useLoadWhileOpen` (loads for a dialog, afresh per opening), `useNearViewport`, `useSettledFocus`. Import them by file path only if a page needs the same behaviour; prefer the exported parts.
