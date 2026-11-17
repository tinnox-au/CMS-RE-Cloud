import { useState } from 'react';
import { formatBytes } from '../../lib/format.ts';
import { meterPercentLabel } from '../../lib/meter.ts';
import {
  BackLink,
  Banner,
  Breadcrumb,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Fact,
  Facts,
  Icon,
  IconButton,
  Kbd,
  Meter,
  Skeleton,
  SkeletonGroup,
  Spinner,
  StatusPill,
  Switch,
  Thumb,
  Tooltip,
} from '../../ui/index.ts';
import {
  CalendarDays,
  Copy,
  LayoutTemplate,
  Monitor,
  Plus,
  RefreshCw,
  Send,
  TriangleExclamationPoint,
} from '../../ui/icons.ts';
import { DEMO_STORAGE, useDemoArt } from './demoData.ts';
import { Demo, Section } from './Section.tsx';

const GIGABYTE = 1024 ** 3;

const COUNTERS: readonly { readonly label: string; readonly value: number }[] = [
  { label: 'In sync', value: 9 },
  { label: 'Changes or updating', value: 2 },
  { label: 'Needs attention', value: 1 },
  { label: 'Not paired', value: 3 },
];

export function SurfaceSection() {
  const [dismissed, setDismissed] = useState(false);
  return (
    <Section
      id="surfaces"
      title="Cards and notices"
      lead="A card is a white surface with a 20 px radius, no border and no shadow. Banners carry a tone, an icon and at most two actions; an empty state has one sentence and one button."
    >
      <Demo title="Cards" layout="page">
        <div className="tx-sg-columns">
          <Card as="section" aria-labelledby="sg-card-displays">
            <CardHeader
              id="sg-card-displays"
              title="Screens"
              actions={
                <Button variant="ghost" size="sm">
                  View all
                </Button>
              }
            />
            <div className="tx-sg-counters">
              {COUNTERS.map((counter) => (
                <div key={counter.label} className="tx-sg-counter">
                  <span className="tx-sg-counter__value">{counter.value}</span>
                  <span className="tx-small tx-muted">{counter.label}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card as="section" aria-labelledby="sg-card-library">
            <CardHeader id="sg-card-library" title="Library" />
            <div className="tx-stack">
              <Meter
                label="Storage"
                value={DEMO_STORAGE.usedBytes}
                max={DEMO_STORAGE.limitBytes}
                valueText={`${formatBytes(DEMO_STORAGE.usedBytes)} of ${formatBytes(DEMO_STORAGE.limitBytes)} used`}
              />
              <Facts>
                <Fact label="Media">23 items</Fact>
                <Fact label="Playlists">6</Fact>
              </Facts>
            </div>
          </Card>

          <Card as="section" aria-labelledby="sg-card-facts">
            <CardHeader
              id="sg-card-facts"
              size="title"
              title="Foyer welcome loop"
              description="A card title with more weight, and a list of facts."
            />
            <Facts>
              <Fact label="Kind">Video</Fact>
              <Fact label="Dimensions">
                <span className="tx-num">1920 × 1080</span>
              </Fact>
              <Fact label="Length">
                <span className="tx-num">42 s</span>
              </Fact>
              <Fact label="ID">
                <span className="tx-cluster">
                  <span className="tx-mono">3f6c1e0a</span>
                  <IconButton icon={Copy} label="Copy ID" size="sm" />
                </span>
              </Fact>
            </Facts>
          </Card>
        </div>
      </Demo>

      <Demo title="Banners" layout="stack">
        <Banner tone="info">
          Editing or assigning changes nothing on a screen until it is pushed.
        </Banner>
        <Banner tone="ok" title="Sample: code accepted">
          The player will collect its credential within a few seconds.
        </Banner>
        <Banner
          tone="warn"
          title="Sample: 2 screens have changes waiting"
          actions={
            <Button variant="secondary" size="sm" icon={Send}>
              Review and push
            </Button>
          }
        >
          They keep playing what they were last given.
        </Banner>
        <Banner
          tone="danger"
          title="Sample: the media library could not be loaded"
          actions={
            <Button variant="secondary" size="sm" icon={RefreshCw}>
              Try again
            </Button>
          }
        >
          The server answered <span className="tx-code">service_unavailable</span>. Request{' '}
          <span className="tx-mono">req-7f3a91c2</span>.
        </Banner>
        <Banner tone="danger" title="Sample: blocked">
          Spring range cannot be pushed: one item has a video the players cannot decode{' '}
          <span className="tx-code">unsupported_codec</span>. A code stays whole: it moves to the
          next line rather than breaking.
        </Banner>
        {dismissed ? (
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDismissed(false);
              }}
            >
              Show the dismissible banner again
            </Button>
          </div>
        ) : (
          <Banner
            tone="info"
            icon={CalendarDays}
            onDismiss={() => {
              setDismissed(true);
            }}
          >
            A banner can take its own icon and a close button.
          </Banner>
        )}
      </Demo>

      <Demo title="Empty state, page size" layout="page">
        <Card flush>
          <EmptyState
            icon={Monitor}
            title="No screens yet"
            action={
              <Button variant="primary" size="lg" icon={Plus}>
                Add screen
              </Button>
            }
          >
            Add a screen, pair its player, and assign a playlist to it.
          </EmptyState>
        </Card>
      </Demo>

      <Demo
        title="Empty state, inside a card"
        layout="page"
        note="A planned section says in one sentence what it will do and when. It has no controls."
      >
        <Card flush>
          <EmptyState variant="inline" icon={LayoutTemplate} title="Layouts are planned">
            Layouts will split a screen into zones. They arrive with stage B.
          </EmptyState>
        </Card>
      </Demo>
    </Section>
  );
}

export function MediaSection() {
  const art = useDemoArt(4);
  const [used, setUsed] = useState(false);
  return (
    <Section
      id="media"
      title="Thumbnails, loading and meters"
      lead="A thumbnail keeps its box while the picture loads and when there is none. Lists load as skeletons; a spinner is for a single control or a small region."
    >
      <Demo
        title="Thumb"
        layout="stack"
        note="The pictures are drawn in the browser for this page."
      >
        <div className="tx-sg-thumb-row">
          <figure>
            <Thumb size="sm" src={art[0] ?? null} />
            <figcaption className="tx-small tx-muted">sm, 44 px</figcaption>
          </figure>
          <figure>
            <Thumb size="md" src={art[1] ?? null} />
            <figcaption className="tx-small tx-muted">md, 72 px</figcaption>
          </figure>
          <figure>
            <Thumb size="lg" src={art[2] ?? null} kind="video" />
            <figcaption className="tx-small tx-muted">lg, video badge</figcaption>
          </figure>
          <figure>
            <Thumb size="lg" ratio="square" src={art[3] ?? null} />
            <figcaption className="tx-small tx-muted">lg, square</figcaption>
          </figure>
          <figure>
            <Thumb size="lg" ratio="classic" fit="contain" src={art[0] ?? null} />
            <figcaption className="tx-small tx-muted">lg, 4:3, contain</figcaption>
          </figure>
          <figure>
            <Thumb size="lg" />
            <figcaption className="tx-small tx-muted">No picture</figcaption>
          </figure>
          <figure>
            <Thumb size="lg" kind="video" />
            <figcaption className="tx-small tx-muted">No picture, video</figcaption>
          </figure>
          <figure>
            <Thumb size="lg" src="/styleguide-missing-preview" />
            <figcaption className="tx-small tx-muted">Failed to load</figcaption>
          </figure>
          <figure className="tx-sg-thumb-fill">
            <Thumb src={art[1] ?? null} alt="Abstract teal shapes" />
            <figcaption className="tx-small tx-muted">fill, 16:9</figcaption>
          </figure>
        </div>
      </Demo>

      <Demo title="Skeleton" layout="stack">
        <SkeletonGroup label="Loading sample" className="tx-cluster">
          <div className="tx-sg-skeleton-card">
            <Skeleton variant="block" width="44px" height="44px" />
            <div className="tx-sg-skeleton-lines">
              <Skeleton width="70%" />
              <Skeleton width="45%" />
            </div>
          </div>
          <Skeleton variant="circle" width="36px" height="36px" />
          <Skeleton variant="pill" width="96px" height="36px" />
          <Skeleton variant="pill" width="72px" height="24px" />
        </SkeletonGroup>
      </Demo>

      <Demo title="Spinner">
        <Spinner />
        <Spinner size="lg" />
        <Spinner label="Uploading" />
        <Button variant="primary" busy>
          Save changes
        </Button>
      </Demo>

      <Demo
        title="Meter"
        layout="stack"
        note="The bar turns to the attention colour from 80 per cent and to the danger colour from 95 per cent. The reading is always written out."
      >
        <div className="tx-sg-columns">
          <Meter
            label="Storage"
            value={1.2 * GIGABYTE}
            max={5 * GIGABYTE}
            valueText={`1.2 GB of 5 GB used (${meterPercentLabel(1.2 / 5)})`}
          />
          <Meter
            label="Storage"
            value={4.3 * GIGABYTE}
            max={5 * GIGABYTE}
            valueText={`4.3 GB of 5 GB used (${meterPercentLabel(4.3 / 5)})`}
            note={
              <>
                <Icon icon={TriangleExclamationPoint} size={16} /> Nearly full.
              </>
            }
          />
          <Meter
            label="Storage"
            value={(used ? 5 : 4.9) * GIGABYTE}
            max={5 * GIGABYTE}
            valueText={`${used ? '5' : '4.9'} GB of 5 GB used (${meterPercentLabel(used ? 1 : 4.9 / 5)})`}
            note="Uploads are refused when the library is full."
          />
        </div>
        <div className="tx-cluster">
          <Meter
            variant="inline"
            label="Storage"
            value={1.2 * GIGABYTE}
            max={5 * GIGABYTE}
            valueText="1.2 GB of 5 GB"
          />
          <Switch checked={used} onChange={setUsed} label="Fill the third meter" />
        </div>
      </Demo>
    </Section>
  );
}

export function NavigationSection() {
  return (
    <Section
      id="navigation"
      title="Navigation and help"
      lead="A back link sits above an editor page's title. A tooltip shows on hover and on keyboard focus after 400 ms, and is never the only place a label exists."
    >
      <Demo title="Back link and breadcrumb" layout="stack">
        <div>
          <BackLink to="/playlists">All playlists</BackLink>
          <p className="tx-h1">Reception loop</p>
        </div>
        <Breadcrumb
          items={[
            { label: 'Settings', to: '/settings' },
            { label: 'Tags', to: '/settings/tags' },
            { label: 'Media tags' },
          ]}
        />
      </Demo>

      <Demo
        title="Tooltip"
        note={
          <>
            <Kbd>Esc</Kbd> dismisses a tooltip. The pointer can move onto it without it closing.
          </>
        }
      >
        <Tooltip content="Above, the default">
          <Button variant="secondary">Top</Button>
        </Tooltip>
        <Tooltip content="Below the control" placement="bottom">
          <Button variant="secondary">Bottom</Button>
        </Tooltip>
        <Tooltip content="At the start" placement="left">
          <Button variant="secondary">Left</Button>
        </Tooltip>
        <Tooltip content="At the end" placement="right">
          <Button variant="secondary">Right</Button>
        </Tooltip>
        <Tooltip content="Push is held while there are unsaved changes" describe>
          <Button variant="primary" icon={Send} aria-disabled="true">
            Push now
          </Button>
        </Tooltip>
        <StatusPill tone="neutral">Planned</StatusPill>
      </Demo>

      <Demo
        title="Glass"
        layout="page"
        note="The sticky page header uses this fill over the page background; the sidebar sits flat on the page. It falls back to a solid surface where the system asks for reduced transparency."
      >
        <div className="tx-sg-glass-stage">
          <div className="tx-sg-glass-stage__art" aria-hidden="true" />
          <div className="tx-glass tx-sg-glass-stage__bar">
            <span className="tx-h2">Media library</span>
            <Button variant="primary" icon={Send}>
              Push to screens
            </Button>
          </div>
        </div>
      </Demo>
    </Section>
  );
}
