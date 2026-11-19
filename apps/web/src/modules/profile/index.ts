// The profile module: the website's read of the API's public profile, experience, services, CV
// and AI Roadmap routes, the learning diary, its statistics, the bookshelf and the events included (and the
// records the Ask page's answers rest on), of the current CV PDF's file and of the stored images
// the site serves on its own media path, with the process-local content cache those reads share
// and its invalidation. Server-only.
import "server-only";

import { cache } from "react";

import { createApiClient, type ApiClient } from "@sebela/api-client";

import { readWebConfig } from "../../config";
import { createContentCache, type ContentCache } from "./data/content-cache";
import { loadAsk, type AskResult } from "./data/load-ask";
import { loadCv, type CvResult } from "./data/load-cv";
import { loadExperience, type ExperienceResult } from "./data/load-experience";
import { loadHomepage, type HomepageResult } from "./data/load-homepage";
import { loadRoadmap, type RoadmapResult } from "./data/load-roadmap";
import {
  loadRoadmapArea,
  loadRoadmapModule,
  type RoadmapAreaResult,
  type RoadmapModuleResult,
} from "./data/load-roadmap-detail";
import {
  loadRoadmapBook,
  loadRoadmapBookshelf,
  type RoadmapBookResult,
  type RoadmapBookshelfResult,
} from "./data/load-roadmap-books";
import {
  loadRoadmapDiary,
  loadRoadmapDiaryDay,
  type RoadmapDiaryDayResult,
  type RoadmapDiaryResult,
} from "./data/load-roadmap-diary";
import { loadRoadmapEvents, type RoadmapEventsResult } from "./data/load-roadmap-events";
import {
  loadRoadmapReadingGuide,
  type RoadmapReadingGuideResult,
} from "./data/load-roadmap-reading-guide";
import {
  loadRoadmapStatistics,
  type RoadmapStatisticsResult,
} from "./data/load-roadmap-statistics";
import { loadServices, type ServicesResult } from "./data/load-services";
import { readCvPdfFile, type CvPdfFile } from "./data/read-cv-pdf-file";
import { readMediaFile } from "./data/read-media-file";

export type { AskContent, AskResult } from "./data/load-ask";

export type { CvPdf } from "./data/cv-pdf";

export type { CvContent, CvResult } from "./data/load-cv";

export type { CvPdfFile } from "./data/read-cv-pdf-file";

export type { ExperienceContent, ExperienceResult } from "./data/load-experience";

export type { ImageMedia } from "./data/image";

export type { HomepagePhoto, HomepageProfile, HomepageResult } from "./data/load-homepage";

export type { RoadmapContent, RoadmapResult } from "./data/load-roadmap";

export type {
  RoadmapAreaContent,
  RoadmapAreaResult,
  RoadmapModuleContent,
  RoadmapModuleResult,
} from "./data/load-roadmap-detail";

export type {
  RoadmapBookContent,
  RoadmapBookResult,
  RoadmapBookshelfContent,
  RoadmapBookshelfResult,
  RoadmapShelfBook,
} from "./data/load-roadmap-books";

export type {
  RoadmapDiaryAreaName,
  RoadmapDiaryBookLink,
  RoadmapDiaryContent,
  RoadmapDiaryDayContent,
  RoadmapDiaryDayResult,
  RoadmapDiaryModuleName,
  RoadmapDiaryResult,
} from "./data/load-roadmap-diary";

export type { RoadmapEventsContent, RoadmapEventsResult } from "./data/load-roadmap-events";

export type {
  RoadmapReadingGuideContent,
  RoadmapReadingGuideResult,
} from "./data/load-roadmap-reading-guide";
export type {
  RoadmapStatisticsContent,
  RoadmapStatisticsResult,
} from "./data/load-roadmap-statistics";

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
 * The AI Roadmap pages' content for the current request: the person's header facts and the whole
 * roadmap tree with the API's derived progress and totals, read once per request (React `cache`),
 * from the content cache.
 */
export const getRoadmap = cache((): Promise<RoadmapResult> => loadRoadmap(apiClient()));

/**
 * An AI Roadmap area's page for the current request: the person's header facts and the area with
 * its modules, resources and the API's derived progress, read once per request and slug (React
 * `cache`), from the content cache. A missing area or an address that is not a slug is missing.
 */
export const getRoadmapArea = cache((area: string): Promise<RoadmapAreaResult> =>
  loadRoadmapArea(apiClient(), area),
);

/**
 * An AI Roadmap module's page for the current request: the person's header facts and the module
 * with its area, resources and the API's derived progress, read once per request and slugs (React
 * `cache`), from the content cache. A module under another area is missing, as is a missing one.
 */
export const getRoadmapModule = cache(
  (area: string, module: string): Promise<RoadmapModuleResult> =>
    loadRoadmapModule(apiClient(), area, module),
);

/**
 * The learning diary's list for the current request: the person's header facts and every diary day
 * with its notes, time entries and the API's derived totals, newest first, read once per request
 * (React `cache`), from the content cache. An empty diary is ready with no days.
 */
export const getRoadmapDiary = cache((): Promise<RoadmapDiaryResult> =>
  loadRoadmapDiary(apiClient()),
);

/**
 * A diary day's page for the current request: the person's header facts, the day with its notes,
 * time entries and the API's derived total, and the roadmap's areas and modules in order for the
 * entries' grouping, read once per request and date (React `cache`), from the content cache. A day
 * without a diary record or an address that is not a calendar day is missing.
 */
export const getRoadmapDiaryDay = cache((date: string): Promise<RoadmapDiaryDayResult> =>
  loadRoadmapDiaryDay(apiClient(), date),
);

/**
 * The roadmap's events for the current request: the person's header facts and every event with its
 * topics and the API's derived attendance, newest first, read once per request (React `cache`),
 * from the content cache. No events is ready with none.
 */
export const getRoadmapEvents = cache((): Promise<RoadmapEventsResult> =>
  loadRoadmapEvents(apiClient()),
);

/**
 * What the reading guide reads for the current request: only the person's name, read once per
 * request (React `cache`), from the content cache. The guide's text is the site's own, so a failed
 * roadmap or supporting-content read never takes it down; a failed person read is unavailable.
 */
export const getRoadmapReadingGuide = cache((): Promise<RoadmapReadingGuideResult> =>
  loadRoadmapReadingGuide(apiClient()),
);

/**
 * The learning statistics for the current request: the person's header facts and the time logged
 * in the diary as the API aggregates it (totals by category, days, weeks, months, areas with their
 * modules, resources and events), read once per request (React `cache`), from the content cache.
 * No logged time is ready with zero totals; a failed read is unavailable and never kept.
 */
export const getRoadmapStatistics = cache((): Promise<RoadmapStatisticsResult> =>
  loadRoadmapStatistics(apiClient()),
);

/**
 * The bookshelf for the current request: the person's header facts and every book in the API's
 * shelf order with its derived status, reading time, linked resource and cover as the site's image,
 * read once per request (React `cache`), from the content cache. An empty shelf is ready.
 */
export const getRoadmapBookshelf = cache((): Promise<RoadmapBookshelfResult> =>
  loadRoadmapBookshelf(apiClient(), { mediaBaseUrl: mediaBaseUrl() }),
);

/**
 * A book's page for the current request: the person's header facts and the book with its derived
 * status, reading time, linked resource and cover as the site's image, read once per request and
 * slug (React `cache`), from the content cache. A missing book or an address that is not a slug is
 * missing.
 */
export const getRoadmapBook = cache((slug: string): Promise<RoadmapBookResult> =>
  loadRoadmapBook(apiClient(), slug, { mediaBaseUrl: mediaBaseUrl() }),
);

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
  const config = readWebConfig(process.env);
  return readCvPdfFile(freshApiClient(), {
    apiBaseUrl: config.apiBaseUrl,
    mediaRead: { baseUrl: config.mediaBaseUrl, readBaseUrl: config.mediaReadBaseUrl },
  });
}

/**
 * The stored image `name` (`<file>.<png|jpg|webp>` directly below the media base) as the answer of
 * the site's own media path, read fresh from `WEB_MEDIA_READ_BASE_URL` or the media base. Any other
 * name or a file the storage lacks is a 404; any other failure an empty 502. Never throws.
 */
export function getMediaFile(name: string): Promise<Response> {
  return readMediaFile(name, { mediaReadBaseUrl: readWebConfig(process.env).mediaReadBaseUrl });
}
