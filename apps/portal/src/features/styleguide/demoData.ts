import { useEffect, useState } from 'react';
import type { TagColour } from '../../ui/index.ts';

/**
 * Synthetic rows for the style guide. Every name, number and date here is made up; nothing
 * comes from the API or from a real installation.
 */

export interface DemoTag {
  readonly id: string;
  readonly name: string;
  readonly colour: TagColour;
}

export const DEMO_TAGS: readonly DemoTag[] = [
  { id: 'tag-foyer', name: 'Foyer', colour: 'teal' },
  { id: 'tag-retail', name: 'Retail', colour: 'amber' },
  { id: 'tag-wayfinding', name: 'Wayfinding', colour: 'sky' },
  { id: 'tag-seasonal', name: 'Seasonal', colour: 'pink' },
  { id: 'tag-safety', name: 'Safety', colour: 'red' },
  { id: 'tag-events', name: 'Events', colour: 'violet' },
  { id: 'tag-brand', name: 'Brand', colour: 'green' },
  { id: 'tag-archive', name: 'Archive', colour: 'slate' },
];

export type DemoMediaStatus = 'ready' | 'processing' | 'failed';

export interface DemoMedia {
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  readonly kind: 'image' | 'video';
  readonly width: number;
  readonly height: number;
  /** Video length in milliseconds; null for images. */
  readonly durationMs: number | null;
  readonly bytes: number;
  readonly tagIds: readonly string[];
  readonly modifiedAt: string;
  readonly status: DemoMediaStatus;
  /** Index into the generated thumbnails. */
  readonly art: number;
}

const NAMES: readonly (readonly [string, 'image' | 'video', number, number])[] = [
  ['Foyer welcome loop', 'video', 1920, 1080],
  ['Atrium ribbon, spring range', 'video', 3840, 480],
  ['Opening hours board', 'image', 1080, 1920],
  ['Level 2 wayfinding map', 'image', 3840, 2160],
  ['Cafe menu, breakfast', 'image', 1920, 1080],
  ['Cafe menu, lunch', 'image', 1920, 1080],
  ['Safety induction reminder', 'image', 1920, 1080],
  ['Workshop open day teaser', 'video', 1920, 1080],
  ['Brand pattern, deep teal', 'image', 2560, 1440],
  ['Lift lobby notices', 'image', 1080, 1920],
  ['Showroom product reel', 'video', 3840, 2160],
  ['Queue screen backdrop', 'image', 1920, 1080],
  ['End of financial year sale', 'image', 1920, 1080],
  ['Car park directions', 'image', 1920, 540],
  ['Reception desk slideshow frame', 'image', 1920, 1080],
  ['Winter trading hours', 'image', 1080, 1920],
  ['Street-facing LED strip, weekday', 'video', 4608, 384],
  ['Street-facing LED strip, weekend', 'video', 4608, 384],
  ['Staff recognition wall', 'image', 2160, 3840],
  ['Loading dock schedule', 'image', 1920, 1080],
  ['Kiosk attract loop', 'video', 1080, 1920],
  ['Emergency assembly map', 'image', 1920, 1080],
  ['Meeting room door sign', 'image', 1280, 800],
];

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A small repeatable sequence, so the table looks the same on every load. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function buildMedia(): DemoMedia[] {
  const next = sequence(20261115);
  const start = Date.parse('2026-11-14T02:30:00.000Z');
  return NAMES.map(([name, kind, width, height], index) => {
    const tagCount = Math.floor(next() * 3);
    const tagIds: string[] = [];
    for (let pick = 0; pick < tagCount; pick += 1) {
      const tag = DEMO_TAGS[Math.floor(next() * DEMO_TAGS.length)];
      if (tag !== undefined && !tagIds.includes(tag.id)) tagIds.push(tag.id);
    }
    const megabytes = kind === 'video' ? 18 + next() * 160 : 0.4 + next() * 7;
    let status: DemoMediaStatus = 'ready';
    if (index === 3) status = 'processing';
    if (index === 10) status = 'failed';
    return {
      id: `demo-media-${String(index + 1).padStart(2, '0')}`,
      name,
      fileName: `${slug(name)}.${kind === 'video' ? 'mp4' : index % 3 === 0 ? 'png' : 'jpg'}`,
      kind,
      width,
      height,
      durationMs: kind === 'video' ? Math.round((8 + next() * 80) * 1000) : null,
      bytes: Math.round(megabytes * 1024 * 1024),
      tagIds,
      modifiedAt: new Date(start - index * 7.3 * 3_600_000 - next() * 3_600_000).toISOString(),
      status,
      art: index,
    };
  });
}

export const DEMO_MEDIA: readonly DemoMedia[] = buildMedia();

/** Storage figures for the meter demos, in bytes. */
export const DEMO_STORAGE = {
  limitBytes: 5 * 1024 ** 3,
  usedBytes: DEMO_MEDIA.reduce((sum, item) => sum + item.bytes, 0),
};

const PALETTES: readonly (readonly [string, string, string])[] = [
  ['#0f4761', '#72afc2', '#dce9ed'],
  ['#12212a', '#2c7fb8', '#f0c267'],
  ['#1b6e45', '#6fd3a0', '#eff5f7'],
  ['#7257c9', '#f08fb9', '#fbf1dc'],
  ['#a86a00', '#f0c267', '#12212a'],
  ['#0d384d', '#5cc0cc', '#ffffff'],
];

function drawArt(index: number, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return canvas;
  const next = sequence(977 + index * 131);
  const [from, to, accent] = PALETTES[index % PALETTES.length] ?? ['#0f4761', '#72afc2', '#fff'];
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  // A few soft shapes, so no two thumbnails look alike.
  for (let shape = 0; shape < 5; shape += 1) {
    context.globalAlpha = 0.12 + next() * 0.2;
    context.fillStyle = shape % 2 === 0 ? accent : to;
    const x = next() * width;
    const y = next() * height;
    const size = (0.15 + next() * 0.35) * Math.max(width, height);
    context.beginPath();
    if (shape % 3 === 0) context.rect(x - size / 2, y - size / 4, size, size / 2);
    else context.arc(x, y, size / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  return canvas;
}

/**
 * Generated pictures for the thumbnail demos, as `blob:` addresses (the only image source
 * besides the portal's own origin that the Content-Security-Policy allows). Empty until the
 * pictures have been drawn; the addresses are released when the page goes away.
 */
export function useDemoArt(count: number): readonly string[] {
  const [urls, setUrls] = useState<readonly string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    const jobs = Array.from(
      { length: count },
      (_, index) =>
        new Promise<string | null>((resolve) => {
          drawArt(index, 480, 270).toBlob((blob) => {
            resolve(blob === null ? null : URL.createObjectURL(blob));
          }, 'image/png');
        }),
    );
    void Promise.all(jobs).then((results) => {
      for (const url of results) if (url !== null) created.push(url);
      if (cancelled) {
        for (const url of created) URL.revokeObjectURL(url);
        return;
      }
      setUrls(results.map((url) => url ?? ''));
    });
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [count]);
  return urls;
}
