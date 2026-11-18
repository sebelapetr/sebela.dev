// The seo module: what search engines and language models read about the profile — each indexed
// page's metadata, the homepage's structured data, the sitemap, robots.txt and llms.txt — on the
// canonical origin `WEB_SITE_ORIGIN`, from the public profile the API supplies. A profile that is
// not published answers 404 and one that cannot be read answers 503, never an empty document.
// Server-only.
import "server-only";

import type { Metadata } from "next";

import { getHomepage } from "../profile";
import { robotsTxt, sitemapXml } from "./data/indexing";
import { llmsTxt } from "./data/llms-txt";
import {
  pageMetadata as buildPageMetadata,
  type IndexedPage,
  type PageFacts,
} from "./data/page-metadata";
import { profileTextResponse, textResponse } from "./data/responses";
import { siteOrigin } from "./data/site-origin";

export { ProfileStructuredData } from "./components/profile-structured-data";

export type { IndexedPage, PageFacts } from "./data/page-metadata";

/**
 * An indexed page's metadata on the canonical origin: title, description, canonical address and
 * Open Graph basics, from the facts the page read.
 */
export function pageMetadata(page: IndexedPage, facts: PageFacts): Metadata {
  return buildPageMetadata(siteOrigin(), page, facts);
}

/** The sitemap of the indexed pages; 404 or 503 while the profile is missing or unreadable. */
export async function sitemapResponse(): Promise<Response> {
  const result = await getHomepage();
  const origin = siteOrigin();
  return profileTextResponse(result, "application/xml; charset=utf-8", () => sitemapXml(origin));
}

/** robots.txt; it reads no content, so it is served while the API is down. */
export function robotsResponse(): Response {
  return textResponse(robotsTxt(siteOrigin()), "text/plain; charset=utf-8");
}

/** llms.txt from the profile; 404 or 503 while the profile is missing or unreadable. */
export async function llmsTxtResponse(): Promise<Response> {
  const result = await getHomepage();
  const origin = siteOrigin();
  return profileTextResponse(result, "text/plain; charset=utf-8", (profile) =>
    llmsTxt(origin, profile),
  );
}
