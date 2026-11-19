import type {
  RoadmapFollowedSource,
  RoadmapGlossaryTerm,
  RoadmapProjectIdea,
} from "@sebela/api-client";

/** A project idea as the overview lists it. */
export interface ProjectIdeaRow {
  readonly slug: string;
  /** Its place in the API's order, for example `1.`. */
  readonly order: string;
  readonly title: string;
  /** Markdown. */
  readonly whyItMatters: string;
  /** Markdown, or null. */
  readonly howToStart: string | null;
  /** Its topics' names, in their order. */
  readonly topics: readonly string[];
}

/** A followed source as the overview lists it. */
export interface FollowedSourceRow {
  readonly slug: string;
  readonly title: string;
  /** What kind of source it is in the owner's words, or null when it names none. */
  readonly kind: string | null;
  /** Markdown, or null. */
  readonly description: string | null;
  /** A safe absolute `http(s)` address, or null. */
  readonly href: string | null;
}

/** An additional term as the overview lists it. */
export interface GlossaryTermRow {
  readonly slug: string;
  readonly term: string;
  readonly description: string;
}

/** The overview's supporting sections, each in the API's order; empty when it has none. */
export interface SupportingSections {
  readonly projectIdeas: readonly ProjectIdeaRow[];
  readonly followedSources: readonly FollowedSourceRow[];
  readonly glossaryTerms: readonly GlossaryTermRow[];
}

/** The API's supporting content as the overview reads it. */
export interface SupportingContent {
  readonly projectIdeas: readonly RoadmapProjectIdea[];
  readonly followedSources: readonly RoadmapFollowedSource[];
  readonly glossaryTerms: readonly RoadmapGlossaryTerm[];
}

export function toSupportingSections(content: SupportingContent): SupportingSections {
  throw new Error("not implemented", { cause: content });
}
