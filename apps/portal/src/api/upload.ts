import {
  HEADERS,
  MEDIA_UPLOAD_FIELD,
  MediaUploadResponseSchema,
  ROUTES,
  type MediaDto,
} from '@tinnox/contracts';
import { ApiRequestError, errorFromResponse, isRoleRefusal, type ApiClient } from './client.ts';

export interface UploadHandle {
  readonly done: Promise<MediaDto>;
  cancel(): void;
}

/** Interprets the final state of an upload request. Exported for tests. */
export function mediaFromUploadResponse(
  status: number,
  bodyText: string,
  requestId: string | null,
): MediaDto {
  if (status < 200 || status >= 300) throw errorFromResponse(status, bodyText, requestId);
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = null;
  }
  const parsed = MediaUploadResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiRequestError({
      status,
      code: 'invalid_response',
      message:
        'The upload finished but the server answer could not be read. Refresh the list to see whether the file arrived.',
      fromApi: false,
    });
  }
  return parsed.data.media;
}

/**
 * Uploads one file as multipart/form-data to `POST /api/media`.
 * XMLHttpRequest is used because it reports upload progress and can be aborted.
 */
export function uploadMedia(
  client: ApiClient,
  file: File,
  onProgress: (loadedBytes: number, totalBytes: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const done = new Promise<MediaDto>((resolve, reject) => {
    const csrfToken = client.getCsrfToken();
    if (csrfToken === null) {
      reject(
        new ApiRequestError({
          status: 0,
          code: 'no_session',
          message: 'There is no active session. Sign in again.',
          fromApi: false,
        }),
      );
      return;
    }
    xhr.open('POST', ROUTES.media);
    xhr.responseType = 'text';
    xhr.setRequestHeader('accept', 'application/json');
    xhr.setRequestHeader(HEADERS.csrf, csrfToken);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      try {
        resolve(
          mediaFromUploadResponse(
            xhr.status,
            xhr.responseText,
            xhr.getResponseHeader(HEADERS.requestId),
          ),
        );
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          client.notifyUnauthenticated();
        } else if (isRoleRefusal(error)) {
          // The queue item shows the API's message ("Your role doesn't allow this.").
          client.notifyForbidden();
        }
        reject(error instanceof Error ? error : new Error('Upload failed'));
      }
    };
    xhr.onerror = () => {
      reject(
        new ApiRequestError({
          status: 0,
          code: 'network_error',
          message:
            'The connection was lost during the upload. Refresh the list before trying again.',
          fromApi: false,
        }),
      );
    };
    xhr.onabort = () => {
      reject(
        new ApiRequestError({
          status: 0,
          code: 'aborted',
          message: 'The upload was cancelled.',
          fromApi: false,
        }),
      );
    };
    const form = new FormData();
    // The name is a display label only; the server generates its own storage key.
    form.append(MEDIA_UPLOAD_FIELD, file, file.name);
    xhr.send(form);
  });
  return {
    done,
    cancel: () => {
      xhr.abort();
    },
  };
}
