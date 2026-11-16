import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";

import type { UploadedFile } from "../routing.js";
import type { ApiEnv } from "./context.js";
import { ApiError } from "./errors.js";

/** Room for the boundaries, part headers and text fields around the file of an upload. */
export const FORM_OVERHEAD_BYTES = 16 * 1024;

const invalid = (path: string, message: string) =>
  new ApiError(400, "validation_failed", "Some fields are invalid.", [{ path, message }]);

/**
 * Accepts only a `multipart/form-data` body within `maxFileBytes` plus `FORM_OVERHEAD_BYTES`
 * (declared or streamed). It must hold exactly one file part named `fileField`; the other fields are
 * validated with `schema` without it. The file stays in memory; nothing is written to disk. The
 * fields and the file, as an `UploadedFile` under `file`, are handed on as the `body` variable.
 */
export function multipartBody(
  schema: z.ZodObject,
  fileField: string,
  maxFileBytes: number,
): MiddlewareHandler<ApiEnv>[] {
  const omitted: Record<string, true> = { [fileField]: true };
  const fields = schema.omit(omitted);
  const maxBytes = maxFileBytes + FORM_OVERHEAD_BYTES;
  return [
    async (c, next) => {
      const mediaType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (mediaType !== "multipart/form-data") {
        throw new ApiError(415, "unsupported_media_type", "Send the body as multipart/form-data.");
      }
      await next();
    },
    bodyLimit({
      maxSize: maxBytes,
      onError: () => {
        throw new ApiError(
          413,
          "payload_too_large",
          `The upload exceeds ${String(maxFileBytes)} bytes.`,
        );
      },
    }),
    async (c, next) => {
      let form: Record<string, string | File | (string | File)[]>;
      try {
        form = await c.req.parseBody({ all: true });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(400, "validation_failed", "The body is not a valid form.");
      }
      const { [fileField]: part, ...rest } = form;
      if (!(part instanceof File)) {
        throw invalid(fileField, "Send exactly one file in this field.");
      }
      const result = fields.safeParse(rest);
      if (!result.success) {
        throw new ApiError(
          400,
          "validation_failed",
          "Some fields are invalid.",
          result.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        );
      }
      const file: UploadedFile = {
        bytes: new Uint8Array(await part.arrayBuffer()),
        filename: part.name,
        declaredType: part.type,
      };
      c.set("body", { ...result.data, [fileField]: file });
      await next();
    },
  ];
}
