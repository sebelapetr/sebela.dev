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

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads what the reading guide needs from the API's public routes: only the person, uncached and
 * limited in time. The guide itself is static text, so no roadmap or supporting-content read can
 * make it unavailable. A person that does not exist makes the page missing; any other failed read
 * makes it unavailable.
 */
export async function loadRoadmapReadingGuide(
  client: ApiClient,
  options: LoadRoadmapReadingGuideOptions = {},
): Promise<RoadmapReadingGuideResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const read = await client.GET("/v1/person", {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (read.data === undefined) {
      return read.response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    return { status: "ready", content: { name: read.data.name } };
  } catch {
    return { status: "unavailable" };
  }
}
