import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_NAV,
  FOOTER_NAV,
  PRIMARY_NAV,
  activeGroupId,
  activeNavId,
  documentTitle,
  isAtOrBelow,
  navItemName,
  normalisePath,
  screensPathFor,
  sidebarLinks,
} from './nav.ts';

describe('navigation data', () => {
  it('lists the sidebar in the order of the stage A specification', () => {
    expect(PRIMARY_NAV.map((item) => item.label)).toEqual([
      'Dashboard',
      'Media',
      'Apps',
      'Playlists',
      'Layouts',
      'Schedules',
      'Screens',
    ]);
    const media = PRIMARY_NAV.find((item) => item.kind === 'group');
    expect(media?.kind === 'group' ? media.children.map((child) => child.label) : []).toEqual([
      'All media',
      'Images',
      'Videos',
      'Audio',
      'Documents',
      'Web pages',
    ]);
    expect(FOOTER_NAV.map((item) => item.label)).toEqual(['Settings']);
  });

  it('marks exactly the entries whose page is a Planned page', () => {
    const planned = sidebarLinks()
      .filter((link) => link.planned === true)
      .map((link) => link.to);
    expect(planned).toEqual(['/media/audio', '/media/documents', '/media/web-pages', '/layouts']);
    // Built in stage B, slice 3.
    expect(sidebarLinks().find((link) => link.to === '/schedules')?.planned).toBeUndefined();
  });

  it('lists the account menu as Settings, Users, Audit log', () => {
    expect(ACCOUNT_NAV.map((item) => [item.label, item.to])).toEqual([
      ['Settings', '/settings'],
      ['Users', '/users'],
      ['Audit log', '/audit'],
    ]);
    expect(ACCOUNT_NAV.find((item) => item.to === '/users')?.planned).toBe(true);
  });

  it('gives every link a unique id and a route without a trailing slash', () => {
    const links = [...sidebarLinks(), ...ACCOUNT_NAV];
    expect(new Set(links.map((link) => link.id)).size).toBe(links.length);
    for (const link of links) {
      expect(link.to).toMatch(/^\/[a-z-]+(\/[a-z-]+)?$/u);
    }
  });
});

describe('normalisePath', () => {
  it('drops trailing slashes and keeps the root', () => {
    expect(normalisePath('/media/')).toBe('/media');
    expect(normalisePath('/media//')).toBe('/media');
    expect(normalisePath('/')).toBe('/');
    expect(normalisePath('')).toBe('/');
  });
});

describe('isAtOrBelow', () => {
  it('matches the route and pages below it, on whole segments only', () => {
    expect(isAtOrBelow('/screens', '/screens')).toBe(true);
    expect(isAtOrBelow('/screens/new', '/screens')).toBe(true);
    expect(isAtOrBelow('/screens/', '/screens')).toBe(true);
    expect(isAtOrBelow('/screens-old', '/screens')).toBe(false);
    expect(isAtOrBelow('/', '/screens')).toBe(false);
  });
});

describe('activeNavId', () => {
  it.each([
    ['/dashboard', 'dashboard'],
    ['/media', 'media-all'],
    ['/media/', 'media-all'],
    ['/media/images', 'media-images'],
    ['/media/videos', 'media-videos'],
    ['/media/audio', 'media-audio'],
    ['/media/documents', 'media-documents'],
    ['/media/web-pages', 'media-web-pages'],
    // A media item's own page belongs to the whole library.
    ['/media/0b6f1c1e-6c1e-4b7e-9a51-0d6f3c1f2a10', 'media-all'],
    ['/apps', 'apps'],
    ['/playlists', 'playlists'],
    ['/playlists/0b6f1c1e-6c1e-4b7e-9a51-0d6f3c1f2a10', 'playlists'],
    ['/layouts', 'layouts'],
    ['/schedules', 'schedules'],
    ['/schedules/0b6f1c1e-6c1e-4b7e-9a51-0d6f3c1f2a10', 'schedules'],
    ['/screens', 'screens'],
    ['/screens/new', 'screens'],
    ['/screens/0b6f1c1e-6c1e-4b7e-9a51-0d6f3c1f2a10', 'screens'],
    ['/settings', 'settings'],
    ['/settings/tags', 'settings'],
  ])('%s is %s', (path, id) => {
    expect(activeNavId(path)).toBe(id);
  });

  it('is null where the sidebar has no entry', () => {
    expect(activeNavId('/')).toBeNull();
    expect(activeNavId('/audit')).toBeNull();
    expect(activeNavId('/users')).toBeNull();
    expect(activeNavId('/nowhere')).toBeNull();
    expect(activeNavId('/mediax')).toBeNull();
  });
});

describe('activeGroupId', () => {
  it('names the Media group on every media route and nowhere else', () => {
    expect(activeGroupId('/media')).toBe('media');
    expect(activeGroupId('/media/web-pages')).toBe('media');
    expect(activeGroupId('/media/0b6f1c1e-6c1e-4b7e-9a51-0d6f3c1f2a10')).toBe('media');
    expect(activeGroupId('/playlists')).toBeNull();
    expect(activeGroupId('/audit')).toBeNull();
  });
});

describe('navItemName', () => {
  it('says when an entry is planned', () => {
    const links = sidebarLinks();
    const layouts = links.find((link) => link.id === 'layouts');
    const playlists = links.find((link) => link.id === 'playlists');
    expect(layouts === undefined ? '' : navItemName(layouts)).toBe('Layouts (planned)');
    expect(playlists === undefined ? '' : navItemName(playlists)).toBe('Playlists');
  });
});

describe('documentTitle', () => {
  it('puts the page before the product name', () => {
    expect(documentTitle('Playlists')).toBe('Playlists · TINNOX CMS');
    expect(documentTitle('  Foyer loop ')).toBe('Foyer loop · TINNOX CMS');
  });

  it('falls back to the product name', () => {
    expect(documentTitle('')).toBe('TINNOX CMS');
    expect(documentTitle('   ')).toBe('TINNOX CMS');
  });
});

describe('screensPathFor', () => {
  it.each([
    ['/displays', '/screens'],
    ['/displays/', '/screens/'],
    ['/displays/new', '/screens/new'],
    [
      '/displays/0b6f1c1e-6c1e-4b7e-9a51-0d6f3c1f2a10/edit',
      '/screens/0b6f1c1e-6c1e-4b7e-9a51-0d6f3c1f2a10/edit',
    ],
  ])('moves %s to %s', (from, to) => {
    expect(screensPathFor(from)).toBe(to);
  });

  it('leaves other addresses alone', () => {
    expect(screensPathFor('/displays-archive')).toBe('/displays-archive');
    expect(screensPathFor('/media/displays')).toBe('/media/displays');
    expect(screensPathFor('/screens')).toBe('/screens');
  });
});
