import type { ApiClient, RoadmapEventList } from "@sebela/api-client";

export interface RoadmapEventsContent {
  readonly name: string;
  readonly headline: string;
  readonly events: RoadmapEventList;
}

export type RoadmapEventsResult =
  | { readonly status: "ready"; readonly content: RoadmapEventsContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadRoadmapEventsOptions {
  readonly timeoutMs?: number;
}

export function loadRoadmapEvents(
  client: ApiClient,
  options: LoadRoadmapEventsOptions = {},
): Promise<RoadmapEventsResult> {
  return Promise.reject(
    new Error(`not implemented: ${typeof client} ${String(options.timeoutMs)}`),
  );
}
