import type {
  ApiClient,
  RoadmapArea,
  RoadmapTreeArea,
  RoadmapTreeModule,
} from "@sebela/api-client";

/** The content of an AI Roadmap area's page, all of it from the API. */
export interface RoadmapAreaContent {
  readonly name: string;
  readonly headline: string;
  /** The area with its modules, resources and derived progress, exactly as the API answered it. */
  readonly area: RoadmapTreeArea;
}

/** The content of an AI Roadmap module's page, all of it from the API. */
export interface RoadmapModuleContent {
  readonly name: string;
  readonly headline: string;
  /** The module's area, without progress, as the API answered it. */
  readonly area: RoadmapArea;
  /** The module with its resources and derived progress, exactly as the API answered it. */
  readonly module: RoadmapTreeModule;
}

/** What an area's page can show: its content, no such page, or content that cannot be read now. */
export type RoadmapAreaResult =
  | { readonly status: "ready"; readonly content: RoadmapAreaContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

/** What a module's page can show: its content, no such page, or content that cannot be read now. */
export type RoadmapModuleResult =
  | { readonly status: "ready"; readonly content: RoadmapModuleContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadRoadmapDetailOptions {
  /** How long each request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

export function loadRoadmapArea(
  _client: ApiClient,
  _area: string,
  _options: LoadRoadmapDetailOptions = {},
): Promise<RoadmapAreaResult> {
  return Promise.reject(new Error("not implemented", { cause: _options }));
}

export function loadRoadmapModule(
  _client: ApiClient,
  _area: string,
  _module: string,
  _options: LoadRoadmapDetailOptions = {},
): Promise<RoadmapModuleResult> {
  return Promise.reject(new Error("not implemented", { cause: _options }));
}
