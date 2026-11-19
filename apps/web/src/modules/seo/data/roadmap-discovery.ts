// What the sitemap and llms.txt list of the AI Roadmap: its pages from the content the profile
// module reads (the overview's areas and modules, the diary's days and the bookshelf's books) and
// the roadmap's own pages, gathered only when every read succeeded.
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

export function discoveryResult(reads: DiscoveryReads): DiscoveryResult {
  throw new Error("not implemented", { cause: reads });
}

export function roadmapPaths(roadmap: RoadmapDiscovery): string[] {
  throw new Error("not implemented", { cause: roadmap });
}
