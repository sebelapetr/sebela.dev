// The metadata of the pages search engines may index: their titles, descriptions, canonical
// addresses on the configured origin, Open Graph basics with the page's own preview image and a
// large Twitter card, from the page's own API read. Nothing here states a fact the profile does
// not hold.
import type { Metadata } from "next";

import { plainText } from "../../_shared";
import { OPEN_GRAPH_IMAGE_SIZE, openGraphImageUrl } from "./open-graph-card";
import { homepageTitle, pageTitle } from "./page-title";
import { PAGES, type IndexedPage } from "./pages";

export type { IndexedPage } from "./pages";

/** What a page's metadata rests on, all of it from the page's own API read. */
export interface PageFacts {
  readonly name: string;
  readonly headline: string;
  /** Markdown that describes the page; its first paragraph becomes the description. */
  readonly summary?: string | null;
}

/** The longest description, so a search result shows it whole. */
const DESCRIPTION_MAX = 160;

/** The page's address on the origin, for example `https://example.test/cv`. */
export function pageUrl(origin: string, path: string): string {
  return `${origin}${path}`;
}

/** A page's title, description and canonical address, shared by its metadata and structured data. */
export interface PageText {
  readonly title: string;
  readonly description: string;
  readonly url: string;
}

/**
 * The page's title (`<name> · <headline>` for the homepage, `<Page> · <name>` otherwise, within
 * `TITLE_MAX` characters with the name never shortened), its description (the summary's first
 * paragraph as plain text, or the headline) and its canonical address on `origin`.
 */
export function pageText(origin: string, page: IndexedPage, facts: PageFacts): PageText {
  const { path, label } = PAGES[page];
  const title =
    label === null ? homepageTitle(facts.name, facts.headline) : pageTitle(facts.name, label);
  const summary = facts.summary == null ? "" : plainText(facts.summary, DESCRIPTION_MAX);
  const description = summary === "" ? facts.headline : summary;
  return { title, description, url: pageUrl(origin, path) };
}

/**
 * The page's metadata: its title, description and canonical address (`pageText`), the same as Open
 * Graph basics with the person as the site, the page's preview image on `origin` (its alt text is
 * the title) and a large Twitter card.
 */
export function pageMetadata(origin: string, page: IndexedPage, facts: PageFacts): Metadata {
  const { title, description, url } = pageText(origin, page, facts);
  const image = openGraphImageUrl(origin, page);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title,
      description,
      siteName: facts.name,
      images: [{ url: image, ...OPEN_GRAPH_IMAGE_SIZE, type: "image/png", alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
