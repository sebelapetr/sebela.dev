// The health module: whether the website can serve content now, for uptime monitoring. It asks the
// API's readiness route (`GET /health/ready`, which answers only when the API reaches its database)
// on every request, past the content cache, and answers 200 `{ status, api, postgres }` when both
// are healthy or 503 naming the failing part (the database is `unknown` when the API itself fails).
// It reveals no address, configuration or error detail, is never cached and never indexed.
import "server-only";

import { createApiClient, type ApiClient } from "@sebela/api-client";

import { readWebConfig } from "../../config";
import { checkHealth, healthResponse } from "./data/check-health";

let client: ApiClient | undefined;

/** The API client of the health check, or `null` while the website's configuration is unusable. */
function healthClient(): ApiClient | null {
  if (client) return client;
  try {
    client = createApiClient({ baseUrl: readWebConfig(process.env).apiBaseUrl });
    return client;
  } catch {
    return null;
  }
}

/** The health route's answer for the current state of the API and the database. */
export async function websiteHealthResponse(): Promise<Response> {
  return healthResponse(await checkHealth(healthClient()));
}
