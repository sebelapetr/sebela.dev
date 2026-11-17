import type { MiddlewareHandler } from "hono";
import type { z } from "zod";

import type { ApiEnv } from "./context.js";
import { ApiError } from "./errors.js";

/**
 * Validates the route's path parameters with `schema`; the parsed value is handed on as the
 * `params` variable. A malformed parameter is a 400 `validation_failed` naming it, not a 404.
 */
export function pathParams(schema: z.ZodObject): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const result = schema.safeParse(c.req.param());
    if (!result.success) {
      throw new ApiError(
        400,
        "validation_failed",
        "Some path parameters are invalid.",
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }
    c.set("params", result.data);
    await next();
  };
}
