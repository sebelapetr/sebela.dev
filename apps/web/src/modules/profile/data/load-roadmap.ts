import type {
  ApiClient,
  Roadmap,
  RoadmapFollowedSourceList,
  RoadmapGlossaryTermList,
  RoadmapProjectIdeaList,
} from "@sebela/api-client";

/** The content of the AI Roadmap pages, all of it from the API. */
export interface RoadmapContent {
  readonly name: string;
  readonly headline: string;
  /** The whole tree with its derived progress and totals, exactly as the API answered it. */
  readonly roadmap: Roadmap;
  /** The project ideas in the API's order (position, then slug); empty when there are none. */
  readonly projectIdeas: RoadmapProjectIdeaList;
  /** The followed sources in the API's order; empty when there are none. */
  readonly followedSources: RoadmapFollowedSourceList;
  /** The additional terms in the API's order; empty when there are none. */
  readonly glossaryTerms: RoadmapGlossaryTermList;
}

/**
 * What the AI Roadmap pages can show: the content (possibly without areas), a profile that is not
 * published yet, or content that cannot be read now.
 */
export type RoadmapResult =
  | { readonly status: "ready"; readonly content: RoadmapContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadRoadmapOptions {
  /** How long each request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the AI Roadmap's content from the API's public routes: the person and the whole roadmap
 * tree, uncached and limited in time. A person that does not exist makes the pages missing; a
 * failed read of either makes the whole content unavailable, never an empty roadmap. The tree is
 * returned as the API answered it: its order, progress and totals are the API's, never recounted.
 */
export async function loadRoadmap(
  client: ApiClient,
  options: LoadRoadmapOptions = {},
): Promise<RoadmapResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const init = () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });

  try {
    const [personRead, roadmapRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/roadmap", init()),
    ]);
    if (personRead.data === undefined) {
      return personRead.response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    if (roadmapRead.data === undefined) return { status: "unavailable" };
    return {
      status: "ready",
      content: {
        name: personRead.data.name,
        headline: personRead.data.headline,
        roadmap: roadmapRead.data,
        projectIdeas: [],
        followedSources: [],
        glossaryTerms: [],
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
