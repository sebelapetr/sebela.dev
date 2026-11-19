// What the sitemap and llms.txt list of the AI Roadmap: its pages from the content the profile
// module reads (the overview's areas and modules, the diary's days and the bookshelf's books) and
// the roadmap's own pages, gathered only when every read succeeded.
import { bookshelfHref, diaryHref, roadmapHref, roadmapRoutes, routes } from "../../_shared";
import type { HomepageProfile, HomepageResult } from "../../profile";

/** A module of an area, as the roadmap's discovery lists it. */
export interface DiscoveryModule {
  readonly slug: string;
  readonly name: string;
  /** Markdown, or null. */
  readonly description: string | null;
}

/** An area with its modules, as the roadmap's discovery lists it. */
export interface DiscoveryArea extends DiscoveryModule {
  readonly modules: readonly DiscoveryModule[];
}

/** A book on the bookshelf, as the roadmap's discovery lists it. */
export interface DiscoveryBook {
  readonly slug: string;
  readonly title: string;
  readonly author: string | null;
}

/** The roadmap's pages that the sitemap and llms.txt list, each in the API's order. */
export interface RoadmapDiscovery {
  readonly areas: readonly DiscoveryArea[];
  /** The diary's days, `YYYY-MM-DD`. */
  readonly diaryDates: readonly string[];
  readonly books: readonly DiscoveryBook[];
}

type Read<T> =
  | { readonly status: "ready"; readonly content: T }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

/** The reads the discovery rests on, as the profile module answers them. */
export interface DiscoveryReads {
  readonly homepage: HomepageResult;
  readonly roadmap: Read<{ readonly roadmap: { readonly areas: readonly DiscoveryArea[] } }>;
  readonly diary: Read<{ readonly diary: { readonly days: readonly { readonly date: string }[] } }>;
  readonly bookshelf: Read<{ readonly books: readonly { readonly book: DiscoveryBook }[] }>;
}

/** The profile and the roadmap's pages, or why they cannot be listed. */
export type DiscoveryResult =
  | {
      readonly status: "ready";
      readonly profile: HomepageProfile;
      readonly roadmap: RoadmapDiscovery;
    }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

/**
 * The profile and the roadmap's pages while every read is ready. Any read that cannot be made
 * makes the whole unavailable, so a crawler never keeps a document with pages missing; otherwise
 * any part that is not published makes it missing.
 */
export function discoveryResult(reads: DiscoveryReads): DiscoveryResult {
  const { homepage, roadmap, diary, bookshelf } = reads;
  const all = [homepage, roadmap, diary, bookshelf];
  if (all.some((read) => read.status === "unavailable")) return { status: "unavailable" };
  if (
    homepage.status !== "ready" ||
    roadmap.status !== "ready" ||
    diary.status !== "ready" ||
    bookshelf.status !== "ready"
  ) {
    return { status: "missing" };
  }
  return {
    status: "ready",
    profile: homepage.profile,
    roadmap: {
      areas: roadmap.content.roadmap.areas.map((area) => ({
        slug: area.slug,
        name: area.name,
        description: area.description,
        modules: area.modules.map((module) => ({
          slug: module.slug,
          name: module.name,
          description: module.description,
        })),
      })),
      diaryDates: diary.content.diary.days.map((day) => day.date),
      books: bookshelf.content.books.map(({ book }) => ({
        slug: book.slug,
        title: book.title,
        author: book.author,
      })),
    },
  };
}

/**
 * Every roadmap page's path, in the site's order: the overview, each area followed by its modules,
 * the diary with its days and statistics, the events, the bookshelf with its books and the reading
 * guide.
 */
export function roadmapPaths(roadmap: RoadmapDiscovery): string[] {
  return [
    routes.aiRoadmap,
    ...roadmap.areas.flatMap((area) => [
      roadmapHref({ area: area.slug }),
      ...area.modules.map((module) => roadmapHref({ area: area.slug, module: module.slug })),
    ]),
    roadmapRoutes.diary,
    ...roadmap.diaryDates.map((date) => diaryHref(date)),
    roadmapRoutes.statistics,
    roadmapRoutes.events,
    roadmapRoutes.bookshelf,
    ...roadmap.books.map((book) => bookshelfHref(book.slug)),
    roadmapRoutes.readingGuide,
  ];
}
