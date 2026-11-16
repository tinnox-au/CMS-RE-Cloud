import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { inspectFile, type Limits } from './inspect.ts';

const limits: Limits = {
  maxBytes: 10 * 1024 * 1024,
  maxImageSidePx: 8192,
  maxImagePixels: 40_000_000,
  maxVideoWidthPx: 3840,
  maxVideoHeightPx: 2160,
  maxVideoDurationMs: 600_000,
  timeoutMs: 30_000,
};
const dir = mkdtempSync(join(tmpdir(), 'tinnox-inspect-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function inspect(name: string, bytes: Buffer) {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  const result = await inspectFile(path, limits, 30_000);
  if (result.outcome !== 'accepted' || result.thumbnail === null) {
    throw new Error(`expected an accepted image with a thumbnail, got ${JSON.stringify(result)}`);
  }
  return { result, thumb: await sharp(result.thumbnail).metadata() };
}

describe('image thumbnail', () => {
  it('is a JPEG with the long side at 480 px, alpha flattened', async () => {
    const png = await sharp({
      create: { width: 1000, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const { result, thumb } = await inspect('wide.png', png);
    expect(result).toMatchObject({ mimeType: 'image/png', width: 1000, height: 500 });
    expect(thumb).toMatchObject({ format: 'jpeg', width: 480, height: 240, hasAlpha: false });
  });

  it('is upright for an EXIF-rotated JPEG and never enlarged', async () => {
    const jpeg = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#336699' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const { result, thumb } = await inspect('turned.jpg', jpeg);
    expect(result).toMatchObject({ width: 100, height: 200 });
    expect(thumb).toMatchObject({ format: 'jpeg', width: 100, height: 200 });
  });
});
