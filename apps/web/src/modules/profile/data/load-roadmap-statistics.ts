import type { ApiClient, RoadmapStatistics } from "@sebela/api-client";

/** The content of the learning statistics page, all of it from the API. */
export interface RoadmapStatisticsContent {
  readonly name: string;
  readonly headline: string;
  /** The API's learning statistics, exactly as it answered them. */
  readonly statistics: RoadmapStatistics;
}

/** What the statistics page can show: its content, no profile yet, or content not readable now. */
export type RoadmapStatisticsResult =
  | { readonly status: "ready"; readonly content: RoadmapStatisticsContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadRoadmapStatisticsOptions {
  /** How long each request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

export function loadRoadmapStatistics(
  client: ApiClient,
  options: LoadRoadmapStatisticsOptions = {},
): Promise<RoadmapStatisticsResult> {
  return Promise.reject(new Error("not implemented", { cause: { client, options } }));
}
