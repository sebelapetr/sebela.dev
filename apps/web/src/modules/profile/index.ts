// The profile module: the website's read of the API's public profile, experience, services and CV
// routes (and the records the Ask page's answers rest on), and of the current CV PDF's file, with
// the process-local content cache those reads share and its invalidation. Server-only.
import "server-only";

import { cache } from "react";

import { createApiClient, type ApiClient } from "@sebela/api-client";

import { readWebConfig } from "../../config";
import { createContentCache, type ContentCache } from "./data/content-cache";
import { loadAsk, type AskResult } from "./data/load-ask";
import { loadCv, type CvResult } from "./data/load-cv";
import { loadExperience, type ExperienceResult } from "./data/load-experience";
import { loadHomepage, type HomepageResult } from "./data/load-homepage";
import { loadServices, type ServicesResult } from "./data/load-services";
import { readCvPdfFile, type CvPdfFile } from "./data/read-cv-pdf-file";

export type { AskContent, AskResult } from "./data/load-ask";

export type { CvPdf } from "./data/cv-pdf";

export type { CvContent, CvResult } from "./data/load-cv";

export type { CvPdfFile } from "./data/read-cv-pdf-file";

export type { ExperienceContent, ExperienceResult } from "./data/load-experience";

export type { ImageMedia } from "./data/image";

export type { HomepagePhoto, HomepageProfile, HomepageResult } from "./data/load-homepage";

export type { ServicesContent, ServicesResult } from "./data/load-services";

/** The content cache of this process, shared by every route and page bundle loading this module. */
const CACHE_KEY = Symbol.for("sebela.web.profile.contentCache");

const cacheHolder = () => globalThis as unknown as Record<symbol, ContentCache | undefined>;

/**
 * The content cache, created on first use with the fallback revalidation interval of
 * `WEB_CONTENT_REVALIDATE_SECONDS` (validated with the rest of the configuration). Stale answers
 * served during an API outage are logged to standard error.
 */
function contentCache(): ContentCache {
  const holder = cacheHolder();
  const cache =
    holder[CACHE_KEY] ??
    createContentCache({
      fetch: (request) => fetch(request),
      maxAgeMs: readWebConfig(process.env).contentRevalidateMs,
      log: (line) => {
        process.stderr.write(`${line}\n`);
      },
    });
  holder[CACHE_KEY] = cache;
  return cache;
}

let client: ApiClient | undefined;
let uncachedClient: ApiClient | undefined;

/** The API's base address, from the environment validated on every call. */
function apiBaseUrl(): string {
  return readWebConfig(process.env).apiBaseUrl;
}

/** The media base the website shows images from, from the environment validated on every call. */
function mediaBaseUrl(): string {
  return readWebConfig(process.env).mediaBaseUrl;
}

/**
 * The API client the pages read through, answering from the content cache: created on first use
 * after the environment is validated once per process.
 */
function apiClient(): ApiClient {
  client ??= createApiClient({ baseUrl: apiBaseUrl(), fetch: contentCache().fetch });
  return client;
}

/** The API client of reads that must be fresh, past the content cache. */
function freshApiClient(): ApiClient {
  uncachedClient ??= createApiClient({ baseUrl: apiBaseUrl() });
  return uncachedClient;
}

/**
 * Forgets every cached profile read, so the next request of every page, its metadata, the
 * sitemap, `llms.txt` and the Open Graph images reads current data. A read already under way when
 * it is called is not kept. Called by the invalidation module after a verified notification.
 */
export function invalidateProfileContent(): void {
  // No cache yet means nothing was read, so nothing can be stale.
  cacheHolder()[CACHE_KEY]?.invalidate();
}

/**
 * The homepage's content for the current request, read once per request however many components
 * ask (React `cache`), from the content cache.
 */
export const getHomepage = cache((): Promise<HomepageResult> =>
  loadHomepage(apiClient(), { mediaBaseUrl: mediaBaseUrl() }),
);

/**
 * The experience page's content for the current request: the person's header facts and the
 * published experiences, read once per request (React `cache`), from the content cache.
 */
export const getExperience = cache((): Promise<ExperienceResult> =>
  loadExperience(apiClient(), { mediaBaseUrl: mediaBaseUrl() }),
);

/**
 * The services page's content for the current request: the person's header facts and services
 * prose and the services, read once per request (React `cache`), from the content cache.
 */
export const getServices = cache((): Promise<ServicesResult> => loadServices(apiClient()));

/**
 * The Ask page's content for the current request: the person's name the assistant speaks about,
 * their contact and the public records its answers rest on, read once per request (React `cache`),
 * from the content cache.
 */
export const getAsk = cache((): Promise<AskResult> => loadAsk(apiClient()));

/**
 * The CV page's content for the current request: the API's assembled CV and the PDF's upload day,
 * read once per request (React `cache`), from the content cache.
 */
export const getCv = cache((): Promise<CvResult> => loadCv(apiClient()));

/**
 * The current CV PDF's file as stored, for a download: read fresh on every call, never cached.
 * Delivered only whole and as a PDF; otherwise no PDF or an unavailable one.
 */
export function getCvPdfFile(): Promise<CvPdfFile> {
  return readCvPdfFile(freshApiClient(), { apiBaseUrl: apiBaseUrl() });
}
