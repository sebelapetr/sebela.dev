// The profile module: the website's read of the API's public profile, experience, services and CV
// routes (and the records the Ask page's answers rest on), and of the current CV PDF's file.
// Server-only.
import "server-only";

import { cache } from "react";

import { createApiClient, type ApiClient } from "@sebela/api-client";

import { readWebConfig } from "../../config";
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

let client: ApiClient | undefined;

/** The API's base address, from the environment validated on every call. */
function apiBaseUrl(): string {
  return readWebConfig(process.env).apiBaseUrl;
}

/** The media base the website shows images from, from the environment validated on every call. */
function mediaBaseUrl(): string {
  return readWebConfig(process.env).mediaBaseUrl;
}

/** The API client, created on first use after the environment is validated once per process. */
function apiClient(): ApiClient {
  client ??= createApiClient({ baseUrl: apiBaseUrl() });
  return client;
}

/**
 * The homepage's content for the current request, read once per request however many components
 * ask (React `cache`). Never cached across requests.
 */
export const getHomepage = cache((): Promise<HomepageResult> =>
  loadHomepage(apiClient(), { mediaBaseUrl: mediaBaseUrl() }),
);

/**
 * The experience page's content for the current request: the person's header facts and the
 * published experiences, read once per request (React `cache`). Never cached across requests.
 */
export const getExperience = cache((): Promise<ExperienceResult> =>
  loadExperience(apiClient(), { mediaBaseUrl: mediaBaseUrl() }),
);

/**
 * The services page's content for the current request: the person's header facts and services
 * prose and the services, read once per request (React `cache`). Never cached across requests.
 */
export const getServices = cache((): Promise<ServicesResult> => loadServices(apiClient()));

/**
 * The Ask page's content for the current request: the person's name the assistant speaks about,
 * their contact and the public records its answers rest on, read once per request (React `cache`). Never cached across requests.
 */
export const getAsk = cache((): Promise<AskResult> => loadAsk(apiClient()));

/**
 * The CV page's content for the current request: the API's assembled CV and the PDF's upload day,
 * read once per request (React `cache`). Never cached across requests.
 */
export const getCv = cache((): Promise<CvResult> => loadCv(apiClient()));

/**
 * The current CV PDF's file as stored, for a download: read fresh on every call, never cached.
 * Delivered only whole and as a PDF; otherwise no PDF or an unavailable one.
 */
export function getCvPdfFile(): Promise<CvPdfFile> {
  return readCvPdfFile(apiClient(), { apiBaseUrl: apiBaseUrl() });
}
