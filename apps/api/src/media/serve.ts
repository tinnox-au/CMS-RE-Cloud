/**
 * Streams a private stored object with Range support and defensive headers.
 * Used by the operator preview and by the player media endpoint. The caller
 * has already authorised the request and proved the key belongs to the tenant.
 */
import { Readable } from 'node:stream';
import type { MediaMimeType } from '@tinnox/contracts';
import {
  contentRangeHeader,
  keyBelongsToOrg,
  parseRangeHeader,
  StorageError,
  unsatisfiableContentRangeHeader,
  type ObjectStorage,
} from '@tinnox/storage';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError, notFound } from '../errors.ts';

const EXTENSIONS: Readonly<Record<MediaMimeType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
};

export interface ServeObjectInput {
  readonly storage: ObjectStorage;
  readonly orgId: string;
  readonly storageKey: string;
  readonly mimeType: MediaMimeType;
  readonly sha256: string;
  /** Used only to build a neutral download name; the uploaded file name is never echoed. */
  readonly mediaId: string;
  readonly cacheControl: string;
}

export async function serveObject(
  request: FastifyRequest,
  reply: FastifyReply,
  input: ServeObjectInput,
): Promise<FastifyReply> {
  if (!keyBelongsToOrg(input.storageKey, input.orgId)) {
    request.log.error(
      { mediaId: input.mediaId },
      'storage key does not belong to the organisation',
    );
    throw notFound('The media file');
  }
  const etag = `"${input.sha256}"`;
  void reply
    .header('etag', etag)
    .header('cache-control', input.cacheControl)
    .header('accept-ranges', 'bytes')
    .header('x-content-type-options', 'nosniff')
    // The bytes are never a document: no scripts, no plugins, no embedding context.
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header(
      'content-disposition',
      `inline; filename="tinnox-${input.mediaId}.${EXTENSIONS[input.mimeType]}"`,
    );

  const ifNoneMatch = request.headers['if-none-match'];
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((v) => v.trim() === etag)) {
    return reply.code(304).send();
  }

  const stat = await input.storage.stat(input.storageKey);
  if (stat === null) {
    request.log.error({ mediaId: input.mediaId }, 'media object is missing from storage');
    throw notFound('The media file');
  }

  // If-Range with a validator that is not ours: answer with the whole object.
  const ifRange = request.headers['if-range'];
  const rangeHeader =
    typeof ifRange === 'string' && ifRange.trim() !== etag ? undefined : request.headers.range;
  const range = parseRangeHeader(rangeHeader, stat.bytes);
  if (range.kind === 'unsatisfiable') {
    throw new HttpError(
      416,
      'range_not_satisfiable',
      'The requested byte range is not available.',
      {
        headers: { 'content-range': unsatisfiableContentRangeHeader(stat.bytes) },
      },
    );
  }

  void reply.type(input.mimeType);
  if (request.method === 'HEAD') {
    // Fastify's automatic HEAD handling overwrites Content-Length with the size of a
    // string or buffer payload (0 for none), but leaves it alone for a stream. An empty
    // stream keeps the real size without reading the object.
    return reply.header('content-length', stat.bytes).code(200).send(Readable.from([]));
  }

  let handle;
  try {
    handle = await input.storage.openRead(
      input.storageKey,
      range.kind === 'partial' ? range.range : undefined,
    );
  } catch (error) {
    if (error instanceof StorageError && error.code === 'not_found')
      throw notFound('The media file');
    throw error;
  }
  void reply.header('content-length', handle.length);
  if (handle.range !== null) {
    void reply
      .code(206)
      .header('content-range', contentRangeHeader(handle.range, handle.totalBytes));
  }
  return reply.send(handle.stream);
}
