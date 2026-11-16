import { useRef, useState } from 'react';
import { parseStepperValue } from '../../lib/stepper.ts';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Chip,
  ChipList,
  Field,
  FieldGroup,
  FormSection,
  Kbd,
  SearchField,
  Segmented,
  Select,
  StatusPill,
  Stepper,
  Switch,
  TabPanel,
  Tabs,
  TAG_COLOURS,
  Textarea,
  TextInput,
  type TabItem,
} from '../../ui/index.ts';
import { Film, Image, Images, LayoutGrid, List, Tag } from '../../ui/icons.ts';
import { DEMO_TAGS } from './demoData.ts';
import { Demo, Section } from './Section.tsx';

const MIN_SIDE = 16;
const MAX_SIDE = 16384;

function pixelError(text: string): string | undefined {
  const value = parseStepperValue(text);
  if (value === null || !Number.isInteger(value)) return 'Enter a whole number of pixels.';
  if (value < MIN_SIDE || value > MAX_SIDE) {
    return `Enter a value from ${MIN_SIDE} to ${MAX_SIDE}.`;
  }
  return undefined;
}

export function FormSectionDemo() {
  const [name, setName] = useState('Foyer wall');
  const [description, setDescription] = useState('');
  const [site, setSite] = useState('melbourne');
  const [width, setWidth] = useState('3840');
  const [height, setHeight] = useState('48O');
  const [useRect, setUseRect] = useState(false);
  const [duration, setDuration] = useState('10');
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [muted, setMuted] = useState(true);
  const [code, setCode] = useState('');
  const widthRef = useRef<HTMLInputElement>(null);
  const heightRef = useRef<HTMLInputElement>(null);

  const nameError = name.trim() === '' ? 'Enter a name.' : undefined;
  const widthError = pixelError(width);
  const heightError = pixelError(height);
  const durationValue = parseStepperValue(duration);
  const durationError =
    durationValue === null || durationValue < 1 || durationValue > 3600
      ? 'Enter a whole number of seconds from 1 to 3600.'
      : undefined;
  const problems = [
    widthError === undefined ? null : { label: 'Width', message: widthError, ref: widthRef },
    heightError === undefined ? null : { label: 'Height', message: heightError, ref: heightRef },
  ].filter((problem) => problem !== null);

  return (
    <Section
      id="forms"
      title="Forms"
      lead="A label above every control, a hint below where it helps, and errors at the field with an icon. From 900 px wide, settings forms put the label to the left."
    >
      <Demo
        title="An editor form"
        layout="page"
        note="Height starts with a letter O in place of a zero, to show an error and the summary that links to it."
      >
        <Card className="tx-sg-form">
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            {problems.length > 0 && (
              <Banner tone="danger" title="Check these fields before saving">
                <ul>
                  {problems.map((problem) => (
                    <li key={problem.label}>
                      <a
                        href="#forms"
                        onClick={(event) => {
                          event.preventDefault();
                          problem.ref.current?.focus();
                        }}
                      >
                        {problem.label}
                      </a>
                      : {problem.message}
                    </li>
                  ))}
                </ul>
              </Banner>
            )}
            <FormSection title="Details" layout="rows">
              <Field label="Name" error={nameError} required>
                {(control) => (
                  <TextInput
                    {...control}
                    value={name}
                    maxLength={80}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                  />
                )}
              </Field>
              <Field label="Description" optional hint="Shown in lists. Up to 500 characters.">
                {(control) => (
                  <Textarea
                    {...control}
                    value={description}
                    maxLength={500}
                    placeholder="Where this screen is and what it is for"
                    onChange={(event) => {
                      setDescription(event.target.value);
                    }}
                  />
                )}
              </Field>
              <Field label="Site" hint="A screen's site cannot change after it is created.">
                {(control) => (
                  <Select
                    {...control}
                    width="md"
                    value={site}
                    onChange={(event) => {
                      setSite(event.target.value);
                    }}
                  >
                    <option value="melbourne">Melbourne Workshop</option>
                    <option value="sydney">Sydney Showroom</option>
                    <option value="brisbane">Brisbane Depot</option>
                  </Select>
                )}
              </Field>
              <Field label="Screen ID">
                {(control) => (
                  <TextInput
                    {...control}
                    mono
                    readOnly
                    width="lg"
                    value="3f6c1e0a-7b1d-4c58-9a44-0d2f6f1b8e21"
                  />
                )}
              </Field>
            </FormSection>

            <FormSection
              title="Canvas"
              description="The pixel size of the output the player draws on."
              layout="rows"
            >
              <FieldGroup legend="Size">
                <Field label="Width" error={widthError}>
                  {(control) => (
                    <TextInput
                      {...control}
                      ref={widthRef}
                      numeric
                      inputMode="numeric"
                      suffix="px"
                      width="sm"
                      value={width}
                      onChange={(event) => {
                        setWidth(event.target.value);
                      }}
                    />
                  )}
                </Field>
                <Field label="Height" error={heightError}>
                  {(control) => (
                    <TextInput
                      {...control}
                      ref={heightRef}
                      numeric
                      inputMode="numeric"
                      suffix="px"
                      width="sm"
                      value={height}
                      onChange={(event) => {
                        setHeight(event.target.value);
                      }}
                    />
                  )}
                </Field>
              </FieldGroup>
              <Checkbox
                checked={useRect}
                onChange={setUseRect}
                label="Use a content rectangle"
                hint="Content is drawn in a part of the canvas, for a wall that is smaller than its output."
              />
            </FormSection>

            <FormSection title="Playback" layout="rows">
              <Field
                label="Default duration"
                hint="Used when an image is added to a playlist."
                error={durationError}
              >
                {(control) => (
                  <Stepper
                    {...control}
                    value={duration}
                    onChange={setDuration}
                    min={1}
                    max={3600}
                    unit="s"
                    stepLabel="duration"
                  />
                )}
              </Field>
              <Field label="Default fit">
                {(control) => (
                  <div id={control.id}>
                    <Segmented
                      label="Default fit"
                      value={fit}
                      onChange={setFit}
                      options={[
                        { value: 'contain', label: 'Contain' },
                        { value: 'cover', label: 'Cover' },
                      ]}
                    />
                  </div>
                )}
              </Field>
              <Switch
                checked={muted}
                onChange={setMuted}
                label="Mute video"
                hint="Stage A players always play without sound."
                disabled
              />
            </FormSection>

            <FormSection title="Pairing">
              <Field label="Pairing code shown on the player" hint="Eight characters.">
                {(control) => (
                  <TextInput
                    {...control}
                    mono
                    className="tx-sg-code-field"
                    value={code}
                    maxLength={9}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="XXXX-XXXX"
                    onChange={(event) => {
                      setCode(event.target.value.toUpperCase());
                    }}
                  />
                )}
              </Field>
              <div className="tx-cluster">
                <Button variant="primary" type="submit" aria-disabled={problems.length > 0}>
                  Save changes
                </Button>
                <Button variant="secondary">Cancel</Button>
                <span className="tx-small tx-muted">Unsaved changes</span>
              </div>
            </FormSection>
          </form>
        </Card>
      </Demo>

      <Demo title="Input states">
        <div className="tx-sg-columns">
          <Field label="Default">
            {(control) => <TextInput {...control} defaultValue="Reception loop" />}
          </Field>
          <Field label="Placeholder">
            {(control) => <TextInput {...control} placeholder="For example, Foyer wall" />}
          </Field>
          <Field label="Invalid" error="Enter a name.">
            {(control) => <TextInput {...control} defaultValue="" />}
          </Field>
          <Field label="Disabled">
            {(control) => <TextInput {...control} disabled defaultValue="Melbourne Workshop" />}
          </Field>
          <Field label="Disabled select">
            {(control) => (
              <Select {...control} disabled defaultValue="a">
                <option value="a">Melbourne Workshop</option>
              </Select>
            )}
          </Field>
          <Field label="With a prefix">
            {(control) => <TextInput {...control} prefix="x" numeric defaultValue="0" />}
          </Field>
        </div>
      </Demo>
    </Section>
  );
}

type Kind = 'all' | 'image' | 'video';
type DisplayTab = 'overview' | 'canvas' | 'pairing' | 'tags' | 'hours' | 'alerts';

const DISPLAY_TABS: readonly TabItem<DisplayTab>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'pairing', label: 'Pairing' },
  { id: 'tags', label: 'Tags' },
  { id: 'hours', label: 'Working hours', disabled: true, disabledReason: 'Planned for stage B' },
  { id: 'alerts', label: 'Alerts', disabled: true, disabledReason: 'Planned for stage C' },
];

const TAB_TEXT: { readonly [K in DisplayTab]: string } = {
  overview: 'What the player software last reported for this screen.',
  canvas: 'Canvas size, content rectangle and default fit.',
  pairing: 'Pair, replace or revoke the player.',
  tags: 'Tags used to filter the screen list.',
  hours: '',
  alerts: '',
};

export function ControlSection() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(['tag-foyer']));
  const [seconds, setSeconds] = useState('10');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [kind, setKind] = useState<Kind>('all');
  const [tab, setTab] = useState<DisplayTab>('overview');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ReadonlySet<string>>(new Set(['ready']));
  const [removable, setRemovable] = useState(DEMO_TAGS.slice(0, 4));
  const tagIds = DEMO_TAGS.slice(0, 4).map((tag) => tag.id);
  const pickedCount = tagIds.filter((id) => picked.has(id)).length;

  const toggle = (set: ReadonlySet<string>, id: string, add: boolean): ReadonlySet<string> => {
    const next = new Set(set);
    if (add) next.add(id);
    else next.delete(id);
    return next;
  };

  return (
    <Section
      id="controls"
      title="Selection controls"
      lead="Switches act at once; checkboxes are applied by a Save button. A segmented control holds two to four exclusive choices, tabs a longer set."
    >
      <Demo title="Switch">
        <Switch checked={on} onChange={setOn} label="Play this item" />
        <Switch
          checked={off}
          onChange={setOff}
          label="Shuffle"
          hint="Play the items in a new order each loop."
        />
        <Switch checked onChange={() => undefined} label="On, disabled" disabled />
        <Switch checked={false} onChange={() => undefined} label="Off, disabled" disabled />
      </Demo>

      <Demo
        title="Checkbox, with the mixed state"
        layout="stack"
        note="The first box stands for the four below it: it shows a dash when only some are ticked."
      >
        <Checkbox
          checked={pickedCount === tagIds.length}
          mixed={pickedCount > 0 && pickedCount < tagIds.length}
          label="All tags"
          onChange={() => {
            setPicked(pickedCount === tagIds.length ? new Set() : new Set(tagIds));
          }}
        />
        <div className="tx-cluster">
          {DEMO_TAGS.slice(0, 4).map((tag) => (
            <Checkbox
              key={tag.id}
              checked={picked.has(tag.id)}
              label={tag.name}
              onChange={(checked) => {
                setPicked(toggle(picked, tag.id, checked));
              }}
            />
          ))}
          <Checkbox checked onChange={() => undefined} label="Ticked, disabled" disabled />
          <Checkbox checked={false} onChange={() => undefined} label="Disabled" disabled />
        </div>
      </Demo>

      <Demo
        title="Stepper"
        note={
          <>
            <Kbd>↑</Kbd> and <Kbd>↓</Kbd> step by one, <Kbd>Page Up</Kbd> and <Kbd>Page Down</Kbd>{' '}
            by ten.
          </>
        }
      >
        <Field label="Seconds on screen">
          {(control) => (
            <Stepper
              {...control}
              value={seconds}
              onChange={setSeconds}
              min={1}
              max={3600}
              unit="s"
              stepLabel="seconds on screen"
            />
          )}
        </Field>
        <Field label="Disabled">
          {(control) => (
            <Stepper
              {...control}
              value="30"
              onChange={() => undefined}
              min={1}
              max={3600}
              unit="s"
              stepLabel="duration"
              disabled
            />
          )}
        </Field>
      </Demo>

      <Demo title="Segmented">
        <Segmented
          label="View"
          iconOnly
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'List', icon: List },
            { value: 'grid', label: 'Grid', icon: LayoutGrid },
          ]}
        />
        <Segmented
          label="Media kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All', icon: Images },
            { value: 'image', label: 'Images', icon: Image },
            { value: 'video', label: 'Videos', icon: Film },
          ]}
        />
        <Segmented
          label="Density"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'Comfortable' },
            { value: 'grid', label: 'Compact' },
          ]}
        />
      </Demo>

      <Demo
        title="Tabs"
        layout="stack"
        note="Disabled tabs stay focusable, so the reason they are disabled can be read."
      >
        <div>
          <Tabs
            id="sg-display"
            label="Screen sections"
            tabs={DISPLAY_TABS}
            value={tab}
            onChange={setTab}
          />
          <TabPanel tabs="sg-display" tab={tab}>
            <p>{TAB_TEXT[tab]}</p>
          </TabPanel>
        </div>
      </Demo>

      <Demo title="Search field" note="Esc clears the query.">
        <SearchField value={query} onChange={setQuery} label="Search media" />
        <span className="tx-small tx-muted">
          {query === '' ? 'Nothing typed.' : `Query: ${query}`}
        </span>
      </Demo>

      <Demo title="Chips" layout="stack">
        <div className="tx-cluster" role="group" aria-label="Status filters">
          {[
            ['ready', 'Ready'],
            ['processing', 'Processing'],
            ['failed', 'Failed'],
          ].map(([id = '', label = '']) => (
            <Chip
              key={id}
              selected={filters.has(id)}
              onToggle={(selected) => {
                setFilters(toggle(filters, id, selected));
              }}
            >
              {label}
            </Chip>
          ))}
          <Chip onToggle={() => undefined} disabled>
            Disabled
          </Chip>
        </div>
        <ChipList label="Tag colours">
          {TAG_COLOURS.map((colour) => (
            <li key={colour}>
              <Chip colour={colour}>{colour}</Chip>
            </li>
          ))}
        </ChipList>
        <ChipList label="Removable tags">
          {removable.map((tag) => (
            <li key={tag.id}>
              <Chip
                colour={tag.colour}
                removeLabel={`Remove tag ${tag.name}`}
                onRemove={() => {
                  setRemovable(removable.filter((other) => other.id !== tag.id));
                }}
              >
                {tag.name}
              </Chip>
            </li>
          ))}
          <li>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRemovable(DEMO_TAGS.slice(0, 4));
              }}
            >
              Reset
            </Button>
          </li>
        </ChipList>
        <div className="tx-cluster">
          <Chip size="sm" colour="teal">
            Small, for tables
          </Chip>
          <Chip size="sm" icon={Tag}>
            With an icon
          </Chip>
        </div>
      </Demo>

      <Demo
        title="Status pills"
        layout="stack"
        note="Screen status reports what the player software last said. The portal has no word for a screen being reachable."
      >
        <div className="tx-cluster">
          <StatusPill tone="ok">In sync</StatusPill>
          <StatusPill tone="warn">Updating</StatusPill>
          <StatusPill tone="warn">Not reporting</StatusPill>
          <StatusPill tone="danger">Error</StatusPill>
          <StatusPill tone="neutral">Waiting for player</StatusPill>
          <StatusPill tone="neutral">Nothing pushed</StatusPill>
          <StatusPill tone="neutral">Not paired</StatusPill>
        </div>
        <div className="tx-cluster">
          <StatusPill tone="ok">Ready</StatusPill>
          <StatusPill tone="warn">Processing</StatusPill>
          <StatusPill tone="danger">Failed</StatusPill>
          <StatusPill tone="neutral">Planned</StatusPill>
        </div>
      </Demo>

      <Demo title="Badge, avatar and key cap">
        <Badge count={3} label="3 changes waiting" />
        <Badge count={128} label="128 items" />
        <Badge count={7} variant="neutral" label="7 items" />
        <Badge count={2} variant="danger" label="2 errors" />
        <span className="tx-sg-on-brand">
          On brand <Badge count={5} variant="inverse" label="5 waiting" />
        </span>
        <Avatar name="Workshop Operator" size="sm" labelled />
        <Avatar name="Workshop Operator" labelled />
        <Avatar name="Operator" size="lg" labelled />
        <span>
          <Kbd>Esc</Kbd> <Kbd>Enter</Kbd> <Kbd>Shift</Kbd>
        </span>
      </Demo>
    </Section>
  );
}
