import { describe, expect, it } from 'vitest';
import { ManifestV5Schema, manifestZones } from '@tinnox/contracts';
import {
  ID,
  bandZones,
  display,
  planLayout,
  planSchedule,
  route,
  type FixturePlaylist,
} from './fixtures.test-support.ts';
import { planLayoutPublication } from './layout.ts';
import { buildManifest, manifestVersionFor, type PlanPublicationResult } from './manifest.ts';
import type { DraftItem, PublicationDraft, PublishIssue } from './types.ts';

const image = (mediaId: string, durationMs = 5000): DraftItem => ({
  mediaId,
  durationMs,
  fit: null,
});
const video = (mediaId: string): DraftItem => ({ mediaId, durationMs: null, fit: null });

const MAIN: FixturePlaylist = {
  name: 'Reception loop',
  items: [image(ID.jpeg), video(ID.video)],
  playback: { transition: 'fade', shuffle: false },
};
const BAND: FixturePlaylist = {
  name: 'Ticker',
  items: [{ appId: ID.ticker, durationMs: 10_000 }],
  playback: { transition: 'cut', shuffle: true },
};
const PLAYLISTS = { [ID.listDefault]: MAIN, [ID.listBand]: BAND };
const ZONES = bandZones(15, ID.listDefault, ID.listBand);
const ROUTE = route(200, 4);

function draftOf(plan: PlanPublicationResult): PublicationDraft {
  if (!plan.ok) throw new Error(`expected a draft, got ${plan.issues[0]?.code}`);
  return plan.draft;
}
function issuesOf(plan: PlanPublicationResult): readonly PublishIssue[] {
  if (plan.ok) throw new Error('expected a refusal');
  return plan.issues;
}
/** The draft of one playlist on its own. */
const alone = (id: string) =>
  draftOf(planSchedule(PLAYLISTS, { defaultPlaylistId: id, events: [] }));

describe('planLayoutPublication', () => {
  it('puts every zone into one list, the main zone first, with its rectangle and options', () => {
    const draft = draftOf(planLayout(PLAYLISTS, ZONES, { route: ROUTE }));
    expect(draft.items).toEqual([...alone(ID.listDefault).items, ...alone(ID.listBand).items]);
    expect(draft.zones).toEqual([
      {
        rect: { x: 0, y: 0, width: 1920, height: 918 },
        count: 2,
        transition: 'fade',
        shuffle: false,
      },
      {
        rect: { x: 0, y: 918, width: 1920, height: 162 },
        count: 1,
        transition: 'cut',
        shuffle: true,
      },
    ]);
    // Everything else is the main zone's draft.
    expect({ ...draft, items: null, zones: null }).toEqual({
      ...alone(ID.listDefault),
      items: null,
    });
    expect(manifestVersionFor(draft)).toBe(5);
    const manifest = buildManifest(draft, {
      publicationId: ID.pubA,
      createdAt: new Date('2026-11-18T00:00:00.000Z'),
    });
    expect(ManifestV5Schema.safeParse(manifest).success).toBe(true);
    expect(manifest).toMatchObject({ schemaVersion: 5, transition: 'fade', shuffle: false });
    expect(manifestZones(manifest).map((view) => view.contentRect)).toEqual(
      draft.zones?.map((zone) => zone.rect),
    );
  });

  it('resolves the zones inside the content rectangle of each screen', () => {
    const target = display({ contentRect: { x: 100, y: 50, width: 1000, height: 500 } });
    const draft = draftOf(planLayout(PLAYLISTS, ZONES, { route: ROUTE, display: target }));
    expect(draft.zones?.map((zone) => zone.rect)).toEqual([
      { x: 100, y: 50, width: 1000, height: 425 },
      { x: 100, y: 475, width: 1000, height: 75 },
    ]);
    const portrait = display({ canvas: { width: 1080, height: 1920 } });
    const tall = draftOf(planLayout(PLAYLISTS, ZONES, { route: ROUTE, display: portrait }));
    expect(tall.zones?.map((zone) => zone.rect)).toEqual([
      { x: 0, y: 0, width: 1080, height: 1632 },
      { x: 0, y: 1632, width: 1080, height: 288 },
    ]);
  });

  it('plans and sends a playlist used in two zones twice, whatever the letter case of its id', () => {
    const asked: string[] = [];
    let planned = 0;
    const plan = planLayoutPublication({
      canvas: { width: 1920, height: 1080 },
      contentRect: null,
      zones: bandZones(15, ID.listDefault.toUpperCase(), ID.listDefault),
      planPlaylist: (id) => {
        asked.push(id);
        return {
          name: MAIN.name,
          itemCount: MAIN.items.length,
          plan: () => {
            planned += 1;
            return { ok: true, draft: alone(ID.listDefault) };
          },
        };
      },
      route: ROUTE,
    });
    expect(asked).toEqual([ID.listDefault, ID.listDefault]);
    expect(planned).toBe(2);
    const draft = draftOf(plan);
    const items = alone(ID.listDefault).items;
    expect(draft.items).toEqual([...items, ...items]);
    expect(draft.zones?.map((zone) => zone.count)).toEqual([2, 2]);
    // The repeats carry the same facts, so the manifest parses.
    expect(() =>
      buildManifest(draft, { publicationId: ID.pubA, createdAt: new Date() }),
    ).not.toThrow();
  });

  it('blocks a screen on which a zone is under 16 px, and plans nothing', () => {
    let planned = 0;
    const small = display({ canvas: { width: 192, height: 96 } });
    const counting = (zones = bandZones(10, ID.listDefault, ID.listBand)) =>
      planLayoutPublication({
        canvas: small.canvas,
        contentRect: null,
        zones,
        planPlaylist: () => ({
          name: MAIN.name,
          itemCount: 1,
          plan: () => {
            planned += 1;
            return { ok: true, draft: alone(ID.listDefault) };
          },
        }),
        route: ROUTE,
      });
    expect(issuesOf(counting())).toEqual([
      {
        index: null,
        code: 'zone_too_small',
        path: 'zones[1]',
        message:
          'On this screen zone 2 of the layout is 192 × 10 px; a zone needs at least 16 px each way. Make it larger in the layout, or assign other content.',
      },
    ]);
    expect(planned).toBe(0);
    // A 20 % band is 19 px tall on the same screen, and plays.
    const draft = draftOf(
      planLayout(PLAYLISTS, bandZones(20, ID.listDefault, ID.listBand), {
        route: ROUTE,
        display: small,
      }),
    );
    expect(draft.zones?.[1]?.rect).toEqual({ x: 0, y: 77, width: 192, height: 19 });
    // Every zone that is too small is named; the main zone is zone 1.
    const thin = [
      { playlistId: ID.listDefault, x: 0, y: 0, width: 10_000, height: 1000 },
      { playlistId: ID.listBand, x: 0, y: 9000, width: 10_000, height: 1000 },
    ];
    expect(issuesOf(counting(thin)).map((issue) => issue.path)).toEqual(['zones[0]', 'zones[1]']);
    expect(planned).toBe(0);
  });

  it('refuses a zone whose playlist no longer exists', () => {
    const plan = planLayout(
      { [ID.listDefault]: MAIN },
      bandZones(15, ID.listDefault, ID.listLunch),
      { route: ROUTE },
    );
    expect(issuesOf(plan)).toEqual([
      {
        index: null,
        code: 'playlist_empty',
        path: 'zones[1].playlist',
        message: 'A playlist of this layout no longer exists. Open the layout and choose another.',
      },
    ]);
  });

  it('keeps the item number of the zone playlist that holds a problem', () => {
    const plan = planLayout(
      { ...PLAYLISTS, [ID.listBand]: { name: 'Ticker', items: [image(ID.processing)] } },
      ZONES,
      { route: ROUTE },
    );
    const issues = issuesOf(plan);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      index: 0,
      code: 'media_not_ready',
      path: 'zones[1].items[0]',
    });
    expect(issues[0]?.message).toMatch(/^In playlist "Ticker": /);
    // An empty zone playlist is refused by its own plan.
    const empty = planLayout(
      { ...PLAYLISTS, [ID.listBand]: { name: 'Ticker', items: [] } },
      ZONES,
      { route: ROUTE },
    );
    expect(issuesOf(empty)).toMatchObject([{ code: 'playlist_empty', path: 'zones[1].playlist' }]);
  });

  it('refuses a layout whose playlists hold more items together than the route takes', () => {
    const many = (name: string): FixturePlaylist => ({
      name,
      items: Array.from({ length: 150 }, () => image(ID.jpeg)),
    });
    const playlists = { [ID.listDefault]: many('Reception loop'), [ID.listBand]: many('Ticker') };
    expect(issuesOf(planLayout(playlists, ZONES, { route: route(200, 4) }))).toEqual([
      {
        index: null,
        code: 'too_many_items',
        path: 'layout',
        message:
          'The playlists of this layout hold 300 items in total; The browser player supports up to 200.',
      },
    ]);
    expect(draftOf(planLayout(playlists, ZONES, { route: route(300, 4) })).items).toHaveLength(300);
  });

  it('lets the route judge the combined draft: a route with one region refuses a layout', () => {
    expect(issuesOf(planLayout(PLAYLISTS, ZONES, { route: route(200, 1) }))).toEqual([
      {
        index: null,
        code: 'multiple_regions_unsupported',
        path: 'layout',
        message: 'The browser player can show 1 content region(s); this publication needs 2.',
      },
    ]);
  });
});
