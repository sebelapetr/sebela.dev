import type { ApiClient } from "@sebela/api-client";

/** The content of the reading guide that comes from the API: whose roadmap it belongs to. */
export interface RoadmapReadingGuideContent {
  readonly name: string;
}

/** What the reading guide can show: its content, no profile yet, or content not readable now. */
export type RoadmapReadingGuideResult =
  | { readonly status: "ready"; readonly content: RoadmapReadingGuideContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadRoadmapReadingGuideOptions {
  /** How long the request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

/** Not implemented yet. */
export function loadRoadmapReadingGuide(
  client: ApiClient,
  options: LoadRoadmapReadingGuideOptions = {},
): Promise<RoadmapReadingGuideResult> {
  return Promise.reject(new Error("not implemented", { cause: { client, options } }));
}
