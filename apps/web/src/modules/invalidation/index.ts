// The invalidation module: receives the API's signed notifications of committed content writes
// and invalidates the website's cached content they affect. Server-only: the signing secret is
// read from the server environment and never reaches browser code.
import "server-only";

import { readInvalidationSecret } from "../../config";
import { invalidateProfileContent } from "../profile";
import { createInvalidationReceiver } from "./data/receive";

export type { CacheScope } from "./data/dependencies";

const receive = createInvalidationReceiver({
  secret: () => readInvalidationSecret(process.env),
  invalidate: (scopes) => {
    if (scopes.includes("profile")) invalidateProfileContent();
  },
  log: (line) => {
    process.stderr.write(`${line}\n`);
  },
});

/**
 * Answers one delivery of an invalidation notification (`POST /internal/invalidation`): 204 after
 * the affected cached content is invalidated, 4xx for a refused notification, which invalidates
 * nothing, and 500 while `WEB_INVALIDATION_SECRET` is missing or too short. The body is read at
 * most `invalidationMaxBodyBytes` far; the dependency map, not the caller, decides what is
 * invalidated.
 */
export function receiveInvalidation(request: Request): Promise<Response> {
  return receive(request);
}
