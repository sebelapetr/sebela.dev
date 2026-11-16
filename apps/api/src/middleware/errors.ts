import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ErrorCode, ErrorResponse } from "@sebela/contracts";
import { DomainError } from "@sebela/services";

import type { Logger } from "./logging.js";
import { redact } from "./logging.js";

type ErrorField = NonNullable<ErrorResponse["error"]["fields"]>[number];

/** An expected failure, answered with its status and the common error shape. */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: ErrorField[],
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const domainStatus = { not_found: 404, conflict: 409, validation_failed: 400 } as const;

function send(c: Context, error: ApiError) {
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  };
  return c.json(body, error.status, error.headers);
}

/**
 * Maps expected failures to their status; anything else becomes a generic `internal_error`. Only
 * the redacted error name and message are logged; no stack, SQL or secret reaches the response.
 */
export function handleErrors(log: Logger): ErrorHandler {
  return (error, c) => {
    if (error instanceof ApiError) return send(c, error);
    if (error instanceof DomainError) {
      return send(
        c,
        new ApiError(
          domainStatus[error.code],
          error.code,
          error.message,
          error.fields && [...error.fields],
        ),
      );
    }
    log(redact(`error ${c.req.method} ${c.req.path}: ${error.name}: ${error.message}`));
    return send(c, new ApiError(500, "internal_error", "An unexpected error occurred."));
  };
}
