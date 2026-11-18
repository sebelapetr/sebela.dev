// The metadata of the pages search engines may index: their titles, descriptions, canonical
// addresses on the configured origin and Open Graph basics, from the page's own API read. The Open
// Graph image arrives with the media slice; nothing here states a fact the profile does not hold.
import type { Metadata } from "next";

import { plainText, routes } from "../../_shared";

/** The pages search engines may index; every other page says `noindex` itself. */
export type IndexedPage = "home" | "experience" | "services" | "cv";

/** What a page's metadata rests on, all of it from the page's own API read. */
export interface PageFacts {
  readonly name: string;
  readonly headline: string;
  /** Markdown that describes the page; its first paragraph becomes the description. */
  readonly summary?: string | null;
}

/** The longest description, so a search result shows it whole. */
const DESCRIPTION_MAX = 160;

const PAGES: Record<IndexedPage, { readonly path: string; readonly label: string | null }> = {
  home: { path: routes.home, label: null },
  experience: { path: routes.experience, label: "Experience" },
  services: { path: routes.services, label: "Services" },
  cv: { path: routes.cv, label: "CV" },
};

/** The page's address on the origin, for example `https://example.test/cv`. */
export function pageUrl(origin: string, path: string): string {
  return `${origin}${path}`;
}

/**
 * The page's metadata: its title (`<name> — <headline>` for the homepage, `<Page> — <name>`
 * otherwise), its description (the summary's first paragraph as plain text, or the headline), its
 * canonical address on `origin` and the same as Open Graph basics with the person as the site.
 */
export function pageMetadata(origin: string, page: IndexedPage, facts: PageFacts): Metadata {
  const { path, label } = PAGES[page];
  const title = label === null ? `${facts.name} — ${facts.headline}` : `${label} — ${facts.name}`;
  const summary = facts.summary == null ? "" : plainText(facts.summary, DESCRIPTION_MAX);
  const description = summary === "" ? facts.headline : summary;
  const url = pageUrl(origin, path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, title, description, siteName: facts.name },
  };
}
