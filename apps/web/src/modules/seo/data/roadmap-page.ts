// The metadata, structured data and preview images of the AI Roadmap's own pages below the overview
// (an area's and a module's page, the bookshelf and a book's page): their titles, descriptions,
// canonical addresses, Open Graph basics with a preview image at `/og<page path>`, breadcrumbs and
// the page's own entity (an area or module as a schema.org Course, part of its area, with the API's
// estimate; the bookshelf as an ItemList of its books; a book as a Book), from the page's own API
// read.
import type { Metadata } from "next";

import { plainText } from "../../_shared";
import { OPEN_GRAPH_IMAGE_SIZE, textCard, type OpenGraphCard } from "./open-graph-card";
import { pageUrl } from "./page-metadata";

/** One step of the way from the roadmap's overview to the page: its name and site path. */
export interface RoadmapPageCrumb {
  readonly name: string;
  readonly href: string;
}

/** What every roadmap page's metadata rests on, all of it from the page's own API read. */
interface RoadmapPageBase {
  /** The person's name. */
  readonly name: string;
  /** The way from the overview to the page, the page itself last. */
  readonly breadcrumbs: readonly RoadmapPageCrumb[];
  /** Markdown that describes the page; its first paragraph becomes the description. */
  readonly summary: string | null;
}

/** An area's or a module's page. */
export interface RoadmapCoursePageFacts extends RoadmapPageBase {
  readonly kind: "area" | "module";
  /** The API's planned effort for the page's content in minutes; 0 when nothing is estimated. */
  readonly estimatedMinutes: number;
}

/** A book on the bookshelf, as the bookshelf's structured data lists it. */
export interface RoadmapShelfBookFacts {
  readonly title: string;
  readonly author: string | null;
  /** The book's site path. */
  readonly href: string;
  /** Markdown, or null. */
  readonly description: string | null;
}

/** The bookshelf's page: its books in shelf order. */
export interface RoadmapBookshelfPageFacts extends RoadmapPageBase {
  readonly kind: "bookshelf";
  readonly books: readonly RoadmapShelfBookFacts[];
}

/** A book's page: its own facts; `summary` is the book's description. */
export interface RoadmapBookPageFacts extends RoadmapPageBase {
  readonly kind: "book";
  readonly book: {
    readonly title: string;
    readonly author: string | null;
    readonly isbn: string | null;
    readonly pages: number | null;
    readonly year: number | null;
    /** The cover's site path, or null. */
    readonly image: string | null;
  };
}

/** One page an overview or a list page leads to, as its structured data lists it. */
export interface RoadmapListedPageFacts {
  readonly name: string;
  /** The page's site path. */
  readonly href: string;
  /** Markdown, or null. */
  readonly description?: string | null;
}

/** The roadmap's overview: its areas in the roadmap's order; `summary` is its lead. */
export interface RoadmapOverviewPageFacts extends RoadmapPageBase {
  readonly kind: "overview";
  readonly areas: readonly RoadmapListedPageFacts[];
}

/** The learning diary's list: its days in the diary's order. */
export interface RoadmapDiaryPageFacts extends RoadmapPageBase {
  readonly kind: "diary";
  readonly days: readonly RoadmapListedPageFacts[];
}

/** A diary day's page: its calendar day; `summary` is the day's notes. */
export interface RoadmapDiaryDayPageFacts extends RoadmapPageBase {
  readonly kind: "diary-day";
  /** The calendar day, `YYYY-MM-DD`. */
  readonly date: string;
}

/** The learning statistics' page. */
export interface RoadmapStatisticsPageFacts extends RoadmapPageBase {
  readonly kind: "statistics";
}

/** An event, as the events page's structured data lists it. */
export interface RoadmapEventFacts {
  readonly name: string;
  /** Its first and last calendar day, `YYYY-MM-DD`. */
  readonly startsOn: string;
  readonly endsOn: string;
  /** A safe absolute `http(s)` address, or null. */
  readonly href: string | null;
  readonly online: boolean;
  readonly place: string | null;
  readonly organizer: string | null;
}

/** The events page: its events in the page's order. */
export interface RoadmapEventsPageFacts extends RoadmapPageBase {
  readonly kind: "events";
  readonly events: readonly RoadmapEventFacts[];
}

/** The reading guide: the work it is based on; `summary` is its opening. */
export interface RoadmapReadingGuidePageFacts extends RoadmapPageBase {
  readonly kind: "reading-guide";
  readonly basedOn: { readonly name: string; readonly url: string };
}

/** What a roadmap page's metadata rests on, all of it from the page's own API read. */
export type RoadmapPageFacts =
  | RoadmapOverviewPageFacts
  | RoadmapCoursePageFacts
  | RoadmapDiaryPageFacts
  | RoadmapDiaryDayPageFacts
  | RoadmapStatisticsPageFacts
  | RoadmapEventsPageFacts
  | RoadmapBookshelfPageFacts
  | RoadmapBookPageFacts
  | RoadmapReadingGuidePageFacts;

/** The longest description, so a search result shows it whole. */
const DESCRIPTION_MAX = 160;

/** The label a roadmap page's preview card shows above its name. */
const CARD_LABELS = {
  overview: "Learning roadmap",
  area: "Learning area",
  diary: "Learning diary",
  "diary-day": "Diary day",
  statistics: "Learning statistics",
  events: "Events",
  "reading-guide": "Reading guide",
  module: "Learning module",
  bookshelf: "Bookshelf",
  book: "Book",
} as const;

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
 * on `origin`, and the page's own entity: an area or module as a Course the person provides, with
 * the API's planned estimate when there is one and, for a module, the area's Course it is part of;
 * the bookshelf as an ItemList of its books in shelf order; a book as a Book with every fact it has
 * and none it lacks.
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
      pageEntity(origin, facts, { title, description, url }),
    ],
  };
}

function pageEntity(
  origin: string,
  facts: RoadmapPageFacts,
  { title, description, url }: { title: string; description: string; url: string },
): object {
  const [page, parent] = facts.breadcrumbs.toReversed();
  if (facts.kind === "bookshelf") {
    return {
      "@type": "ItemList",
      "@id": `${url}#books`,
      name: page?.name ?? title,
      numberOfItems: facts.books.length,
      itemListElement: facts.books.map((book, index) => {
        const about = book.description === null ? "" : plainText(book.description, DESCRIPTION_MAX);
        return {
          "@type": "ListItem",
          position: index + 1,
          name: book.author === null ? book.title : `${book.title} by ${book.author}`,
          url: pageUrl(origin, book.href),
          ...(about === "" ? {} : { description: about }),
        };
      }),
    };
  }
  if (facts.kind === "book") {
    const { book } = facts;
    return {
      "@type": "Book",
      "@id": `${url}#book`,
      url,
      name: book.title,
      description,
      ...(book.author === null ? {} : { author: { "@type": "Person", name: book.author } }),
      ...(book.isbn === null ? {} : { isbn: book.isbn }),
      ...(book.pages === null ? {} : { numberOfPages: book.pages }),
      ...(book.year === null ? {} : { datePublished: String(book.year) }),
      ...(book.image === null ? {} : { image: `${origin}${book.image}` }),
      mainEntityOfPage: { "@id": `${url}#webpage` },
    };
  }
  return {
    "@type": "Course",
    "@id": `${url}#course`,
    url,
    name: page?.name ?? title,
    description,
    inLanguage: "en",
    provider: { "@type": "Person", "@id": `${origin}/#person`, name: facts.name },
    mainEntityOfPage: { "@id": `${url}#webpage` },
    ...("estimatedMinutes" in facts && facts.estimatedMinutes > 0
      ? { timeRequired: `PT${String(facts.estimatedMinutes)}M` }
      : {}),
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
}

function describe(origin: string, facts: RoadmapPageFacts) {
  const names = facts.breadcrumbs.map((crumb) => crumb.name).reverse();
  const title = [...names, facts.name].join(" — ");
  const description =
    facts.kind === "book"
      ? bookDescription(facts, names)
      : summaryText(facts.summary, DESCRIPTION_MAX) || fallbackDescription(facts.name, names);
  const page = facts.breadcrumbs.at(-1);
  const url = pageUrl(origin, page?.href ?? "/");
  return { title, description, url };
}

function summaryText(summary: string | null, max: number): string {
  return summary === null ? "" : plainText(summary, max);
}

/**
 * A book's description: its title and author, then its own description as plain text within a
 * search result's length; what the page is when it has neither an author nor a description.
 */
function bookDescription(facts: RoadmapBookPageFacts, names: readonly string[]): string {
  const { title, author } = facts.book;
  const lead = author === null ? `${title}.` : `${title} by ${author}.`;
  const about = summaryText(facts.summary, DESCRIPTION_MAX - lead.length - 1);
  if (about !== "") return `${lead} ${about}`;
  return author === null ? fallbackDescription(facts.name, names) : lead;
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
 * area, a book its author), or the site's own roadmap card when the page cannot be read (`facts` is null).
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
      : facts.kind === "book" && facts.book.author !== null
        ? `By ${facts.book.author}, on ${roadmap}`
        : roadmap;
  return textCard(origin, CARD_LABELS[facts.kind], page?.name ?? ROADMAP_NAME, subtitle);
}
