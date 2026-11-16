import { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  ButtonLink,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Field,
  IconButton,
  Kbd,
  Menu,
  MenuHeader,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  SplitButton,
  StatusPill,
  Switch,
  TabPanel,
  Tabs,
  TextInput,
  Tooltip,
  useToast,
} from '../../ui/index.ts';
import {
  ChevronDown,
  CloudUpload,
  Copy,
  Ellipsis,
  Eye,
  FolderInput,
  ListPlus,
  LogOut,
  Plus,
  RefreshCw,
  ScrollText,
  Send,
  Settings,
  Tags,
  Trash,
  Users,
} from '../../ui/icons.ts';
import { Demo, Section } from './Section.tsx';

export function ButtonSection() {
  const [busy, setBusy] = useState(false);
  return (
    <Section
      id="buttons"
      title="Buttons"
      lead="Pill-shaped. One primary action per view; everything else is secondary or ghost. Danger is a red tint, and filled only when it confirms a destructive action in a dialog."
    >
      <Demo title="Variants">
        <Button variant="primary">Save</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="ghost">Discard</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="danger-solid">Delete file</Button>
      </Demo>
      <Demo title="Sizes: 32, 40 and 44 px">
        <Button variant="primary" size="sm">
          Small
        </Button>
        <Button variant="primary">Default</Button>
        <Button variant="primary" size="lg">
          Large
        </Button>
        <Button variant="secondary" size="sm">
          Small
        </Button>
        <Button variant="secondary">Default</Button>
        <Button variant="secondary" size="lg">
          Large
        </Button>
      </Demo>
      <Demo title="With icons, a count, and as a link">
        <Button variant="primary" icon={Plus}>
          Add media
        </Button>
        <Button variant="secondary" icon={RefreshCw}>
          Refresh
        </Button>
        <Button variant="primary" icon={Send}>
          Push to screens <Badge count={3} variant="inverse" label="3 changes waiting" />
        </Button>
        <Button variant="secondary" trailingIcon={ChevronDown}>
          Status
        </Button>
        <ButtonLink variant="secondary" to="/styleguide" icon={Eye}>
          A link styled as a button
        </ButtonLink>
      </Demo>
      <Demo
        title="States"
        note="A busy button keeps its width and its focus, and ignores presses. A disabled button cannot be focused."
      >
        <Button variant="primary" busy={busy}>
          Save changes
        </Button>
        <Button variant="secondary" busy={busy}>
          Pair player
        </Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
        <Switch checked={busy} onChange={setBusy} label="Show the busy state" />
      </Demo>
      <Demo
        title="Icon buttons"
        note="Each has an accessible name, shown as a tooltip on hover and focus."
      >
        <IconButton icon={RefreshCw} label="Refresh" />
        <IconButton icon={Ellipsis} label="More actions" />
        <IconButton icon={Copy} label="Copy ID" variant="secondary" />
        <IconButton icon={Plus} label="Add" variant="primary" />
        <IconButton icon={Trash} label="Delete" variant="danger" />
        <IconButton icon={RefreshCw} label="Refresh" size="sm" />
        <IconButton icon={RefreshCw} label="Refresh" size="lg" variant="secondary" />
        <IconButton icon={RefreshCw} label="Refresh" disabled />
      </Demo>
      <Demo title="Split button" note="The main action, and a chevron that opens related actions.">
        <SplitButton
          onClick={() => undefined}
          menuLabel="More save actions"
          menu={
            <>
              <MenuItem icon={ListPlus}>Save and add to playlist</MenuItem>
              <MenuItem icon={Copy}>Save as a copy</MenuItem>
            </>
          }
        >
          Save
        </SplitButton>
        <SplitButton
          variant="secondary"
          onClick={() => undefined}
          menuLabel="More push actions"
          menu={<MenuItem icon={Send}>Push to all screens at this site</MenuItem>}
        >
          Push now
        </SplitButton>
      </Demo>
    </Section>
  );
}

type Fit = 'default' | 'contain' | 'cover';

const FIT_LABEL: { readonly [K in Fit]: string } = {
  default: 'Screen default',
  contain: 'Contain',
  cover: 'Cover',
};

export function MenuSection() {
  const [fit, setFit] = useState<Fit>('default');
  const [last, setLast] = useState('Nothing chosen yet.');
  const choose = (label: string) => () => {
    setLast(`Chosen: ${label}`);
  };
  return (
    <Section
      id="menus"
      title="Menus"
      lead={
        <>
          Open with a press, <Kbd>Enter</Kbd>, <Kbd>Space</Kbd> or an arrow key. Inside, arrows
          move, <Kbd>Home</Kbd> and <Kbd>End</Kbd> jump, letters jump to a matching item, and{' '}
          <Kbd>Esc</Kbd> closes and returns focus to the button.
        </>
      }
    >
      <Demo title="Row actions, a choice, and the account menu" note={last}>
        <Menu
          placement="bottom-end"
          trigger={(props) => (
            <IconButton {...props} icon={Ellipsis} label="Actions for Foyer welcome loop" />
          )}
        >
          <MenuItem icon={Eye} onSelect={choose('Open')}>
            Open
          </MenuItem>
          <MenuItem icon={ListPlus} onSelect={choose('Add to playlist')}>
            Add to playlist
          </MenuItem>
          <MenuItem icon={FolderInput} onSelect={choose('Move to folder')}>
            Move to folder
          </MenuItem>
          <MenuItem icon={Tags} onSelect={choose('Edit tags')}>
            Edit tags
          </MenuItem>
          <MenuItem icon={Send} disabled>
            Push now
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={Trash} tone="danger" onSelect={choose('Delete')}>
            Delete
          </MenuItem>
        </Menu>

        <Menu
          trigger={(props) => (
            <Button {...props} variant="secondary" trailingIcon={ChevronDown}>
              Fit: {FIT_LABEL[fit]}
            </Button>
          )}
        >
          <MenuLabel>How the item fills the screen</MenuLabel>
          {(['default', 'contain', 'cover'] as const).map((option) => (
            <MenuItem
              key={option}
              type="radio"
              checked={fit === option}
              onSelect={() => {
                setFit(option);
              }}
            >
              {FIT_LABEL[option]}
            </MenuItem>
          ))}
        </Menu>

        <Menu
          placement="bottom-end"
          trigger={(props) => (
            <Button {...props} variant="ghost" trailingIcon={ChevronDown}>
              <Avatar name="Workshop Operator" size="sm" /> Account
            </Button>
          )}
        >
          <MenuHeader>
            <span className="tx-strong">Workshop Operator</span>
            <br />
            <span className="tx-small tx-muted">TINNOX Internal</span>
          </MenuHeader>
          <MenuSeparator />
          <MenuItem icon={Settings} onSelect={choose('Settings')}>
            Settings
          </MenuItem>
          <MenuItem icon={Users} hint="Planned" disabled>
            Users
          </MenuItem>
          <MenuItem icon={ScrollText} onSelect={choose('Audit log')}>
            Audit log
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={LogOut} onSelect={choose('Sign out')}>
            Sign out
          </MenuItem>
        </Menu>
      </Demo>
    </Section>
  );
}

type AddMediaTab = 'upload' | 'stock' | 'web' | 'document' | 'audio';

const ADD_MEDIA_TABS = [
  { id: 'upload', label: 'Upload' },
  {
    id: 'stock',
    label: 'Stock',
    disabled: true,
    disabledReason: 'Planned, no stage set',
    note: 'Planned',
  },
  {
    id: 'web',
    label: 'Web page',
    disabled: true,
    disabledReason: 'Planned for stage C',
    note: 'Planned',
  },
  {
    id: 'document',
    label: 'Document',
    disabled: true,
    disabledReason: 'Planned for stage C',
    note: 'Planned',
  },
  {
    id: 'audio',
    label: 'Audio',
    disabled: true,
    disabledReason: 'Planned for stage C',
    note: 'Planned',
  },
] as const;

const PUSH_ROWS = [
  { id: 'd1', display: 'Foyer wall', playlist: 'Reception loop', waiting: true },
  { id: 'd2', display: 'Atrium ribbon', playlist: 'Spring range', waiting: true },
  { id: 'd3', display: 'Lift lobby, level 2', playlist: 'Notices', waiting: false },
] as const;

export function DialogSection() {
  const toast = useToast();
  const [open, setOpen] = useState<'none' | 'small' | 'medium' | 'large' | 'confirm'>('none');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(['d1', 'd2']));
  const [tab, setTab] = useState<AddMediaTab>('upload');
  const [deleting, setDeleting] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const close = () => {
    setOpen('none');
  };

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Section
      id="dialogs"
      title="Dialogs"
      lead="Built on the native dialog element: the page behind is inert, Tab stays inside, Esc closes, and focus returns to the button that opened it. Under 560 px wide a dialog becomes a sheet at the bottom edge."
    >
      <Demo title="Widths: 480, 640 and 880 px">
        <Button
          variant="secondary"
          onClick={() => {
            setName('');
            setOpen('small');
          }}
        >
          New playlist (480)
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen('medium');
          }}
        >
          Push to screens (640)
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen('large');
          }}
        >
          Add media (880)
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setOpen('confirm');
          }}
        >
          Delete file
        </Button>
      </Demo>

      <Dialog
        open={open === 'small'}
        onClose={close}
        title="New playlist"
        description="Give it a name. You can add items next."
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={name.trim() === ''}
              onClick={() => {
                close();
                toast.info('Style guide only: no playlist was created.');
              }}
            >
              Create playlist
            </Button>
          </>
        }
      >
        <Field label="Name" hint="Up to 80 characters.">
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
      </Dialog>

      <Dialog
        open={open === 'medium'}
        onClose={close}
        title="Push to screens"
        size="md"
        footerStart={`${picked.size} selected`}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Send}
              disabled={picked.size === 0}
              onClick={() => {
                close();
                toast.info('Style guide only: nothing was pushed.');
              }}
            >
              Push to {picked.size} {picked.size === 1 ? 'screen' : 'screens'}
            </Button>
          </>
        }
      >
        <div className="tx-stack">
          <Banner tone="info">
            Each screen gets its own publication. A screen keeps playing what it has until the new
            one is complete.
          </Banner>
          <ul className="tx-sg-list">
            {PUSH_ROWS.map((row) => (
              <li key={row.id}>
                <Checkbox
                  checked={picked.has(row.id)}
                  label={row.display}
                  hint={row.playlist}
                  onChange={(checked) => {
                    const next = new Set(picked);
                    if (checked) next.add(row.id);
                    else next.delete(row.id);
                    setPicked(next);
                  }}
                />
                <StatusPill tone={row.waiting ? 'warn' : 'neutral'}>
                  {row.waiting ? 'Changes waiting' : 'Up to date'}
                </StatusPill>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>

      <Dialog
        open={open === 'large'}
        onClose={close}
        title="Add media"
        size="lg"
        footer={
          <Button variant="secondary" onClick={close}>
            Done
          </Button>
        }
      >
        <Tabs
          id="sg-add-media"
          label="Where the media comes from"
          tabs={ADD_MEDIA_TABS}
          value={tab}
          onChange={setTab}
        />
        <TabPanel tabs="sg-add-media" tab={tab}>
          <div className="tx-stack">
            <Banner tone="info" icon={CloudUpload} title="Drop files here">
              The real dialog has a drop zone and one row per file. This one only shows the frame,
              the tabs and a menu opening above a dialog.
            </Banner>
            <div className="tx-cluster">
              <Menu
                trigger={(props) => (
                  <Button {...props} variant="secondary" trailingIcon={ChevronDown}>
                    A menu inside a dialog
                  </Button>
                )}
              >
                <MenuItem>Stays above the dialog</MenuItem>
                <MenuItem>Keeps focus inside</MenuItem>
              </Menu>
              <Tooltip content="Tooltips work in dialogs too" describe>
                <Button variant="ghost">Hover or focus me</Button>
              </Tooltip>
            </div>
          </div>
        </TabPanel>
      </Dialog>

      <ConfirmDialog
        open={open === 'confirm'}
        title="Delete this file?"
        confirmLabel="Delete file"
        tone="danger"
        busy={deleting}
        onCancel={close}
        onConfirm={() => {
          // The style guide has nothing to delete; it only holds the busy state for a moment.
          setDeleting(true);
          timer.current = window.setTimeout(() => {
            setDeleting(false);
            close();
            toast.info('Style guide only: nothing was deleted.');
          }, 1500);
        }}
      >
        <p>
          <strong>Foyer welcome loop</strong> will be removed from the library. Screens keep playing
          publications that already contain it.
        </p>
      </ConfirmDialog>
    </Section>
  );
}

export function ToastSection() {
  const toast = useToast();
  return (
    <Section
      id="toasts"
      title="Toasts"
      lead="Bottom centre. They leave after five seconds, pause while hovered or focused, and are announced to screen readers. An error stays until it is dismissed."
    >
      <Demo title="Tones" note="Every message here is a sample; none reports a real action.">
        <Button
          variant="secondary"
          onClick={() => {
            toast.success('Sample: playlist saved');
          }}
        >
          Success
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            toast.info('Sample: 2 files added to the upload queue');
          }}
        >
          Information
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            toast.warn('Sample: storage is 82% full');
          }}
        >
          Attention
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            toast.error('Sample: the file was not deleted', { detail: 'media_in_use' });
          }}
        >
          Error with a code
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            toast.success('Sample: 3 items moved to Seasonal', {
              action: {
                label: 'Undo',
                onAction: () => {
                  toast.info('Sample: move undone');
                },
              },
            });
          }}
        >
          With an action
        </Button>
      </Demo>
    </Section>
  );
}
