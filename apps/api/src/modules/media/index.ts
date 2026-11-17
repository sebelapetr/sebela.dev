import { z } from "zod";

import {
  MediaIdParamsSchema,
  MediaListSchema,
  MediaSchema,
  MediaUpdateSchema,
  MediaUploadSchema,
  mediaTypes,
  type MediaUpdate,
} from "@sebela/contracts";
import { DomainError, type CleanupFailure, type MediaService } from "@sebela/services";

import { redact, type Logger } from "../../middleware/logging.js";
import {
  defineRoute,
  type FileResponse,
  type RouteDefinition,
  type UploadedFile,
} from "../../routing.js";

const LIST = "/v1/media";
const ITEM = "/v1/media/:id";
const FILE = "/v1/media/files/:key{.+}";

/** The storage key in a file address: any segments; only a recorded key is ever served. */
const FileKeyParamsSchema = z.strictObject({
  key: z.string().min(1).max(512).meta({ description: "The storage key of the media." }),
});

/** Characters a generated key consists of; anything else cannot name a recorded file. */
const KEY_CHARACTERS = /^[A-Za-z0-9._/-]+$/;

interface UploadBody {
  readonly file: UploadedFile;
  readonly altText?: string;
}

const missingFile = () => new DomainError("not_found", "There is no such file.");

/**
 * The HTTP routes of the media: public list, read and file download, and authenticated upload,
 * alt-text update and delete, addressed by identifier. Uploads are `multipart/form-data` with
 * their own, stricter per-client budget; the file's content proves its type. Domain errors become
 * `not_found`, `conflict` (deleting attached media), `payload_too_large`, `unsupported_media_type`
 * and `validation_failed` on `file`. Files are served with their recorded type, `nosniff` and a
 * sandboxing content security policy; an unknown key is a `not_found`.
 */
export function mediaRoutes(media: MediaService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listMedia",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the media",
      description: "Ordered by creation, newest first, then by identifier.",
      response: { status: 200, description: "Every media record.", schema: MediaListSchema },
      errors: [],
      handle: () => media.listMedia(),
    }),
    defineRoute({
      operationId: "getMedia",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read media",
      params: MediaIdParamsSchema,
      response: { status: 200, description: "The media record.", schema: MediaSchema },
      errors: ["not_found"],
      handle: ({ params }) => media.getMedia(params.id),
    }),
    defineRoute<UploadBody>({
      operationId: "uploadMedia",
      method: "POST",
      path: LIST,
      access: "private",
      budget: "upload",
      summary: "Upload an image or a PDF",
      description:
        "Accepts one PNG, JPEG or WebP image or PDF as `multipart/form-data`, within the configured " +
        "size and image-dimension limits. The content proves the type; a declared type or extension " +
        "that contradicts it is refused. The API generates the storage key; the file name never " +
        "chooses it. Uploads have their own, stricter rate limit.",
      upload: { schema: MediaUploadSchema, fileField: "file" },
      response: {
        status: 201,
        description: "The stored media.",
        schema: MediaSchema,
        location: ITEM,
      },
      errors: [],
      handle: ({ body }) =>
        media.uploadMedia({
          bytes: body.file.bytes,
          filename: body.file.filename,
          declaredType: body.file.declaredType,
          altText: body.altText ?? null,
        }),
    }),
    defineRoute<MediaUpdate, { id: string }>({
      operationId: "updateMedia",
      method: "PATCH",
      path: ITEM,
      access: "private",
      summary: "Update the alt text of media",
      description: "Changes or clears (`null`) the alt text; the file itself cannot be replaced.",
      params: MediaIdParamsSchema,
      body: MediaUpdateSchema,
      response: { status: 200, description: "The updated media.", schema: MediaSchema },
      errors: ["not_found"],
      handle: ({ params, body }) => media.updateMedia(params.id, body),
    }),
    defineRoute({
      operationId: "deleteMedia",
      method: "DELETE",
      path: ITEM,
      access: "private",
      summary: "Delete media",
      description:
        "Deletes the record and its file. Media attached to the person, an organization, a " +
        "project or a testimonial is not deleted; clear the reference first.",
      params: MediaIdParamsSchema,
      response: { status: 204, description: "The media was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await media.deleteMedia(params.id);
        return undefined;
      },
    }),
    defineRoute({
      operationId: "getMediaFile",
      method: "GET",
      path: FILE,
      access: "public",
      summary: "Download a media file",
      description:
        "Serves a recorded file inline under its storage key with the type its content proved, " +
        "`nosniff` and a content security policy that loads nothing. Images are also sandboxed; " +
        "a PDF is not, because browser PDF viewers refuse sandboxed documents, and it is offered " +
        "under the file name of its key. Only files the API stores itself are served here.",
      params: FileKeyParamsSchema,
      response: { status: 200, description: "The file.", file: mediaTypes },
      errors: ["not_found"],
      handle: async ({ params }): Promise<FileResponse> => {
        if (!KEY_CHARACTERS.test(params.key)) throw missingFile();
        const file = await media.readMediaFile(params.key);
        if (file === null) throw missingFile();
        const pdf = file.mediaType === "application/pdf";
        return { ...file, sandboxed: !pdf, fileName: params.key.split("/").at(-1) ?? "" };
      },
    }),
  ];
}

/**
 * Logs a stored file the media workflow could not remove: one redacted line with the operation, the
 * key and the error name and message, never a stack, file contents or credentials.
 */
export function logCleanupFailure(log: Logger): (failure: CleanupFailure) => void {
  return ({ operation, key, error }) => {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    log(redact(`media cleanup failed (${operation}) key=${key}: ${reason}`));
  };
}
