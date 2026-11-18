import type { Metadata } from "next";

/** The pages search engines may index; every other page says `noindex` itself. */
export type IndexedPage = "home" | "experience" | "services" | "cv";

/** What a page's metadata rests on, all of it from the page's own API read. */
export interface PageFacts {
  readonly name: string;
  readonly headline: string;
  /** Markdown that describes the page; its first paragraph becomes the description. */
  readonly summary?: string | null;
}

export function pageMetadata(origin: string, page: IndexedPage, facts: PageFacts): Metadata {
  throw new Error(`not implemented: ${origin} ${page} ${facts.name}`);
}
