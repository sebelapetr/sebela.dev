// The metadata and structured data of the AI Roadmap's own pages below the overview (an area's
// and a module's page): their titles, descriptions, canonical addresses, Open Graph basics and
// breadcrumbs, from the page's own API read.
import type { Metadata } from "next";

/** One step of the way from the roadmap's overview to the page: its name and site path. */
export interface RoadmapPageCrumb {
  readonly name: string;
  readonly href: string;
}

/** What a roadmap page's metadata rests on, all of it from the page's own API read. */
export interface RoadmapPageFacts {
  /** The person's name. */
  readonly name: string;
  /** The way from the overview to the page, the page itself last. */
  readonly breadcrumbs: readonly RoadmapPageCrumb[];
  /** Markdown that describes the page; its first paragraph becomes the description. */
  readonly summary: string | null;
}

export function roadmapPageMetadata(_origin: string, _facts: RoadmapPageFacts): Metadata {
  throw new Error("not implemented", { cause: [_origin, _facts] });
}

export function roadmapStructuredData(_origin: string, _facts: RoadmapPageFacts): object {
  throw new Error("not implemented", { cause: [_origin, _facts] });
}
