// The metadata, structured data and preview images of the AI Roadmap's own pages below the overview
// (an area's and a module's page): their titles, descriptions, canonical addresses, Open Graph
// basics with a preview image at `/og<page path>`, breadcrumbs and the page as a schema.org Course
// (part of its area, with the API's estimate), from the page's own API read.
import type { Metadata } from "next";

import { plainText } from "../../_shared";
import { OPEN_GRAPH_IMAGE_SIZE, textCard, type OpenGraphCard } from "./open-graph-card";
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

/** The label a roadmap page's preview card shows above its name. */
const CARD_LABELS = { area: "Learning area", module: "Learning module" } as const;

/** The roadmap's own name, on the site's fallback card and in every page's description. */
const ROADMAP_NAME = "AI Engineering Roadmap";

/**
 * The page's metadata: its title (the breadcrumbs' names from the page up, then the person), its
 * description (the summary's first paragraph as plain text, or what the page is when there is none),
 * its canonical address on `origin`, the same as Open Graph basics with the person as the site, the
 * page's preview image on `origin` (its alt text is the title) and a large Twitter card. Kept out of
 * search results until the roadmap is indexed as a whole.
 */
export function roadmapPageMetadata(origin: string, facts: RoadmapPageFacts): Metadata {
  const { title, description, url } = describe(origin, facts);
  const image = roadmapOpenGraphImageUrl(origin, facts);
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
    robots: { index: false },
  };
}

/**
 * The page's schema.org JSON-LD: the page as part of the website, its breadcrumbs from the overview
 * on `origin`, and the area or module as a Course the person provides, with the API's planned
 * estimate when there is one and, for a module, the area's Course it is part of.
 */
export function roadmapStructuredData(origin: string, facts: RoadmapPageFacts): object {
  const { title, description, url } = describe(origin, facts);
  const [page, parent] = facts.breadcrumbs.toReversed();
  const course = {
    "@type": "Course",
    "@id": `${url}#course`,
    url,
    name: page?.name ?? title,
    description,
    inLanguage: "en",
    provider: { "@type": "Person", "@id": `${origin}/#person`, name: facts.name },
    mainEntityOfPage: { "@id": `${url}#webpage` },
    ...(facts.estimatedMinutes > 0 ? { timeRequired: `PT${String(facts.estimatedMinutes)}M` } : {}),
    ...(facts.kind === "module" && parent !== undefined
      ? {
          isPartOf: {
            "@type": "Course",
            "@id": `${pageUrl(origin, parent.href)}#course`,
            name: parent.name,
            url: pageUrl(origin, parent.href),
          },
        }
      : {}),
  };
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
      course,
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
  return `${page ?? "A page"}${part} on ${name}'s ${ROADMAP_NAME}.`;
}

/**
 * The address of the page's preview image on `origin`: the page's own path below `/og`, for example
 * `https://example.test/og/ai-roadmap/<area>/<module>`.
 */
export function roadmapOpenGraphImageUrl(origin: string, facts: RoadmapPageFacts): string {
  return `${origin}/og${facts.breadcrumbs.at(-1)?.href ?? "/ai-roadmap"}`;
}

/**
 * The page's preview card: its kind, its name and whose roadmap it is on (a module's also names its
 * area), or the site's own roadmap card when the page cannot be read (`facts` is null).
 */
export function roadmapOpenGraphCard(
  origin: string,
  facts: RoadmapPageFacts | null,
): OpenGraphCard {
  if (facts === null) return textCard(origin, ROADMAP_NAME, new URL(origin).host, null);
  const [page, parent] = facts.breadcrumbs.toReversed();
  const roadmap = `${facts.name}'s ${ROADMAP_NAME}`;
  const subtitle =
    facts.kind === "module" && parent !== undefined
      ? `Part of ${parent.name} on ${roadmap}`
      : roadmap;
  return textCard(origin, CARD_LABELS[facts.kind], page?.name ?? ROADMAP_NAME, subtitle);
}
