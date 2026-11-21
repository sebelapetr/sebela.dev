// The seo module: what search engines and language models read about the profile — each indexed
// page's metadata (titles within 60 characters) and Open Graph preview image, the structured data
// of the homepage, the experience page, the services page and the CV, the llms.txt link in every
// page's head, every AI Roadmap
// page's metadata, breadcrumbs, structured data and preview image, the sitemap, robots.txt and
// llms.txt with the roadmap's pages — on the
// canonical origin `WEB_SITE_ORIGIN`, from the public profile the API supplies. A profile that is
// not published answers 404 and one that cannot be read answers 503, never an empty document.
// Server-only.
import "server-only";

import type { Metadata } from "next";

import { getHomepage, getRoadmap, getRoadmapBookshelf, getRoadmapDiary } from "../profile";
import { robotsTxt, sitemapXml } from "./data/indexing";
import { openGraphImage } from "./components/open-graph-image";
import { llmsTxt } from "./data/llms-txt";
import { openGraphCard } from "./data/open-graph-card";
import {
  pageMetadata as buildPageMetadata,
  type IndexedPage,
  type PageFacts,
} from "./data/page-metadata";
import { notFoundResponse, profileTextResponse, textResponse } from "./data/responses";
import {
  roadmapOpenGraphCard,
  roadmapPageMetadata as buildRoadmapPageMetadata,
  type RoadmapPageFacts,
} from "./data/roadmap-page";
import { discoveryResult, roadmapPaths, type DiscoveryResult } from "./data/roadmap-discovery";
import { siteOrigin } from "./data/site-origin";

export { LlmsTxtLink } from "./components/llms-txt-link";

export {
  CvStructuredData,
  ExperienceStructuredData,
  ServicesStructuredData,
} from "./components/page-structured-data";

export { ProfileStructuredData } from "./components/profile-structured-data";

export { RoadmapStructuredData } from "./components/roadmap-structured-data";

export type { RoadmapPageCrumb, RoadmapPageFacts } from "./data/roadmap-page";

export type { IndexedPage, PageFacts } from "./data/page-metadata";

export { isPreviewPage } from "./data/open-graph-card";

/** The answer for a preview image or document that does not exist: 404, kept out of search. */
export { notFoundResponse };

/**
 * An indexed page's metadata on the canonical origin: title, description, canonical address and
 * Open Graph basics with the page's preview image, from the facts the page read.
 */
export function pageMetadata(page: IndexedPage, facts: PageFacts): Metadata {
  return buildPageMetadata(siteOrigin(), page, facts);
}

/**
 * An AI Roadmap page's metadata on the canonical origin: title from its breadcrumbs, description,
 * canonical address, Open Graph basics with the page's own preview image and a large Twitter card.
 */
export function roadmapPageMetadata(facts: RoadmapPageFacts): Metadata {
  return buildRoadmapPageMetadata(siteOrigin(), facts);
}

/**
 * The profile and the AI Roadmap's pages, read in parallel (each read once per request and served
 * from the content cache, so an edit refreshes both documents).
 */
async function readDiscovery(): Promise<DiscoveryResult> {
  const [homepage, roadmap, diary, bookshelf] = await Promise.all([
    getHomepage(),
    getRoadmap(),
    getRoadmapDiary(),
    getRoadmapBookshelf(),
  ]);
  return discoveryResult({ homepage, roadmap, diary, bookshelf });
}

/**
 * The sitemap of the indexed pages and every AI Roadmap page; 404 or 503 while the profile or the
 * roadmap is missing or unreadable, never a sitemap with pages left out.
 */
export async function sitemapResponse(): Promise<Response> {
  const result = await readDiscovery();
  const origin = siteOrigin();
  return profileTextResponse(result, "application/xml; charset=utf-8", ({ roadmap }) =>
    sitemapXml(origin, roadmapPaths(roadmap)),
  );
}

/** robots.txt; it reads no content, so it is served while the API is down. */
export function robotsResponse(): Response {
  return textResponse(robotsTxt(siteOrigin()), "text/plain; charset=utf-8");
}

/**
 * llms.txt from the profile and the AI Roadmap; 404 or 503 while either is missing or unreadable.
 */
export async function llmsTxtResponse(): Promise<Response> {
  const result = await readDiscovery();
  const origin = siteOrigin();
  return profileTextResponse(result, "text/plain; charset=utf-8", ({ profile, roadmap }) =>
    llmsTxt(origin, profile, roadmap),
  );
}

/**
 * An indexed page's Open Graph preview image, a 1200 × 630 PNG: the person's name and headline
 * from the profile, or the site's own card while the profile is missing or cannot be read, so a
 * shared link always has a preview. The profile's card is revalidated on every use (`no-cache`)
 * so an edited profile is never shown stale; the fallback is never stored.
 */
export async function openGraphImageResponse(page: IndexedPage): Promise<Response> {
  const result = await getHomepage();
  const facts = result.status === "ready" ? result.profile : null;
  const card = openGraphCard(siteOrigin(), page, facts);
  return openGraphImage(card, facts === null ? "no-store" : "no-cache");
}

/**
 * An AI Roadmap page's Open Graph preview image, a 1200 × 630
 * PNG: the page's kind and name and whose roadmap it is on, or the site's own roadmap card while the
 * page cannot be read (`facts` is null), so a shared link always has a preview. The page's card is revalidated on every
 * use (`no-cache`); the fallback is never stored. A page that does not exist has no image: its
 * route answers 404 itself.
 */
export function roadmapOpenGraphImageResponse(facts: RoadmapPageFacts | null): Response {
  const card = roadmapOpenGraphCard(siteOrigin(), facts);
  return openGraphImage(card, facts === null ? "no-store" : "no-cache");
}
