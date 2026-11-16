import type { MediaDto } from '@tinnox/contracts';

/** A UUID made of one repeated digit, valid for the contracts' id schemas. */
export const ID = (n: number): string => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;

const T = '2026-11-14T03:00:00.000Z';

/** A ready media item; `change` overrides any field. */
export function media(
  n: number,
  kind: 'image' | 'video',
  change: Partial<MediaDto> = {},
): MediaDto {
  const name = `file-${n}.${kind === 'image' ? 'png' : 'mp4'}`;
  return {
    id: ID(n),
    kind,
    status: 'ready',
    name,
    originalName: name,
    description: null,
    defaultDurationMs: null,
    availableFrom: null,
    availableUntil: null,
    folderId: null,
    tagIds: [],
    usageCount: 0,
    mimeType: kind === 'image' ? 'image/png' : 'video/mp4',
    bytes: 1000 * n,
    sha256: 'a'.repeat(64),
    width: 1920,
    height: 1080,
    durationMs: kind === 'video' ? 12_500 : null,
    codec: kind === 'video' ? 'h264' : null,
    errorCode: null,
    errorDetail: null,
    createdAt: T,
    updatedAt: T,
    ...change,
  };
}
