// The profile module: the website's read of the API's public profile, experience and services
// routes. Server-only.
import "server-only";

import { cache } from "react";

import { createApiClient, type ApiClient } from "@sebela/api-client";

import { readWebConfig } from "../../config";
import { loadExperience, type ExperienceResult } from "./data/load-experience";
import { loadHomepage, type HomepageResult } from "./data/load-homepage";
import { loadServices, type ServicesResult } from "./data/load-services";

export type { ExperienceContent, ExperienceResult } from "./data/load-experience";

export type { ImageMedia } from "./data/image";

export type { HomepagePhoto, HomepageProfile, HomepageResult } from "./data/load-homepage";

export type { ServicesContent, ServicesResult } from "./data/load-services";

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

/**
 * The experience page's content for the current request: the person's header facts and the
 * published experiences, read once per request (React `cache`). Never cached across requests.
 */
export const getExperience = cache((): Promise<ExperienceResult> => loadExperience(apiClient()));

/**
 * The services page's content for the current request: the person's header facts and services
 * prose and the services, read once per request (React `cache`). Never cached across requests.
 */
export const getServices = cache((): Promise<ServicesResult> => loadServices(apiClient()));
