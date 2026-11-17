import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";

import type { ApiEnv } from "./context.js";
import { ApiError } from "./errors.js";

/**
 * Accepts only an `application/json` body within `maxBytes` (declared or streamed), parses it and
 * validates it with `schema`; the parsed value is handed on as the `body` variable.
 */
export function jsonBody(schema: z.ZodType, maxBytes: number): MiddlewareHandler<ApiEnv>[] {
  return [
    async (c, next) => {
      const mediaType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (mediaType !== "application/json") {
        throw new ApiError(415, "unsupported_media_type", "Send the body as application/json.");
      }
      await next();
    },
    bodyLimit({
      maxSize: maxBytes,
      onError: () => {
        throw new ApiError(413, "payload_too_large", `The body exceeds ${String(maxBytes)} bytes.`);
      },
    }),
    async (c, next) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await c.req.text());
      } catch {
        throw new ApiError(400, "malformed_json", "The body is not valid JSON.");
      }
      const result = schema.safeParse(parsed);
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
      c.set("body", result.data);
      await next();
    },
  ];
}
