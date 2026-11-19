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

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the learning statistics from the API's public routes: the person and the statistics,
 * uncached and limited in time. A person that does not exist makes the page missing; no logged time
 * is ready with zero totals; any other failed read makes it unavailable, never zero activity. The
 * figures are returned as the API answered them: they are aggregated there, never recounted here.
 */
export async function loadRoadmapStatistics(
  client: ApiClient,
  options: LoadRoadmapStatisticsOptions = {},
): Promise<RoadmapStatisticsResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const init = () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });
  try {
    const [personRead, statisticsRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/roadmap/statistics", init()),
    ]);
    if (personRead.data === undefined) {
      return personRead.response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    if (statisticsRead.data === undefined) return { status: "unavailable" };
    return {
      status: "ready",
      content: {
        name: personRead.data.name,
        headline: personRead.data.headline,
        statistics: statisticsRead.data,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
