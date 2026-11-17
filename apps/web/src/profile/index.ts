// The profile module: the website's read of the API's public profile routes. Server-only.
import "server-only";

import { cache } from "react";

import { createApiClient, type ApiClient } from "@sebela/api-client";

import { readWebConfig } from "../config";
import { loadHomepage, type HomepageResult } from "./load-homepage";

export type { HomepagePhoto, HomepageProfile, HomepageResult } from "./load-homepage";

let client: ApiClient | undefined;

/** The API client, created on first use after the environment is validated once per process. */
function apiClient(): ApiClient {
  client ??= createApiClient({ baseUrl: readWebConfig(process.env).apiBaseUrl });
  return client;
}

/**
 * The homepage's content for the current request, read once per request however many components
 * ask (React `cache`). Never cached across requests.
 */
export const getHomepage = cache((): Promise<HomepageResult> => loadHomepage(apiClient()));
