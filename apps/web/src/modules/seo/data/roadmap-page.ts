// The metadata and structured data of the AI Roadmap's own pages below the overview (an area's
// and a module's page): their titles, descriptions, canonical addresses, Open Graph basics and
// breadcrumbs, from the page's own API read.
import type { Metadata } from "next";

import { plainText } from "../../_shared";
import type { OpenGraphCard } from "./open-graph-card";
import { pageUrl } from "./page-metadata";

/** One step of the way from the roadmap's overview to the page: its name and site path. */
export interface RoadmapPageCrumb {
  readonly name: string;
  readonly href: string;
}

/** What a roadmap page's metadata rests on, all of it from the page's own API read. */
export interface RoadmapPageFacts {
  /** The person's name. */
  readonly name: string;
  /** Whether the page is an area's or a module's. */
  readonly kind: "area" | "module";
  /** The API's planned effort for the page's content in minutes; 0 when nothing is estimated. */
  readonly estimatedMinutes: number;
  /** The way from the overview to the page, the page itself last. */
  readonly breadcrumbs: readonly RoadmapPageCrumb[];
  /** Markdown that describes the page; its first paragraph becomes the description. */
  readonly summary: string | null;
}

/** The longest description, so a search result shows it whole. */
const DESCRIPTION_MAX = 160;

/**
 * The page's metadata: its title (the breadcrumbs' names from the page up, then the person), its
 * description (the summary's first paragraph as plain text, or what the page is when there is none),
 * its canonical address on `origin`, the same as Open Graph basics with the person as the site and a
 * small Twitter card. Kept out of search results until the roadmap is indexed as a whole.
 */
export function roadmapPageMetadata(origin: string, facts: RoadmapPageFacts): Metadata {
  const { title, description, url } = describe(origin, facts);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, title, description, siteName: facts.name },
    twitter: { card: "summary", title, description },
    robots: { index: false },
  };
}

/**
 * The page's schema.org JSON-LD: the page as part of the website, and its breadcrumbs from the
 * overview on `origin`.
 */
export function roadmapStructuredData(origin: string, facts: RoadmapPageFacts): object {
  const { title, description, url } = describe(origin, facts);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: title,
        description,
        inLanguage: "en",
        isPartOf: { "@id": `${origin}/#website` },
        breadcrumb: { "@id": `${url}#breadcrumb` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: facts.breadcrumbs.map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: crumb.name,
          item: pageUrl(origin, crumb.href),
        })),
      },
    ],
  };
}

function describe(origin: string, facts: RoadmapPageFacts) {
  const names = facts.breadcrumbs.map((crumb) => crumb.name).reverse();
  const title = [...names, facts.name].join(" — ");
  const summary = facts.summary === null ? "" : plainText(facts.summary, DESCRIPTION_MAX);
  const description = summary === "" ? fallbackDescription(facts.name, names) : summary;
  const page = facts.breadcrumbs.at(-1);
  const url = pageUrl(origin, page?.href ?? "/");
  return { title, description, url };
}

/** What the page is, from its names: `Module, part of Area on <name>'s AI Engineering Roadmap.` */
function fallbackDescription(name: string, names: readonly string[]): string {
  // The last name is the overview's, which the sentence names itself.
  const [page, ...parents] = names.slice(0, -1);
  const part = parents.length === 0 ? "" : `, part of ${parents.join(", part of ")}`;
  return `${page ?? "A page"}${part} on ${name}'s AI Engineering Roadmap.`;
}

export function roadmapOpenGraphImageUrl(origin: string, facts: RoadmapPageFacts): string {
  throw new Error("not implemented", { cause: { origin, facts } });
}

export function roadmapOpenGraphCard(
  origin: string,
  facts: RoadmapPageFacts | null,
): OpenGraphCard {
  throw new Error("not implemented", { cause: { origin, facts } });
}
