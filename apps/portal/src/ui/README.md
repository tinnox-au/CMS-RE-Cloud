# Portal v2 component kit

The components of `docs/portal-v2/design-system.md`. One file per component in this folder, styles in `src/styles/` (class prefix `tx-`), pure logic in `src/lib/`. The live gallery is `/styleguide` in a development build (no sign-in needed; it is absent from production builds).

```tsx
import { Button, DataTable, Dialog, useToast } from '../../ui/index.ts';
import { Plus, Trash } from '../../ui/icons.ts';
```

## Rules that apply to every component

- Import components from `ui/index.ts` and icons from `ui/icons.ts`, nowhere else. To use a new lucide icon, add its export to `ui/icons.ts` first.
- Colour comes only from the tokens in `styles/tokens.css`. Never write a hex value in a page or a component. `styles/tokens.test.ts` checks the token pairs for WCAG 2.2 AA in both themes; add a pair there when a new combination is introduced. Filled controls use `--accent` with `--on-accent` text; links, text buttons and active icons use `--link`; focus uses `--focus`. Never use `--ink-3` for text that must be read, and never set `--link` text on `--surface-3` (in dark it reaches 3.8:1, enough for an icon, not for text).
- Content-Security-Policy: no `style="..."` in markup and no `dangerouslySetInnerHTML`. For a value that is truly dynamic use React's `style` prop with `cssVars({ '--tx-name': value })` and read the variable in CSS.
- Props are `readonly`. Text is Australian English, sentence case. Everything an operator sees says "screen" (P2-03): "Screens", "Add screen", "Push to screens", paths under `/screens`. Code, API paths and contracts keep the name `display`. Screen status wording follows P2-04: say what the player software last reported; the portal has no word for a screen being reachable.
- Components that render links (`ButtonLink` with `to`, `MenuItem` with `to`, `NameCell`, `Tile`, `BackLink`, `Breadcrumb`) need a router above them.
- A soft-disabled control (`aria-disabled="true"` on `Button`, `IconButton`, a tab) stays focusable and ignores presses. Use it instead of `disabled` when the reason must be readable (wrap it in a `Tooltip` with `describe`) or when disabling would throw keyboard focus away.

## Layout and text classes

Plain class names for arranging components (`styles/layout.css`, `styles/base.css`).

| Class | Use |
|---|---|
| `tx-stack`, `tx-stack--tight`, `tx-stack--loose` | Vertical rhythm: one shrinkable column with 16, 8 or 24 px gaps |
| `tx-cluster`, `tx-cluster--end`, `tx-cluster--between` | A wrapping row of buttons, chips or facts |
| `tx-filter-row` > `tx-filter-row__filters` + `tx-filter-row__end` | List page row 1: search and filter chips on the left, the create button at the far end |
| `tx-toolbar` > `tx-toolbar__count` + `tx-toolbar__end` | List page row 2: the count on the left, view controls on the right |
| `tx-editor` | Editor page: narrow details column and wide settings column from 1100 px |
| `tx-display`, `tx-h1`, `tx-h2`, `tx-h3`, `tx-body`, `tx-small`, `tx-caption` | The type styles. `h1` to `h3` elements already carry theirs |
| `tx-strong`, `tx-muted`, `tx-mono`, `tx-num` | Weight 600, `--ink-2`, monospace, tabular numbers |
| `tx-truncate`, `tx-break`, `tx-nowrap` | Ellipsis on one line, break anywhere, no wrapping |
| `tx-code` | An API error code or other literal inside a sentence: ink on `--fill`, no border; it stays whole (wraps as a unit, ellipsis only when wider than the line) |
| `tx-glass` | The translucent fill of the sticky page header (the sidebar is flat on the page) |
| `tx-visually-hidden`, `tx-skip-link` | Assistive-technology-only text; the skip link (first in the tab order, `href="#main"`). Hidden text is absolutely positioned: any element of your own that scrolls sideways (`overflow-x: auto`, a filmstrip) needs `position: relative`, or hidden text inside it is placed against the page and makes the whole page scroll sideways. The kit's own scrollers already have it |

Tokens worth knowing: space `--s-1` to `--s-9` (4 to 56 px), radii `--r-xs` `--r-sm` `--r-md` `--r-lg` `--r-pill`, control heights `--h-sm` `--h-md` `--h-lg` (32, 36, 44), `--header-h` (72), `--sidebar-w` (240), `--sidebar-w-collapsed` (72), `--gutter` (32, or 16 under 900 px), `--content-max` (1440), motion `--t-fast` `--t` `--t-slow` with `--ease` (all zero under reduced motion), stacking `--z-sticky` `--z-drawer` `--z-float` `--z-toast`.

---

## Button, ButtonLink

```ts
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
type ButtonSize = 'sm' | 'md' | 'lg'; // 32, 40, 44 px

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant; // default 'secondary'
  size?: ButtonSize; // default 'md'
  icon?: IconComponent; // leading
  trailingIcon?: IconComponent;
  block?: boolean; // full width
  busy?: boolean; // spinner, same width, presses ignored, keeps focus
  type?: 'button' | 'submit' | 'reset'; // default 'button'
  ref?: Ref<HTMLButtonElement>;
}

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?; size?; icon?; trailingIcon?; block?; // as Button
  to?: string; // in-app route (router Link)
  href?: string; // full-page navigation, for example the sign-in address
}
```

```tsx
<Button variant="primary" icon={Plus} onClick={openDialog}>Add media</Button>
<Button variant="primary" type="submit" busy={saving}>Save changes</Button>
<Button variant="danger" onClick={askDelete}>Delete</Button>
<ButtonLink variant="primary" size="lg" to="/screens/new" icon={Plus}>Add screen</ButtonLink>
```

Look (restyle 2026-11): every kind is a borderless pill. `primary` is the `--accent` fill with white text at 600; `secondary` is a translucent `--fill` with ink text at 500; `ghost` is the text button, transparent with `--link` text; `danger` is the destructive button, a `--danger-bg` tint with `--danger` text; disabled is one look for all kinds (`--fill-disabled`, `--ink-3` text).

Accessibility: one `primary` per view. `danger` is a red tint, not a filled red; `danger-solid` belongs to the confirming button of a destructive `ConfirmDialog` and nowhere else. `busy` sets `aria-busy` and `aria-disabled`, so focus is not lost while a save runs. A `Badge` may sit inside the label (`<Badge count={3} variant="inverse" label="3 changes waiting" />` on a primary button).

## IconButton

```ts
interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children' | 'aria-label'> {
  icon: IconComponent;
  label: string; // accessible name and tooltip text
  size?: 'sm' | 'md' | 'lg'; // 28, 36, 44 px circles
  variant?: 'ghost' | 'secondary' | 'primary' | 'danger'; // default 'ghost'
  tooltip?: boolean; // default true
  tooltipPlacement?: Placement; // default 'top'
  ref?: Ref<HTMLButtonElement>;
}
```

```tsx
<IconButton icon={RefreshCw} label="Refresh" onClick={reload} />
<IconButton icon={Copy} label="Copy ID" size="sm" onClick={copy} />
```

Look (restyle 2026-11): round and borderless. The default is transparent with a `--ink-2` icon and a `--fill` circle on hover; `secondary` sits on `--fill`; `sm` is 32 px.

Accessibility: `label` is required and should name the object in a row ("Actions for Foyer loop"). The tooltip repeats the name for sighted users; it is suppressed while the button's menu is open.

## SplitButton

```ts
interface SplitButtonProps {
  children: ReactNode; // label of the main action
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  menuLabel: string; // name of the chevron segment: "More save actions"
  menu: ReactNode; // MenuItem elements
  variant?: 'primary' | 'secondary'; // default 'primary'
  size?: ButtonSize;
  icon?: IconComponent;
  busy?: boolean;
  disabled?: boolean; // both segments
  type?: 'button' | 'submit';
  className?: string;
}
```

```tsx
<SplitButton onClick={save} busy={saving} menuLabel="More save actions"
  menu={<MenuItem icon={ListPlus} onSelect={saveAndAdd}>Save and add to playlist</MenuItem>}>
  Save
</SplitButton>
```

Look (restyle 2026-11): two pill halves with a 2 px seam and 6 px inner corners.

Accessibility: two buttons in a `role="group"`; the chevron follows the menu-button pattern (see Menu).

## Menu, MenuItem, MenuSeparator, MenuLabel, MenuHeader

```ts
interface MenuProps {
  trigger: (props: MenuTriggerProps) => ReactNode; // spread props on a Button or IconButton
  children: ReactNode;
  label?: string; // only when the menu's name should differ from the trigger's
  placement?: Placement; // default 'bottom-start'
  onOpenChange?: (open: boolean) => void;
}

interface MenuItemProps {
  children: ReactNode;
  icon?: IconComponent;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect?: () => void; // runs after the menu closed and focus is back on the trigger
  to?: string; // makes the item a router link
  hint?: string; // short text at the end of the row
  type?: 'item' | 'radio' | 'checkbox';
  checked?: boolean; // for radio and checkbox items
}

type Placement = 'top' | 'bottom' | 'left' | 'right' | `${'top' | 'bottom' | 'left' | 'right'}-${'start' | 'end'}`;
```

```tsx
<Menu placement="bottom-end"
  trigger={(props) => <IconButton {...props} icon={Ellipsis} label={`Actions for ${item.name}`} />}>
  <MenuItem icon={Eye} to={`/media/${item.id}`}>Open</MenuItem>
  <MenuItem icon={Tags} onSelect={editTags}>Edit tags</MenuItem>
  <MenuSeparator />
  <MenuItem icon={Trash} tone="danger" onSelect={askDelete}>Delete</MenuItem>
</Menu>
```

Accessibility: the ARIA menu-button pattern. Enter, Space or Arrow Down opens on the first item, Arrow Up on the last; inside, arrows wrap and skip disabled items, Home and End jump, letters jump to the next matching item, Enter activates an item, and so does Space (link items included); Escape closes and returns focus to the trigger, Tab closes. A `hint` is read after the label ("Users, Planned"). Destructive items go last, after a `MenuSeparator`. An `onSelect` that opens a `Dialog` works: focus returns to the trigger first, so the dialog restores it there on close. The popover is drawn in the browser's top layer (native Popover API, with a fixed-position fallback), so a menu inside a dialog or a scrolling table is never clipped; it flips and clamps to the viewport (`lib/positioner.ts`). If its trigger is scrolled off the screen the menu closes and focus returns to the trigger without scrolling back. `MenuHeader` and `MenuLabel` are not focusable.

Look (restyle 2026-11): a borderless `--surface` card, 14 px radius, `--shadow-2` (which carries a faint white ring in dark). Rows are at least 36 px with an 8 px radius; hover and focus fill `--fill`, pressed `--fill-hover`, keyboard focus adds an inner `--focus` ring. The radio tick is `--link`, a danger item is `--danger` on `--danger-bg`, a disabled item `--ink-3`. Separators are inset `--line` hairlines; `MenuLabel` is 12 px / 600 `--ink-2`.

## Dialog

```ts
interface DialogProps {
  open: boolean;
  testId?: string; // data-testid of the <dialog> element, so a test scopes body and footer together
  onClose: () => void; // close button, Escape, backdrop press; the parent sets `open`
  title: string;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg'; // 480, 640, 880 px; a bottom sheet under 560 px
  children: ReactNode; // scrolling body, mounted only while open
  footer?: ReactNode; // buttons, secondary first, primary last
  footerStart?: ReactNode; // a note at the far left of the footer
  busy?: boolean; // cannot be dismissed while true
  flush?: boolean; // no body padding
  className?: string;
  returnFocus?: () => HTMLElement | null; // focus target when the opener has gone (see below)
}
```

```tsx
<Dialog open={open} onClose={close} title="New playlist" description="Give it a name."
  footer={<>
    <Button onClick={close}>Cancel</Button>
    <Button variant="primary" busy={creating} onClick={create}>Create playlist</Button>
  </>}>
  <Field label="Name">{(control) => <TextInput {...control} value={name} onChange={onName} />}</Field>
</Dialog>
```

Accessibility: a native `<dialog>` opened with `showModal()`, so it has the dialog role, the page behind is inert and Tab stays inside. It is labelled by its title. Focus on open goes to the element marked `data-autofocus`, else the first control in the body, else the first footer button; on close it returns to the element that opened it. When that element has gone, at once or when the list is read again a moment later (a deleted row's "Actions" button, a selection bar that empties), focus goes to `returnFocus()` if given, else to the page's `main` landmark, never to `<body>` (`focusReturn.ts`; it never takes focus from a control the person chose, and stops at the first pointer press). A list that deletes rows should pass `returnFocus` that finds the next row's "Actions" button, else the previous row's, else the page's primary action. Keep the component mounted and toggle `open`; do not render it conditionally, or the exit transition and the focus return are lost.

Look (restyle 2026-11): a borderless `--surface` card with a 24 px radius and `--shadow-3` over the `--scrim` backdrop; the title is the card title (21 px / 600). The footer has no rule while the body fits; when the body scrolls, a `--line` hairline appears above the footer (scroll-driven, so browsers without scroll timelines show none). Footer buttons are the standard pills. Under 560 px the dialog is a sheet on the bottom edge with only its top corners rounded, and its footer buttons share the width.

## ConfirmDialog

```ts
interface ConfirmDialogProps {
  open: boolean;
  title: string; // a question naming the action: "Delete this file?"
  children: ReactNode; // names the object and the consequence
  confirmLabel: string; // "Delete file", "Revoke player"
  cancelLabel?: string; // default 'Cancel'
  tone?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string; // on the dialog; the buttons get `<testId>-cancel` and `<testId>-confirm`
  returnFocus?: () => HTMLElement | null; // passed to Dialog
}
```

```tsx
<ConfirmDialog open={target !== null} title="Delete this file?" confirmLabel="Delete file"
  tone="danger" busy={deleting} onConfirm={doDelete} onCancel={() => setTarget(null)}>
  <p><strong>{target?.name}</strong> will be removed from the library.</p>
</ConfirmDialog>
```

Accessibility: `getByRole('dialog')` finds it. Focus starts on Cancel, so Enter never confirms by accident. Show a server refusal inside the dialog body or in a `Banner` on the page, as text.

## Toast: ToastProvider, useToast

```ts
interface ToastApi {
  success(message: string, options?: ToastOptions): string; // returns the toast id
  info(message: string, options?: ToastOptions): string;
  warn(message: string, options?: ToastOptions): string;
  error(message: string, options?: ToastOptions): string; // stays until dismissed
  show(tone: 'ok' | 'info' | 'warn' | 'danger', message: string, options?: ToastOptions): string;
  dismiss(id: string): void;
}
interface ToastOptions {
  detail?: string; // second line, for example an API error code
  action?: { label: string; onAction: () => void };
  durationMs?: number | null; // default 5000; null keeps it; errors default to null
}
```

```tsx
// once, around the application
<ToastProvider><AppShell /></ToastProvider>

const toast = useToast();
toast.success('Playlist saved');
toast.error('The file was not deleted', { detail: 'media_in_use' });
```

Accessibility: announced through two always-present live regions (polite; assertive for errors). The words are written about 150 ms after the toast is raised, so `close(); toast.success(...)` in one handler is announced once the dialog has stopped making the page inert, and the same message twice in a row is announced twice. At most three show: when a fourth arrives, the oldest toast that would have left by itself goes, and an error goes only when all three showing are errors. Hovering or focusing the stack pauses the timers. The stack is last in the tab order, so never make a toast action the only way to do something. Dismissing a toast from the keyboard moves focus to the next toast, or back to where it was before it entered the stack. While a modal dialog stays open, everything outside it is inert, the toast stack and its live regions included: a toast is then drawn above the dialog but cannot be pressed or heard, so report inside an open dialog with a `Banner` (`live`) in the dialog, and keep toasts for after it closes. Report only what happened: no toast before the server has answered.

Look (restyle 2026-11): a borderless `--surface` capsule (24 px radius, at least 48 px tall) with `--shadow-2`; the tone shows as the icon colour (`--ok`, `--warn`, `--danger`, or `--ink-2` for information). The detail line is 13 px `--ink-2`.

## Field, FieldGroup, FormSection

```ts
interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | undefined; // its presence marks the control invalid
  optional?: boolean; // shows "Optional"
  required?: boolean; // aria-required
  children: (control: FieldControlProps) => ReactNode;
  className?: string;
}
interface FieldControlProps { id: string; 'aria-describedby': string | undefined; 'aria-invalid': true | undefined; 'aria-required': true | undefined; }

interface FieldGroupProps { legend: string; hint?: ReactNode; error?: string | undefined; children: ReactNode; className?: string; }
interface FormSectionProps { title: string; description?: ReactNode; layout?: 'stack' | 'rows'; children: ReactNode; }
```

```tsx
<form noValidate onSubmit={submit}>
  <FormSection title="Details" layout="rows">
    <Field label="Name" error={errors.name} required>
      {(control) => <TextInput {...control} value={name} onChange={onName} />}
    </Field>
    <FieldGroup legend="Canvas">
      <Field label="Width (px)" error={errors.width}>{(c) => <TextInput {...c} numeric inputMode="numeric" width="sm" />}</Field>
      <Field label="Height (px)" error={errors.height}>{(c) => <TextInput {...c} numeric inputMode="numeric" width="sm" />}</Field>
    </FieldGroup>
  </FormSection>
</form>
```

Accessibility: the label is tied to the control by `for`; hint and error by `aria-describedby`; an error sets `aria-invalid` and is shown with an icon, not by colour alone. `layout="rows"` puts labels in a 200 px column from 900 px wide; a `FieldGroup` keeps its inner labels above. Summarise several errors in a `Banner tone="danger"` at the top of the form with links that focus the fields. For a control that is not a single input (a `Segmented`), put `control.id` on a wrapper and give the control its own `label`.

## TextInput, Textarea, Select

```ts
interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  mono?: boolean; // pairing codes, ids, hashes
  numeric?: boolean; // tabular digits; keep type="text" and set inputMode
  prefix?: string; suffix?: string; // a fixed unit inside the field: "px", "s"
  width?: 'xs' | 'sm' | 'md' | 'lg' | 'full'; // 96, 160, 320, 480 px, or the container
  ref?: Ref<HTMLInputElement>;
}
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { ref?: Ref<HTMLTextAreaElement>; } // rows default 3
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md'; // sm: 32 px, content width, for toolbars
  width?: ControlWidth;
  ref?: Ref<HTMLSelectElement>;
}
```

```tsx
<Field label="Site">{(control) => (
  <Select {...control} width="md" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
    {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
  </Select>
)}</Field>
```

Look (restyle 2026-11): white fields, 44 px tall with a 12 px radius and a 1 px `--line-control` boundary (darker than the mockups' #d2d2d7, so it reaches 3:1). Focus turns the border `--focus` and thickens it to a 2 px edge (`inset 0 0 0 1px var(--focus)`) inside a 4 px `--focus-halo`, for inputs, selects, input groups, steppers and the search field; invalid is a 2 px `--danger` edge, and focus on an invalid field adds the standard ring. Labels are 13 px at 500. A small `Select` (`size="sm"`, per page) is a 32 px pop-up button on `--surface` with the same 1 px `--line-control` boundary (it has no placeholder, so its edge identifies it).

Accessibility: always inside a `Field` (or give an `aria-label`). `Select` is the native element, so the platform's own picker is used. Read-only inputs get a tinted fill; disabled ones cannot be focused.

## SearchField

```ts
interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'aria-label'> {
  value: string;
  onChange: (value: string) => void;
  label: string; // accessible name and default placeholder: "Search media"
  className?: string;
}
```

```tsx
<SearchField label="Search media" value={query} onChange={(next) => { setQuery(next); setPage(1); }} />
```

Look (restyle 2026-11): filled with `--surface-3`, 40 px, a 12 px radius and no border until it has focus. At most 320 px wide; under 640 px it fills its row. The clear disc is `--ink-2` (`--ink` on hover) so it keeps 3:1 on the field. The fill has no 3:1 boundary by design (accepted deviation, design-system.md section 5): the magnifier, the placeholder and the accessible name identify it.

Accessibility: filters as the person types; Escape clears a non-empty query (and only then reaches a surrounding dialog); the clear button is named "Clear search". Announce the result count next to it (`aria-live="polite"` on the toolbar count).

## Switch

```ts
interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role' | 'checked' | 'onChange' | 'children'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode; // without one, pass aria-label
  hint?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}
```

```tsx
<Switch checked={shuffle} onChange={setShuffle} label="Shuffle" hint="Play the items in a new order each loop." />
```

Look (restyle 2026-11): an iOS switch, a 44 by 27 px track with a white 23 px thumb; on is `--ok` green, off is `--line-control` grey.

Accessibility: a real checkbox with `role="switch"` (the 44 by 27 px track is the target); Space toggles. Use it for a setting that takes effect at once; use `Checkbox` when a Save button applies the choice.

## Checkbox

```ts
interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange' | 'children'> {
  checked: boolean;
  mixed?: boolean; // the dash: some, not all
  onChange: (checked: boolean, event: ChangeEvent<HTMLInputElement>) => void;
  label?: ReactNode; // without one, pass aria-label ("Select Foyer loop")
  hint?: ReactNode;
}
```

```tsx
<Checkbox checked={all} mixed={some && !all} label="All tags" onChange={() => setPicked(toggleAll(ids, picked))} />
```

Look (restyle 2026-11): a 5 px radius and a 1 px `--line-control` border; ticked or mixed is the `--accent` fill.

Accessibility: an 18 px box in a 24 px target. `mixed` sets the DOM `indeterminate` property, which is read as "mixed".

## Stepper

```ts
interface StepperProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step' | 'size'> {
  value: string; // the text as typed; the page parses and validates it
  onChange: (value: string) => void;
  min: number; max: number; step?: number; // step default 1
  unit?: string; // shown after the number: "s"
  stepLabel: string; // names the buttons: "duration" gives "Decrease duration"
}
```

```tsx
<Field label="Seconds on screen" error={error}>
  {(control) => <Stepper {...control} value={seconds} onChange={setSeconds} min={1} max={3600} unit="s" stepLabel="seconds on screen" />}
</Field>
```

Look (restyle 2026-11): drawn like a TextInput (44 px, 12 px radius, the same focus) with round 32 px minus and plus buttons.

Accessibility: a text input with `role="spinbutton"` and the value attributes. Arrow Up and Down step by one, Page Up and Page Down by ten. At a bound the minus or plus button is soft-disabled (`aria-disabled`), so stepping to the limit never drops keyboard focus. Typing is never rewritten; parse with `parseStepperValue` from `lib/stepper.ts` (or the page's own validator, for example `parseImageDuration`).

## Segmented

```ts
interface SegmentedProps<T extends string> {
  label: string; // accessible name of the group
  options: readonly { value: T; label: string; icon?: IconComponent; disabled?: boolean }[]; // two to four
  value: T;
  onChange: (value: T) => void;
  iconOnly?: boolean; // labels become names and tooltips
  size?: 'sm' | 'md';
  className?: string;
}
```

```tsx
<Segmented label="View" iconOnly value={view} onChange={setView}
  options={[{ value: 'list', label: 'List', icon: List }, { value: 'grid', label: 'Grid', icon: LayoutGrid }]} />
```

Look (restyle 2026-11): an iOS segmented control. The track is `--surface-3` with a 12 px radius and 3 px padding; the chosen segment slides under the option as a `--surface` piece with a 9 px radius and `--shadow-1`, and its label is weight 600. In dark the segment is lifted with a `--fill-hover` tint over the track. Under 400 px wide the options take the width of their labels and wrap inside the track when even that does not fit; the chosen option then paints its own segment (no slide).

Accessibility: native radio buttons in a `radiogroup`: one tab stop, arrow keys move the choice.

## Tabs, TabPanel

```ts
interface TabItem<T extends string> { id: T; label: string; icon?: IconComponent; disabled?: boolean; disabledReason?: string; note?: string; }
interface TabsProps<T extends string> { id: string; label: string; tabs: readonly TabItem<T>[]; value: T; onChange: (id: T) => void; className?: string; }
interface TabPanelProps { tabs: string; tab: string; children: ReactNode; className?: string; } // `tabs` = the id given to Tabs
```

```tsx
<Tabs id="screen" label="Screen sections" tabs={TABS} value={tab} onChange={setTab} />
<TabPanel tabs="screen" tab={tab}>{tab === 'overview' ? <Overview /> : <Canvas />}</TabPanel>
```

Accessibility: the ARIA tabs pattern with automatic activation: Tab reaches the selected tab, Arrow Left and Right move and select, Home and End jump. A disabled tab stays focusable and reads its `disabledReason` (also shown as a tooltip): "Planned for stage B". Render one `TabPanel`; keep the selected tab in the URL (`?tab=canvas`) where a page is linked to.

## Chip, ChipList

```ts
type TagColour = 'teal' | 'sky' | 'slate' | 'green' | 'amber' | 'red' | 'violet' | 'pink'; // TAG_COLOURS lists them
interface ChipProps {
  children: ReactNode;
  colour?: TagColour; // a tag: shows the colour dot
  icon?: IconComponent;
  size?: 'sm' | 'md'; // 24 px for table cells, 28 px
  onToggle?: (selected: boolean) => void; // makes it a filter (toggle button)
  selected?: boolean;
  onRemove?: () => void; // adds a close button
  removeLabel?: string; // "Remove tag Foyer"
  disabled?: boolean;
  className?: string;
}
```

```tsx
<div className="tx-cluster" role="group" aria-label="Status">
  <Chip selected={status.has('ready')} onToggle={(on) => setStatus(toggle(status, 'ready', on))}>Ready</Chip>
</div>
<ChipList label="Tags">{tags.map((tag) => <li key={tag.id}><Chip colour={tag.colour} onRemove={() => remove(tag.id)} removeLabel={`Remove tag ${tag.name}`}>{tag.name}</Chip></li>)}</ChipList>
```

Look: a borderless capsule, white on the grey page and `--surface-2` inside a card, table, tile, dialog or menu (a surface container sets `--tx-chip-bg`). A tag shows an 8 px colour dot before its name. A filter chip is 32 px with 14 px text; hover lays `--fill` over it; the selected one is filled with `--ink` and its text turns to `--surface` (white in light). Disabled is `--fill-disabled` with `--ink-3`.

Accessibility: a filter chip is a button with `aria-pressed`; selected chips gain a tick as well as a fill. The colour dot is decoration; the name carries the meaning. Group filter chips in a labelled `role="group"`. Put removable chips in a `ChipList`: when a chip is removed, the list moves keyboard focus to the next chip's remove button (or to itself when none is left), so focus is not dropped to the top of the page.

## StatusPill

```ts
interface StatusPillProps { tone: 'ok' | 'warn' | 'danger' | 'neutral'; children: ReactNode; icon?: IconComponent; className?: string; }
```

```tsx
<StatusPill tone="ok">In sync</StatusPill>
<StatusPill tone="warn">Processing</StatusPill>
<StatusPill tone="neutral">Planned</StatusPill>
```

Look: no filled pill. An 8 px dot (or a 14 px icon) and the words in the tone's colour at 13 px, weight 500: `--ok`, `--warn`, `--danger`; neutral is `--ink-2` words with an `--ink-3` dot.

Accessibility: the words are always present; the dot or icon is decoration. Map `lib/status.ts` tones as `good` to `ok`, `bad` to `danger`.

## DataTable, NameCell

```ts
interface DataTableColumn<T> {
  id: string;
  header: string;
  headerHidden?: boolean;
  cell: (row: T) => ReactNode;
  sortable?: boolean; // header becomes a sort button; the page sorts
  align?: 'start' | 'center' | 'end';
  numeric?: boolean; // tabular digits, one line
  nowrap?: boolean;
  grow?: boolean; // takes spare width and truncates: the name column
  width?: string; // CSS width, also the minimum: give it to columns of wrapping content
  priority?: 1 | 2 | 3 | 4; // when the columns do not fit, 4 leaves first, then 3, then 2; 1 stays
}
interface DataTableProps<T> {
  caption: string; // accessible name: "Media"
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[]; // already filtered, sorted and paged
  rowId: (row: T) => string;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  selection?: { selected: ReadonlySet<string>; onChange: (selected: ReadonlySet<string>) => void; rowLabel: (row: T) => string; isSelectable?: (row: T) => boolean };
  rowActions?: (row: T) => ReactNode; // last column: a Menu behind a three-dot IconButton
  loading?: boolean; loadingRows?: number; // skeleton rows while there are none
  empty?: ReactNode; // an EmptyState with variant="inline"
  footer?: ReactNode; // the Pagination
  density?: 'default' | 'compact'; // 64 or 48 px rows
  rowTestId?: (row: T) => string;
  className?: string;
}
interface NameCellProps { name: string; to?: string; media?: ReactNode; meta?: ReactNode; }
```

```tsx
const list = applyListView(items, { search: { query, texts: (m) => [m.name] }, filters, sort, accessors, page, pageSize });

<DataTable caption="Media" rows={list.rows} rowId={(m) => m.id} sort={sort} onSortChange={setSort}
  columns={[
    { id: 'name', header: 'Name', sortable: true, grow: true,
      cell: (m) => <NameCell name={m.name} to={`/media/${m.id}`} media={<Thumb size="sm" kind={m.kind} src={preview(m)} />} /> },
    { id: 'size', header: 'Size', sortable: true, numeric: true, align: 'end', priority: 4, cell: (m) => formatBytes(m.bytes) },
  ]}
  selection={{ selected, onChange: setSelected, rowLabel: (m) => m.name }}
  rowActions={(m) => <RowMenu item={m} />}
  loading={state.status === 'loading'} empty={<EmptyState variant="inline" title="No media yet" />}
  footer={<Pagination info={list.info} onPageChange={setPage} onPageSizeChange={setPageSize} />} />
```

Look: one `--surface` card with a 20 px radius and no outer border; no zebra. The header row is 12 px at weight 600 in `--ink-2` with no fill; rows are separated by `--line`; a hovered or selected row takes `--surface-2`. The name in a `NameCell` is the 15 px / 500 row title.

Accessibility: a real table with a caption and column headers. Sortable headers are buttons and the sorted column carries `aria-sort`. The header checkbox selects the rows on the page and shows the mixed state; Shift-click selects a range. Every control in a row is a native button, link or checkbox in reading order; the row itself is not clickable, the name is the link. When the columns no longer fit, they leave by `priority` (every column of priority 4, then 3, then 2) and return when there is room again; only when the columns that always stay do not fit does the table scroll sideways (the scrolling area then becomes focusable). The fit is measured from the content, not from breakpoints, so give every column that can be missed a priority. The `grow` column keeps at least 240 px; in a table narrower than 480 px the `NameCell` drops its thumbnail and keeps 112 px. Helpers: `applyListView`, `nextSort`, `countLabel`, `PAGE_SIZE_OPTIONS` in `lib/listView.ts`; `pruneSelection`, `selectedRows` in `lib/selection.ts` (call `pruneSelection` after a reload or a delete).

## Pagination

```ts
interface PaginationProps {
  info: PageInfo; // from applyListView or pageInfo
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void; // omit to hide the select
  pageSizeOptions?: readonly number[]; // default 10, 25, 50, 100
  label?: string; // default 'Pagination'
  className?: string;
}
```

```tsx
<Pagination info={list.info} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
```

Accessibility: a `nav` landmark; the range ("1 to 10 of 42") is announced politely when it changes. On the first and last page the previous or next button is soft-disabled (`aria-disabled`) and keeps focus. `pageInfo` clamps the page, so a page number that no longer exists is safe to pass.

## SelectionBar

```ts
interface SelectionBarProps { count: number; onClear: () => void; children?: ReactNode; label?: string; }
```

```tsx
<SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
  <Button variant="ghost" size="sm" icon={FolderInput} onClick={move}>Move to folder</Button>
  <Button variant="danger" size="sm" icon={Trash} onClick={askDelete}>Delete</Button>
</SelectionBar>
```

Accessibility: renders nothing at zero. Floats at the bottom centre; the count is announced politely. Render it right after the list so Tab reaches it next. Toasts move up while it is showing.

## Card, CardHeader

```ts
interface CardProps extends HTMLAttributes<HTMLElement> { as?: 'div' | 'section' | 'article' | 'aside'; flush?: boolean; }
interface CardHeaderProps { title: string; level?: 2 | 3 | 4; size?: 'caption' | 'title'; description?: ReactNode; actions?: ReactNode; id?: string; }
```

```tsx
<Card as="section" aria-labelledby="library-title">
  <CardHeader id="library-title" title="Library" actions={<Button variant="ghost" size="sm">View all</Button>} />
  <Meter label="Storage" value={used} max={limit} valueText={`${formatBytes(used)} of ${formatBytes(limit)} used`} />
</Card>
```

Accessibility: `CardHeader` renders a real heading (default `h2`) in the caption style (13 px / 600, `--ink-2`); `size="title"` is the 21 px / 600 card title. Pick `level` so the page outline stays in order. Cards are white (`--surface`) with a 20 px radius, no border and no shadow.

## EmptyState

```ts
interface EmptyStateProps { title: string; children?: ReactNode; icon?: IconComponent; action?: ReactNode; variant?: 'page' | 'inline'; level?: 2 | 3; className?: string; }
```

```tsx
<EmptyState icon={Monitor} title="No screens yet" action={<ButtonLink variant="primary" size="lg" to="/screens/new" icon={Plus}>Add screen</ButtonLink>}>
  Add a screen, pair its player, and assign a playlist to it.
</EmptyState>
```

Look: the icon sits in a `--fill` circle in `--link`; the page title is 28 px / 700, the inline title 17 px / 600.

Accessibility: one sentence and at most one action. A Planned page is an `EmptyState` with no action. Use `variant="inline"` inside a card or as a table's `empty`; offer "Clear filters" when a search or filter hides everything.

## Thumb

```ts
interface ThumbProps {
  src?: string | null; // missing shows the placeholder
  kind?: 'image' | 'video'; // badge and placeholder; video is tried as <video> first, then as an image
  size?: 'sm' | 'md' | 'lg' | 'fill'; // 44 px square, 72 px, 128 px, container width
  ratio?: 'wide' | 'square' | 'classic'; // 16:9, 1:1, 4:3 (not for sm)
  fit?: 'cover' | 'contain';
  alt?: string; // leave empty when the name is written next to it
  noBadge?: boolean;
  className?: string;
}
```

```tsx
<Thumb size="sm" kind={media.kind} src={media.status === 'ready' ? ROUTES.mediaPreview(media.id) : null} />
// Pages use MediaThumb (features/shared), which asks ROUTES.mediaThumbnail(id) for images.
```

Look: a 12 px radius (10 px for the 44 px `sm` square) on `--neutral-bg`; the kind badge is a small round capsule.

Accessibility: decorative by default (`alt=""`). The box keeps its size while loading (shimmer) and when the picture is missing or fails (icon). Request a preview only for ready media.

## Tile, TileGrid, TileSkeleton

```ts
interface TileGridProps { label: string; children: ReactNode; minTileWidth?: number; className?: string; } // default 220 px
interface TileProps {
  name: string; to?: string;
  media: ReactNode; // a Thumb or a canvas-shaped preview
  meta?: ReactNode; actions?: ReactNode;
  selection?: { selected: boolean; onChange: (selected: boolean) => void; label: string };
  testId?: string;
}
```

```tsx
<TileGrid label="Media">
  {list.rows.map((m) => (
    <Tile key={m.id} name={m.name} to={`/media/${m.id}`} media={<Thumb kind={m.kind} src={preview(m)} />}
      meta={formatBytes(m.bytes)} actions={<RowMenu item={m} />}
      selection={{ selected: selected.has(m.id), label: m.name, onChange: () => setSelected(toggleOne(selected, m.id)) }} />
  ))}
</TileGrid>
```

Look: white, 20 px radius, no border, no shadow, 10 px padding; the name is 14 px / 500. Hover is a faint fill, never a lift; a ticked tile has a 2 px `--accent` ring inside its edge.

Accessibility: a list of items; the name is the link. The checkbox shows on hover and focus, stays once ticked, and is always shown on touch devices. While loading, render `TileSkeleton` items in the grid inside a `SkeletonGroup`.

## Skeleton, SkeletonGroup

```ts
interface SkeletonProps { width?: string; height?: string; variant?: 'text' | 'block' | 'circle' | 'pill'; className?: string; }
// SkeletonGroup: { label?: string; children: ReactNode; className?: string }  (label default 'Loading')
```

```tsx
<SkeletonGroup label="Loading dashboard" className="tx-stack">
  <Skeleton width="40%" height="20px" />
  <Skeleton variant="block" height="120px" />
</SkeletonGroup>
```

Accessibility: skeletons are hidden from assistive technology; the group says "Loading" once as a status. Whole pages and lists load as skeletons, never behind a full-page spinner. `DataTable` draws its own with `loading`.

## Banner

```ts
interface BannerProps {
  tone?: 'info' | 'ok' | 'warn' | 'danger'; // default 'info'
  title?: string;
  children?: ReactNode; // text, a paragraph or a short list
  actions?: ReactNode; // one or two small buttons
  onDismiss?: () => void;
  live?: 'off' | 'polite' | 'assertive'; // role status or alert when it appears
  icon?: IconComponent;
  ref?: Ref<HTMLDivElement>; tabIndex?: number; className?: string;
}
```

```tsx
<Banner tone="danger" live="assertive" title="The media library could not be loaded"
  actions={<Button size="sm" icon={RefreshCw} onClick={reload}>Try again</Button>}>
  {message} <span className="tx-code">{error.code}</span>
</Banner>
```

Look: a tinted block with a 14 px radius and no stripe or border. `info` is `--fill` (it shows on the page and in a card), the others are `--ok-bg`, `--warn-bg` and `--danger-bg` with the icon in the tone's colour.

Accessibility: replaces the M0 `Notice` and is the base for the restyled `ErrorNotice`. `live="assertive"` gives `role="alert"` (the end-to-end tests look for it on errors); `polite` gives `role="status"`. Tone is carried by the icon and the words as well as the tint. Show API error codes as text.

## ErrorNotice

```ts
interface ErrorNoticeProps {
  error: unknown; // what was thrown; an API error shows its message, code, details and request reference
  title?: string; // what did not happen: "The playlist could not be loaded"
  onRetry?: () => void; // adds "Try again"
  onDismiss?: () => void; // adds a close button
  className?: string;
}
```

```tsx
{state.status === 'error' && (
  <ErrorNotice error={state.error} title="The playlists could not be loaded" onRetry={reload} />
)}
```

Accessibility: a `Banner tone="danger" live="assertive"`, so it has `role="alert"`. The portal v2 form of the M0 `ErrorNotice`, with the same content: the message, the API error code as text, the field details and the request reference. Nothing is rendered as HTML.

## Tooltip

```ts
interface TooltipProps {
  content: string;
  children: ReactElement; // exactly one control
  placement?: Placement; // default 'top'
  describe?: boolean; // also expose the text as the control's description
  disabled?: boolean;
}
```

```tsx
<Tooltip content="Push is held while there are unsaved changes" describe>
  <Button variant="primary" aria-disabled={dirty}>Push now</Button>
</Tooltip>
```

Accessibility: shows on hover and on keyboard focus after 400 ms; Escape, a press, or its control leaving the screen dismisses it; the pointer can move onto it. Never the only place a label exists: set `describe` when the text adds information, leave it off when it repeats the name (as `IconButton` does). Not shown for touch.

Look (restyle 2026-11): inverted, `--ink` fill with `--surface` text at 13 px / 500, 12 px radius, `--shadow-2`.

## Spinner

```ts
interface SpinnerProps { size?: 'md' | 'lg'; label?: string; labelHidden?: boolean; className?: string; }
```

```tsx
<Spinner label="Uploading" />
```

Accessibility: with a `label` it is a status and the text is shown (or hidden with `labelHidden`); without one it is decoration. Under reduced motion it pulses instead of turning.

## Avatar, Badge, Kbd

```ts
interface AvatarProps { name: string; size?: 'sm' | 'md' | 'lg'; labelled?: boolean; className?: string; } // 28, 36, 44 px
interface BadgeProps { count: number; max?: number; label?: string; variant?: 'brand' | 'inverse' | 'neutral' | 'danger'; showZero?: boolean; className?: string; }
// Kbd: { children: ReactNode }
```

```tsx
<Avatar name={session.user.displayName} />
<Badge count={pending} variant="inverse" label={`${pending} changes waiting`} />
<Kbd>Esc</Kbd>
```

Look: `brand` (default) is `--accent` with `--on-accent`; `neutral` is the quiet capsule (`--ink-2` on the opaque `--surface-3`, which keeps 4.5:1 on a card, the page and an inset alike); `danger` is `--danger` with `--on-danger`.

Accessibility: the avatar is decorative unless `labelled`. A badge renders nothing at zero; give `label` unless nearby text already says the number. `inverse` is for a badge on an accent-filled button.

## BackLink, Breadcrumb

```ts
interface BackLinkProps { to: string; children: ReactNode; className?: string; }
interface BreadcrumbProps { items: readonly { label: string; to?: string }[]; className?: string; } // the last item is the current page
```

```tsx
<BackLink to="/playlists">All playlists</BackLink>
<Breadcrumb items={[{ label: 'Settings', to: '/settings' }, { label: 'Tags' }]} />
```

Accessibility: `Breadcrumb` is a `nav` named "Breadcrumb" with `aria-current="page"` on the last item.

Look (restyle 2026-11): `BackLink` is a 14 px `--link` link with a leading chevron, as in the mockups ("‹ Playlists"), `--link-hover` on hover and no fill. `Breadcrumb` links are `--link`; the current page is `--ink` at weight 500; separators are `--ink-3` chevrons.

## Meter

```ts
interface MeterProps { label: string; value: number; max: number; valueText: string; variant?: 'stacked' | 'inline'; note?: ReactNode; className?: string; }
```

```tsx
<Meter variant="inline" label="Storage" value={storage.usedBytes} max={storage.limitBytes}
  valueText={`${formatBytes(storage.usedBytes)} of ${formatBytes(storage.limitBytes)}`} />
```

Look: a 6 px `--neutral-bg` track with an `--accent` fill (`--warn` and `--danger` near the limit).

Accessibility: `role="meter"` with the reading as `aria-valuetext`; the same reading is always visible. The bar turns to the attention colour from 80 per cent and to the danger colour from 95 per cent (`lib/meter.ts`).

## Facts, Fact

```ts
interface FactsProps { children: ReactNode; stacked?: boolean; className?: string; }
interface FactProps { label: string; children: ReactNode; testId?: string; } // testId lands on the value
```

```tsx
<Facts>
  <Fact label="Desired" testId="status-desired">{desired}</Fact>
  <Fact label="Last report" testId="status-last-report">{lastReport}</Fact>
</Facts>
```

Accessibility: a definition list. `testId` keeps the M0 `status-*` hooks on the values.

## Icon and icons.ts

```ts
interface IconProps { icon: IconComponent; size?: number; label?: string; className?: string; } // size default 20
```

```tsx
import { Monitor } from '../../ui/icons.ts';
<Icon icon={Monitor} />            // decorative
<Icon icon={Monitor} size={16} label="Screen" />
```

Icons are lucide-react (ISC), re-exported one by one under lucide's own names (`Menu` is exported as `MenuIcon`). `Icon` draws them at 20 px with a 1.75 stroke (2 at 16 px and below). An icon is decorative unless it has a `label`; an icon that acts is an `IconButton`.

## Helpers

- `cx(...parts)`: joins class names, skipping falsy parts.
- `cssVars({ '--tx-name': value })`: typed custom properties for the `style` prop.
- `VisuallyHidden`: text for assistive technology only (for example the object a row button acts on).
- `usePopover` (not exported from `index.ts`): positions a `.tx-popover` wrapper against an anchor; `Menu` and `Tooltip` use it. Build new popovers on it rather than on a new dependency.

## Pure logic in src/lib (unit-tested, no DOM)

| Module | Exports |
|---|---|
| `listView.ts` | `applyListView`, `sortRows`, `nextSort`, `matchesSearch`, `normaliseSearch`, `paginate`, `pageInfo`, `rangeLabel`, `countLabel`, `compareValues`, `PAGE_SIZE_OPTIONS`, `DEFAULT_PAGE_SIZE`, types `SortState`, `SortAccessors`, `PageInfo`, `ListViewResult` |
| `selection.ts` | `toggleOne`, `toggleAll`, `setMany`, `selectRange`, `summariseSelection`, `pruneSelection`, `selectedRows` |
| `positioner.ts` | `computePosition`, `parsePlacement`, types `Placement`, `Side`, `Align` |
| `keyboardNav.ts` | `navActionForKey`, `moveIndex`, `typeaheadMatch`, `isTypeaheadKey` |
| `stepper.ts` | `parseStepperValue`, `stepValue`, `canStep`, `clampToBounds`, `formatStepperValue` |
| `meter.ts` | `meterFraction`, `meterTone`, `meterPercentLabel` |
| `toastQueue.ts` | `pushToast`, `toastDuration`, `DEFAULT_TOAST_DURATION_MS` (used by `Toast`) |
| `initials.ts` | `initials` |
| `contrast.ts` | `contrastRatio`, `parseColour`, `composite`, `readTokenSets`, `resolveToken` (used by `styles/tokens.test.ts`) |

---

## Shell

The application frame lives in `src/shell/`; its styles are `src/styles/shell.css`. `App.tsx` holds the session gate and the route table and should not need to change when a page is rebuilt: a page builder replaces the inside of one feature module (the table at the end of this section) and keeps its path and its named export.

```
AppShell  (route "/", inside the session gate)
  ToastProvider > PushProvider > ShellContext
  skip link (#main)
  Sidebar            wordmark and "Prototype" capsule, nav.ts, Settings, collapse button;
                     a drawer under 900 px
  column
    <Outlet />          the page, which renders Page or EditorPage:
                          header (h1 and subtitle, actions, global controls)
                          main#main (the content)
```

Rules for every page:

- Render exactly one frame, `Page` or `EditorPage`, as the root of the page component. The frame renders the page's only `h1`, the `main#main` landmark and the document title ("Playlists · TINNOX CMS"). Do not render another `h1`, `main` or skip link.
- The frame must be below `AppShell` (it reads the session, the shell state and `PushContext`).
- While a page loads, keep the frame and put a skeleton inside it (`title` can be a plain noun such as "Playlist" until the object's name is known).
- The shell holds its state in memory only: sidebar collapsed, drawer open. Nothing is written to web storage.
- `useToast()` works in every page: `AppShell` renders the one `ToastProvider`.

### Page

```ts
interface PageProps {
  title: string; // the h1; also the document title
  documentTitle?: string; // the page part of the document title when it should differ
  subtitle?: ReactNode; // optional short line under the title, in secondary text
  actions?: ReactNode; // page-level actions in the header, before the global controls
  children: ReactNode; // the content, inside main#main
}
```

```tsx
import { Page } from '../../shell/Page.tsx';

export function PlaylistsPage() {
  return (
    <Page title="Playlists">
      <div className="tx-stack">
        <div className="tx-filter-row">…</div>
        <DataTable … />
      </div>
    </Page>
  );
}
```

The list and overview frame: a sticky glass header, 72 px tall, with the `h1` on the left, then `actions`, then the global controls in this order: the organisation label (`session.organization.name`, written once on the page), `AccountMenu`, `PushButton`. The content column scrolls under it, has the `--gutter` side padding and is at most `--content-max` wide. Most list pages leave `actions` empty, because their create button sits at the end of the filter row. Under 760 px the header takes two lines (menu button and title, then actions and global controls) and under 480 px the push button shows its icon and count only; its name stays for assistive technology.

### EditorPage

```ts
interface EditorPageProps {
  title: string; // the object's name as the h1
  documentTitle?: string;
  back: { to: string; label: string }; // the link above the title: { to: '/playlists', label: 'All playlists' }
  status?: ReactNode; // a quiet label before the actions: "Saved", "Unsaved changes"
  actions?: ReactNode; // quiet Cancel first, primary Save last (a SplitButton where there are more save actions)
  children: ReactNode; // the content, inside main#main; lay it out with `tx-editor`
}
```

```tsx
import { EditorPage } from '../../shell/EditorPage.tsx';

<EditorPage
  title={playlist.name}
  back={{ to: '/playlists', label: 'All playlists' }}
  status={dirty ? <span role="status">Unsaved changes</span> : 'Saved'}
  actions={
    <>
      <Button variant="ghost" onClick={discard}>Discard</Button>
      <Button variant="primary" busy={saving} aria-disabled={!dirty} onClick={save}>Save</Button>
    </>
  }
>
  <div className="tx-editor">…</div>
</EditorPage>
```

The editor frame: the back link, the object's name as `h1`, the status label and the actions. The global controls are reduced to the account menu, whose heading then also names the organisation. There is no push button in this frame; a page that pushes calls `usePush()` itself.

### PushContext (features/push/PushContext.tsx)

```ts
interface PushRequest {
  only?: readonly string[]; // list only these screens (display ids); the operator can show all
  preselect?: readonly string[]; // tick exactly these, where they have changes waiting
  displayIds?: readonly string[]; // earlier name of `preselect`
}
interface PushContextValue {
  plan: PushPlanResponse | null; // GET /api/push as last read; read it from here, never call api.getPushPlan in a page
  planError: unknown; // why the latest read failed; `plan` is then the last good answer
  pendingCount: number | null; // screens with changes waiting; null while not known (no badge)
  refresh: () => void; // read the plan again; does nothing while the push dialog is open
  openDialog: (request?: PushRequest) => void; // opens the one push dialog
  openPush: (request?: PushRequest) => void; // same function (the shell's button uses this name)
  refreshPending: () => void; // same function as refresh
}
// exports: PushContext, PushProvider, usePush(), types PushContextValue and PushRequest
```

```tsx
const push = usePush();
<Button variant="primary" onClick={() => push.openDialog({ only: [display.id] })}>Push to this screen</Button>
// after any save that can change what is waiting (playlist saved, playlist assigned, canvas changed):
push.refresh();
```

`AppShell` renders `PushProvider` once, inside the router, the session and the `ToastProvider`. The provider reads the plan on mount, every 30 s while the tab is visible and the dialog is closed, when the tab becomes visible again, and on `refresh()`. The header's `PushButton`, the dashboard, the playlist editor, the screens list and the screen page all use it, so there is one dialog and one count. The full contract, test ids and wording are in `features/push/README.md`.

### nav.ts

| Export | Use |
|---|---|
| `PRIMARY_NAV` | The sidebar, top to bottom: links and the Media group. An item is `{ kind: 'link', id, label, to, icon, planned? }` or `{ kind: 'group', id, label, icon, children }` |
| `FOOTER_NAV` | The sidebar's bottom list: Settings |
| `ACCOUNT_NAV` | The account menu above "Sign out": Settings, Users, Audit log |
| `activeNavId(pathname)` | The id of the sidebar link that is current. The deepest match wins, so `/media/<id>` is All media and `/settings/tags` is Settings; `null` for `/audit` and `/users` |
| `activeGroupId(pathname)` | The group that holds the current link (`media` on every media route) |
| `navItemName(item)` | The entry's name with "(planned)" where it applies, for tooltips |
| `documentTitle(pageTitle)` | "Playlists · TINNOX CMS" |
| `screensPathFor(pathname)` | The `/screens` address of an M0 `/displays` address, used by the redirect in `App.tsx` |
| `HOME_PATH`, `PRODUCT_NAME` | `/dashboard`, "TINNOX CMS" |

`planned: true` puts the "Planned" pill on an entry. When a planned section is built, remove the flag in `nav.ts` and point its route in `App.tsx` at the new page; `nav.test.ts` lists the planned entries and must be updated with it.

### Other parts of the shell

| File | What it is |
|---|---|
| `AppShell.tsx` | The frame above. Owns sign-out (the M0 behaviour: one attempt at a time, a failure is shown by the page frame as an alert titled "Sign-out did not complete"), the drawer, the collapsed state, scroll-to-top on navigation, and a hidden live region that names the page after a navigation |
| `Sidebar.tsx` | The navigation. The Media group opens on every navigation to a media route. Collapsed, entries are icons with tooltips and Media opens as a menu. Under 900 px it is a modal `<dialog>` drawer: Escape, the backdrop and its close button return focus to the header's menu button; choosing a link moves focus to `main` |
| `AccountMenu.tsx` | The avatar button and its menu: name and role, Settings, Users, Audit log, Sign out |
| `PushButton.tsx` | The primary "Push to screens" pill with the pending count |
| `PageHeader.tsx` | The header and `main` shared by the two frames. Pages do not use it directly |
| `Screens.tsx` | Screens without the shell: `SignInScreen`, `SessionCheckingScreen`, `SessionErrorScreen`, `RouteError` (the router's error element), and `RouteLoading` (the placeholder while a page's code loads on first visit) |
| `NotFoundPage.tsx` | The page for an unknown address |
| `Wordmark.tsx` | The text brand mark; `compact` shows the square "T" |
| `ShellContext.ts` | `useShell()`: `drawerMode`, `navOpen`, `openNav`, `signOut`, `announcePage`. For the shell's own components |
| `useDocumentTitle.ts`, `useMediaQuery.ts` | Small hooks used by the frames and the shell |

### Feature modules and routes

Routes are declared in `App.tsx` with the `page(path, load, render)` helper: each feature module is loaded on first visit and becomes its own bundle, so a page's CSS file can be imported from the page itself. Keep each file path and named export; replace only the inside.

| Path | Module | Export |
|---|---|---|
| `/dashboard` | `features/dashboard/DashboardPage.tsx` | `DashboardPage` |
| `/media`, `/media/images`, `/media/videos` | `features/media/MediaLibraryPage.tsx` | `MediaLibraryPage({ kind })`, `kind: 'all' \| 'image' \| 'video'` (the three routes share one mounted page, so uploads carry on between them) |
| `/media/:id` | `features/media/MediaDetailPage.tsx` | `MediaDetailPage` |
| `/playlists` | `features/playlists/PlaylistsPage.tsx` | `PlaylistsPage` |
| `/playlists/:id` | `features/playlists/PlaylistEditorPage.tsx` | `PlaylistEditorPage` |
| `/screens` | `features/displays/DisplaysPage.tsx` | `DisplaysPage` |
| `/screens/new` | `features/displays/DisplayWizardPage.tsx` | `DisplayWizardPage` |
| `/screens/:id` | `features/displays/DisplayDetailPage.tsx` | `DisplayDetailPage` (tab in `?tab=`) |
| `/screens/:id/edit` | `App.tsx` | redirect to `/screens/:id?tab=canvas` |
| `/displays`, `/displays/*` | `App.tsx` | redirect to the same path under `/screens`, keeping the query and fragment |
| `/settings` | `features/settings/SettingsPage.tsx` | `SettingsPage` |
| `/settings/tags` | `features/settings/TagsPage.tsx` | `TagsPage` |
| `/audit` | `features/audit/AuditPage.tsx` | `AuditPage` |
| `/apps` | `features/apps/AppsPage.tsx` | `AppsPage` (list, type filter, create dialog) |
| `/apps/:id` | `features/apps/AppEditorPage.tsx` | `AppEditorPage` (`AppEditor`: preview, settings, delete) |
| `/schedules` | `features/schedules/SchedulesPage.tsx` | `SchedulesPage` (list, search, create dialog, delete) |
| `/schedules/:id` | `features/schedules/ScheduleEditorPage.tsx` | `ScheduleEditorPage` (`ScheduleEditor`: details, default playlist, the ordered list of weekly events, delete) |
| `/media/audio`, `/media/documents`, `/media/web-pages`, `/layouts`, `/users` | `features/planned/PlannedPage.tsx` | `PlannedPage({ section })` |
| (provider, no route) | `features/push/PushContext.tsx` | `PushContext`, `PushProvider`, `usePush` |
| `/styleguide` | `features/styleguide/StyleguidePage.tsx` | default export, development builds only |

Parts several pages share (tags, folders, thumbnails, pickers, status pills, the leave guard) are in `features/shared/` and documented in `features/shared/README.md`.

Notes for the Apps pages: an app is drawn in the portal by `features/apps/AppPreview.tsx`, which mounts `renderApp` from `@tinnox/app-render` (the player's renderer) inside a `CanvasFrame` (`features/displays/detail/CanvasFrame.tsx`; sizes `sm` 150 px, `md` 200 px, `lg` 176 px, `xl` 360 px for the app editor's preview). The preview uses this computer's time zone and says so for Clock, Date and Countdown. The screen page's assigned-content preview uses `AppPreview` too when the first playlist item is an app.

Notes for the Schedules pages (stage B, slice 3): a schedule is a default playlist plus up to 50 weekly events. The list follows the Apps list (no grid, bulk selection or pagination). The editor is an `EditorPage` with three cards: Details, Default playlist and Events. Events are an ordered list (`<ol>`), not a grid and not a dialog: each event is a `<fieldset>` named "Event N" (`ScheduleEventRow.tsx`) with a native `Select` for the playlist and an "Open playlist" link beside it, seven day checkboxes (shown as Mon to Sun, with the full day name for assistive technology), Start and End time fields, and Move up, Move down and Remove buttons; the fixed help text about priority, time zone and the player version sits at the top of the Events card. Adding, moving and removing an event keeps focus inside the list; a Save that fails validation focuses the error summary, whose entries ("Event 3: Choose a playlist.") are links to the controls. The pure logic is `lib/schedules.ts` (drafts, validation, the mapping of the API's dotted error paths such as `events.2.playlistId`, list search and sort). Test ids: `schedules-create`, `schedules-table`, `schedule-create-dialog`, `schedule-save`, `schedule-error-summary`, `schedule-default-playlist`, `schedule-add-event`, and per event `schedule-event-{n}` with `-playlist`, `-open`, `-day-{0..6}`, `-start`, `-end`, `-up`, `-down`, `-remove` (n counts from 0).

Notes for the screen pages: the feature folder and the component names keep the code's word, `display` (`features/displays/`, `DisplaysPage`); the routes, the `h1`s and every label say "screen". The selected tab of the screen page is kept in the address as `?tab=`, with `canvas` for the canvas form.

The screen page's Content card (`features/displays/detail/ContentCard.tsx`) assigns a playlist or a schedule, never both. With nothing assigned it shows "Assign playlist" (`screen-detail-choose-playlist`) and "Assign schedule" (`screen-detail-choose-schedule`). With content it shows the kind ("Playlist" or "Schedule") above the name, "Open playlist" or "Open schedule" (`screen-detail-open-schedule`), and one "Change" menu (`screen-detail-change-content`) with "Choose a playlist…", "Choose a schedule…" and "Remove content"; the menu items have no test ids, so tests reach them by name. With a schedule the card adds "Default playlist: {name}" (`screen-detail-default-playlist`), and the mosaic, the summary and the preview show that default playlist. The two pickers are `screen-detail-playlist-picker` and `screen-detail-schedule-picker`. When a save swaps the two buttons for the menu or back, focus moves to the control that took their place. The earlier test id `screen-detail-change-playlist` no longer exists.
