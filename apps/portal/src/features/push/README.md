# Push to screens

The one place the portal pushes from (docs/portal-v2/stage-a.md, section 3.9; decision P2-05: assign, then push). In code the object is a `display`, as in the API; everything an operator sees says "screen".

| File | What it is |
|---|---|
| `PushContext.tsx` | `PushProvider` (rendered once by `AppShell`), `usePush()`, the types `PushContextValue` and `PushRequest` |
| `PushDialog.tsx` | The dialog. Only `PushProvider` renders it |
| `push.css` | Its styles, classes `tx-push-*`, tokens only |
| `../../lib/pushDialog.ts` | The pure logic, with `pushDialog.test.ts` beside it |

## For other pages: `usePush()`

```ts
import { usePush } from '../push/PushContext.tsx';

const { plan, planError, pendingCount, refresh, openDialog } = usePush();
```

| Member | Type | Meaning |
|---|---|---|
| `plan` | `PushPlanResponse \| null` | The answer of `GET /api/push`: one row per screen (`display`, `playlist`, `schedule`, `layout`, `state`, `issues`, `lastPushedAt`) and `pendingCount`. For a screen with a schedule, `schedule` is its `{ id, name }` and `playlist` is the schedule's **default playlist**; for a screen with a layout, `layout` is its `{ id, name }` and `playlist` is the layout's **main zone** playlist. So a page that looks for "the screens of this playlist" must require `planRowContent(row)?.kind === 'playlist'` (`lib/assignedContent.ts`; used by `rowsForPlaylist` in `lib/playlistEditor.ts` and `assignPushView` in `lib/playlistsListActions.ts`). `null` until the first answer. Read it from here instead of calling `api.getPushPlan` yourself, so every page shows the same thing; the object keeps its identity while the answer is unchanged |
| `planError` | `unknown` | Why the latest read failed, or `null`. `plan` is then the last good answer |
| `pendingCount` | `number \| null` | Screens with changes waiting (never pushed counts). `null` while not known |
| `refresh()` | `() => void` | Reads the plan again now; does nothing while the dialog is open (the dialog reads the plan itself). Call it after any save that can change what is waiting: a playlist or a schedule saved, content assigned or removed, a screen's canvas changed, media deleted |
| `openDialog(request?)` | `(request?: PushRequest) => void` | Opens the dialog. Does nothing without `push.publish`: the dialog never opens for a role that cannot push |
| `openPush`, `refreshPending` | | The same two functions under their earlier names; the header button uses `openPush` |

```ts
interface PushRequest {
  only?: readonly string[]; // show only these screens (display ids); the operator can press "Show all screens"
  preselect?: readonly string[]; // tick exactly these, where they have changes waiting
  displayIds?: readonly string[]; // earlier name of preselect
}
```

```tsx
openDialog(); // every screen; all with changes waiting are ticked
openDialog({ only: [display.id] }); // "Push to this screen"
openDialog({ only: screensOfThisPlaylist.map((d) => d.id) }); // "Push now" in the playlist editor
openDialog({ preselect: selectedIds }); // the whole list, with only the chosen screens ticked
```

Only screens with changes waiting can be ticked, by a caller or by the operator. A screen that is blocked, up to date or has nothing assigned is listed with the reason and cannot be pushed to.

The words for a push state come from one place, `lib/screenStatusPush.ts` (`presentPushState`), drawn by the shared `PushStatePill` everywhere, the dialog's rows included: Changes waiting, Not pushed yet, Up to date (neutral), Blocked, Nothing assigned. `presentPushState` in `lib/pushDialog.ts` returns the same label and tone.

## How it behaves

- Roles (stage C): the dialog opens only with `push.publish`. The plan poll (`GET /api/push`) runs for every role and feeds the waiting count. Without `push.publish` the header shows a chip "N screens waiting" (`push-waiting`) that links to the dashboard, instead of the "Push to screens" button; on a phone the chip shows only the clock and the number. If the key is lost while the dialog is open, it stays open until the person closes it, so its refusal shows; it drops its push button then. A push refused part-way by a role change is titled "Your role changed during the push": screens pushed before the change keep their new version, the others were not pushed, and there is no retry.
- The plan is read when the shell mounts, every 30 seconds while the tab is visible, when the tab becomes visible after a longer pause, and on `refresh()`. While the dialog is open the timer rests: the dialog reads a fresh plan when it opens and after every push, so rows do not move under the operator's hands.
- Each row names what the screen has assigned: the playlist's name (with a visually hidden "Playlist: " before it), or a calendar icon and the visible text "Schedule: {name}" for a screen with a schedule, a layout icon and "Layout: {name}" for a screen with a layout, or "Nothing assigned". Search matches the screen, the playlist, the schedule's and the layout's name. A blocked row links to what must be fixed: "Open playlist", "Open schedule" (`/schedules/:id`) or "Open layout" (`/layouts/:id`, issue paths `zones[n]`, `zones[n].playlist`, `zones[n].items[k]`, `layout`), for a scheduled screen whose issue paths name the place in the schedule (`default.playlist`, `default.items[n]`, `events[n].playlist`, `events[n].items[n]`, `schedule`) and whose messages name the playlist ("In playlist “Lunch”: …").
- The group texts and result lines say "the assigned content", "content assigned", "assign a playlist, a schedule or a layout" and "nothing is assigned", never "the assigned playlist": a group can hold screens of both kinds.
- Groups, in this order: Changes waiting (ticked by default, with "Select all"), Blocked (each issue's message and code), Up to date, Nothing assigned. A refreshed plan never ticks a screen the operator did not tick; it only drops ticks from screens that can no longer be pushed to.
- One Idempotency-Key (a `crypto.randomUUID()`) per opening. It is repeated only while the outcome of the last request is unknown: no answer, the 60 second limit, an unreadable answer, a server fault, throttling, or 409 `conflict` (the API stopped part of the way through and says a repeat with the same key carries on). After any definite answer, success or refusal, the next push in the same opening gets a new key. The key is repeated only for the same intent (`keyForPush`, `isRetryOf` in `lib/pushDialog.ts`): the push button reads "Retry push" and sends the old key only while every ticked screen is one the unknown attempt sent without an answer. Unticking some keeps the retry; ticking any other screen makes it a new push with a new key, so a screen the unknown attempt published is never answered with that earlier publication after its playlist changed.
- More than 200 ticked screens are sent in batches of 200 with the same key; the API holds the key per screen.
- After the call each row shows what the API answered for it (Pushed, Already up to date, Rejected with the issues, Skipped), a summary states the counts, and the plan is read again. A request that failed as a whole is shown with its message and API error code. Nothing is reported as pushed unless the API said so, and the copy says what a push is: a new version handed to the player; the screen changes when its player has downloaded and verified it.

## Test ids

`push-dialog-body`, `push-search`, `push-count`, `push-show-all-screens`, `push-refresh`, `push-loading`, `push-empty`, `push-idle`, `push-group-waiting`, `push-group-blocked`, `push-group-up-to-date`, `push-group-nothing-assigned`, `push-select-all`, `push-show-all`, `push-row-<displayId>` (with `data-state` = the plan state and `data-outcome` = the answer of this opening's push, when there is one), `push-row-check-<displayId>`, `push-row-status` (holds `push-row-state`, the shared pill with `data-state`, until the row is answered), `push-row-issues`, `push-outcome`, `push-summary` (with `data-tone`), `push-error`, `push-selected-count`, `push-cancel`, `push-submit`, `push-done`.

The dialog itself is `getByRole('dialog', { name: 'Push to screens' })`. With nothing ticked its primary button is also named "Push to screens", like the header button: scope the header one with `getByRole('banner')`.
