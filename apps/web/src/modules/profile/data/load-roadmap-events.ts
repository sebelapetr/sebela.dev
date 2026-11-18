import type { ApiClient, RoadmapEventList } from "@sebela/api-client";

/** The content of the roadmap's events page, all of it from the API. */
export interface RoadmapEventsContent {
  readonly name: string;
  readonly headline: string;
  /** Every event, newest first, exactly as the API answered it; `[]` when there is none. */
  readonly events: RoadmapEventList;
}

/** What the events page can show: its content, no profile yet, or content not readable now. */
export type RoadmapEventsResult =
  | { readonly status: "ready"; readonly content: RoadmapEventsContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadRoadmapEventsOptions {
  /** How long each request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the roadmap's events from the API's public routes: the person and every event, uncached
 * and limited in time. A person that does not exist makes the page missing; no events is ready
 * with none; any other failed read makes it unavailable, never empty. The events are returned as
 * the API answered them: their order and attendance are the API's, never recounted.
 */
export async function loadRoadmapEvents(
  client: ApiClient,
  options: LoadRoadmapEventsOptions = {},
): Promise<RoadmapEventsResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const init = () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });
  try {
    const [personRead, eventsRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/roadmap/events", init()),
    ]);
    if (personRead.data === undefined) {
      return personRead.response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    if (eventsRead.data === undefined) return { status: "unavailable" };
    return {
      status: "ready",
      content: {
        name: personRead.data.name,
        headline: personRead.data.headline,
        events: eventsRead.data,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
