import type { MiddlewareHandler } from "hono";

import type { ApiKeyService } from "@sebela/services";

import type { ApiEnv } from "./context.js";
import { ApiError } from "./errors.js";

// Query parameter names that carry credentials elsewhere, and anything that looks like our key.
const CREDENTIAL_NAMES = new Set([
  "api_key",
  "apikey",
  "api-key",
  "key",
  "token",
  "access_token",
  "auth",
  "authorization",
  "bearer",
]);
const KEY_LIKE = /sebela_[0-9a-f]{16}_/;
const BEARER = /^Bearer +(\S+)$/i;

/** Refuses credentials in the query string on every route: URLs end up in logs and histories. */
export const refuseCredentialsInUrl: MiddlewareHandler = async (c, next) => {
  for (const [name, value] of new URL(c.req.url).searchParams) {
    if (CREDENTIAL_NAMES.has(name.toLowerCase()) || KEY_LIKE.test(value)) {
      throw new ApiError(
        400,
        "credentials_in_url",
        "Send the API key in the Authorization header, never in the URL.",
      );
    }
  }
  await next();
};

/**
 * Lets a request through only with a valid `Authorization: Bearer <key>`. The service compares in
 * constant time; missing, malformed, unknown and revoked keys get the same 401.
 */
export function authenticate(apiKeys: Pick<ApiKeyService, "verifyKey">): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const presented = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    const verification = await apiKeys.verifyKey(presented);
    if (!verification.ok) {
      throw new ApiError(401, "unauthorized", "A valid API key is required.", undefined, {
        "WWW-Authenticate": "Bearer",
      });
    }
    c.set("keyId", verification.keyId);
    await next();
  };
}
