import type { ApiClient, Roadmap } from "@sebela/api-client";

/** The content of the AI Roadmap pages, all of it from the API. */
export interface RoadmapContent {
  readonly name: string;
  readonly headline: string;
  /** The whole tree with its derived progress and totals, exactly as the API answered it. */
  readonly roadmap: Roadmap;
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

export function loadRoadmap(
  client: ApiClient,
  options: LoadRoadmapOptions = {},
): Promise<RoadmapResult> {
  return Promise.reject(
    new Error(`not implemented: ${typeof client.GET} ${JSON.stringify(options)}`),
  );
}
