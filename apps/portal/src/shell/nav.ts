/**
 * Navigation data for the shell (docs/portal-v2/stage-a.md, section 1): what the sidebar and
 * the account menu list, in order, and the pure rules that decide which entry is current.
 * No DOM and no React here; `Sidebar.tsx` and `AccountMenu.tsx` render it.
 */
import {
  AudioLines,
  Blocks,
  CalendarDays,
  FileText,
  Film,
  FolderOpen,
  Globe,
  Image,
  Images,
  LayoutDashboard,
  LayoutTemplate,
  ListVideo,
  Monitor,
  ScrollText,
  Settings,
  Users,
  type IconComponent,
} from '../ui/icons.ts';

/** The product name, as written in the document title and next to the wordmark. */
export const PRODUCT_NAME = 'TINNOX CMS';

/** Where the wordmark, the index route and the "page not found" links lead. */
export const HOME_PATH = '/dashboard';

export interface NavLinkItem {
  readonly kind: 'link';
  /** Stable id; also the value `activeNavId` returns. */
  readonly id: string;
  readonly label: string;
  /** In-app route, without a trailing slash. */
  readonly to: string;
  readonly icon: IconComponent;
  /** The page behind the entry is a Planned page: the entry carries a "Planned" pill. */
  readonly planned?: boolean;
}

export interface NavGroupItem {
  readonly kind: 'group';
  readonly id: string;
  readonly label: string;
  readonly icon: IconComponent;
  readonly children: readonly NavLinkItem[];
}

export type NavItem = NavLinkItem | NavGroupItem;

/** Sidebar, top to bottom. */
export const PRIMARY_NAV: readonly NavItem[] = [
  { kind: 'link', id: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  {
    kind: 'group',
    id: 'media',
    label: 'Media',
    icon: FolderOpen,
    children: [
      { kind: 'link', id: 'media-all', label: 'All media', to: '/media', icon: Images },
      { kind: 'link', id: 'media-images', label: 'Images', to: '/media/images', icon: Image },
      { kind: 'link', id: 'media-videos', label: 'Videos', to: '/media/videos', icon: Film },
      {
        kind: 'link',
        id: 'media-audio',
        label: 'Audio',
        to: '/media/audio',
        icon: AudioLines,
        planned: true,
      },
      {
        kind: 'link',
        id: 'media-documents',
        label: 'Documents',
        to: '/media/documents',
        icon: FileText,
        planned: true,
      },
      {
        kind: 'link',
        id: 'media-web-pages',
        label: 'Web pages',
        to: '/media/web-pages',
        icon: Globe,
        planned: true,
      },
    ],
  },
  { kind: 'link', id: 'apps', label: 'Apps', to: '/apps', icon: Blocks },
  { kind: 'link', id: 'playlists', label: 'Playlists', to: '/playlists', icon: ListVideo },
  {
    kind: 'link',
    id: 'layouts',
    label: 'Layouts',
    to: '/layouts',
    icon: LayoutTemplate,
    planned: true,
  },
  { kind: 'link', id: 'schedules', label: 'Schedules', to: '/schedules', icon: CalendarDays },
  { kind: 'link', id: 'screens', label: 'Screens', to: '/screens', icon: Monitor },
];

/** Sidebar, bottom. */
export const FOOTER_NAV: readonly NavLinkItem[] = [
  { kind: 'link', id: 'settings', label: 'Settings', to: '/settings', icon: Settings },
];

/** Account menu, above "Sign out". */
export const ACCOUNT_NAV: readonly NavLinkItem[] = [
  { kind: 'link', id: 'account-settings', label: 'Settings', to: '/settings', icon: Settings },
  { kind: 'link', id: 'account-users', label: 'Users', to: '/users', icon: Users, planned: true },
  { kind: 'link', id: 'account-audit', label: 'Audit log', to: '/audit', icon: ScrollText },
];

/** Every sidebar link, groups flattened, in reading order. */
export function sidebarLinks(): readonly NavLinkItem[] {
  return [
    ...PRIMARY_NAV.flatMap((item) => (item.kind === 'group' ? item.children : [item])),
    ...FOOTER_NAV,
  ];
}

/** A path without its trailing slashes; the root stays `/`. */
export function normalisePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/u, '');
  return trimmed === '' ? '/' : trimmed;
}

/** True when `pathname` is the route `to` or a page below it. */
export function isAtOrBelow(pathname: string, to: string): boolean {
  const path = normalisePath(pathname);
  return path === to || path.startsWith(`${to}/`);
}

/**
 * The id of the sidebar link that is current for a path, or null when no sidebar entry
 * covers it (the audit log and Users are reached from the account menu).
 *
 * The deepest matching link wins, so `/media/images` is Images while `/media/<id>` (a media
 * item's page) is All media, and `/settings/tags` is Settings.
 */
export function activeNavId(pathname: string): string | null {
  let best: NavLinkItem | null = null;
  for (const link of sidebarLinks()) {
    if (!isAtOrBelow(pathname, link.to)) continue;
    if (best === null || link.to.length > best.to.length) best = link;
  }
  return best?.id ?? null;
}

/** The id of the sidebar group that holds the current link, or null. */
export function activeGroupId(pathname: string): string | null {
  const active = activeNavId(pathname);
  if (active === null) return null;
  for (const item of PRIMARY_NAV) {
    if (item.kind === 'group' && item.children.some((child) => child.id === active)) {
      return item.id;
    }
  }
  return null;
}

/**
 * The address under `/screens` of an M0 address under `/displays`. An operator sees "screen"
 * everywhere (decision P2-03), so the pages moved; old links and bookmarks are redirected.
 * `/displays-archive` is not such an address and is returned unchanged.
 */
export function screensPathFor(pathname: string): string {
  return pathname.replace(/^\/displays(?=\/|$)/u, '/screens');
}

/** What an entry is called where only its name fits (a tooltip, an accessible name). */
export function navItemName(item: NavLinkItem): string {
  return item.planned === true ? `${item.label} (planned)` : item.label;
}

/** The document title of a page: "Playlists · TINNOX CMS". */
export function documentTitle(pageTitle: string): string {
  const title = pageTitle.trim();
  return title === '' ? PRODUCT_NAME : `${title} · ${PRODUCT_NAME}`;
}
