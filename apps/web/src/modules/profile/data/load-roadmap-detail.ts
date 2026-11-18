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

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads an area's page from the API's public routes: the person and the area with its modules,
 * resources and derived progress, uncached and limited in time. An area or person that does not
 * exist, or an address that is not a slug, makes the page missing; any other failed read makes it
 * unavailable, never missing. The area is returned as the API answered it.
 */
export async function loadRoadmapArea(
  client: ApiClient,
  area: string,
  options: LoadRoadmapDetailOptions = {},
): Promise<RoadmapAreaResult> {
  const init = requestInit(options);
  try {
    const [personRead, areaRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/roadmap/tree/{area}", { params: { path: { area } }, ...init() }),
    ]);
    if (personRead.data === undefined) return failedRead(personRead.response);
    if (areaRead.data === undefined) return failedRead(areaRead.response);
    return {
      status: "ready",
      content: {
        name: personRead.data.name,
        headline: personRead.data.headline,
        area: areaRead.data.area,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Reads a module's page from the API's public routes: the person and the module with its area,
 * resources and derived progress, uncached and limited in time. A module that does not exist or
 * lies under another area, a person that does not exist, or an address that is not a slug makes the
 * page missing; any other failed read makes it unavailable, never missing.
 */
export async function loadRoadmapModule(
  client: ApiClient,
  area: string,
  module: string,
  options: LoadRoadmapDetailOptions = {},
): Promise<RoadmapModuleResult> {
  const init = requestInit(options);
  try {
    const [personRead, moduleRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/roadmap/tree/{area}/{module}", {
        params: { path: { area, module } },
        ...init(),
      }),
    ]);
    if (personRead.data === undefined) return failedRead(personRead.response);
    if (moduleRead.data === undefined) return failedRead(moduleRead.response);
    return {
      status: "ready",
      content: {
        name: personRead.data.name,
        headline: personRead.data.headline,
        area: moduleRead.data.area,
        module: moduleRead.data.module,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

function requestInit(options: LoadRoadmapDetailOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });
}

/** A record that does not exist, or an address that is not one, is missing; all else unavailable. */
function failedRead(response: Response): { readonly status: "missing" | "unavailable" } {
  return response.status === 404 || response.status === 400
    ? { status: "missing" }
    : { status: "unavailable" };
}
