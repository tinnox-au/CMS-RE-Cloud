import type { ManifestAssetV1 } from '@tinnox/contracts';
import { PlayerFault } from '../core/errors.ts';

/** Lower-case hex SHA-256 of a blob, computed by WebCrypto. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Stops a video element from holding its source, decoder and network/blob reference. */
export function releaseVideo(video: HTMLVideoElement): void {
  try {
    video.pause();
  } catch {
    // Already torn down.
  }
  video.removeAttribute('src');
  video.load();
}

export const PROBE_TIMEOUT_MS = 20_000;

/**
 * Checks that the browser can really decode the bytes, before a publication is
 * allowed to become active. Images are decoded with createImageBitmap; videos must
 * reach `canplay` in a detached, muted element within the timeout.
 */
export async function probeAsset(
  asset: ManifestAssetV1,
  blob: Blob,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<void> {
  if (asset.kind === 'image') {
    try {
      const bitmap = await createImageBitmap(blob);
      const empty = bitmap.width === 0 || bitmap.height === 0;
      bitmap.close();
      if (empty) throw new Error('image has no pixels');
    } catch (err) {
      throw new PlayerFault('decode_failed', 'this browser cannot decode the image', {
        assetId: asset.assetId,
        cause: err,
      });
    }
    return;
  }

  const video = document.createElement('video');
  if (video.canPlayType(asset.mediaType) === '') {
    throw new PlayerFault('unsupported_media', `this browser cannot play ${asset.mediaType}`, {
      assetId: asset.assetId,
    });
  }
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new PlayerFault('decode_failed', 'video did not become playable in time', {
            assetId: asset.assetId,
          }),
        );
      }, timeoutMs);
      video.addEventListener(
        'canplay',
        () => {
          clearTimeout(timer);
          if (video.videoWidth === 0 || video.videoHeight === 0) {
            reject(
              new PlayerFault('unsupported_media', 'video has no decodable picture track', {
                assetId: asset.assetId,
              }),
            );
          } else {
            resolve();
          }
        },
        { once: true },
      );
      video.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          const unsupported = video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
          reject(
            new PlayerFault(
              unsupported ? 'unsupported_media' : 'decode_failed',
              unsupported
                ? 'this browser does not support the video format or codec'
                : 'this browser cannot decode the video',
              { assetId: asset.assetId },
            ),
          );
        },
        { once: true },
      );
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = url;
      video.load();
    });
  } finally {
    releaseVideo(video);
    URL.revokeObjectURL(url);
  }
}
