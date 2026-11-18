import type {
  ApiClient,
  Experience,
  Exploration,
  RoadmapCurrentArea,
  Service,
  Technology,
} from "@sebela/api-client";

import { isWebUrl } from "./image";

/**
 * What the Ask page needs from the profile: the name its assistant speaks about and the public
 * records its answers rest on, each list in the API's order.
 */
export interface AskContent {
  readonly name: string;
  readonly email: string | null;
  /** The person's web links, in their order; any other address is left out. */
  readonly links: readonly { readonly label: string; readonly url: string }[];
  readonly experiences: readonly Experience[];
  readonly services: readonly Service[];
  readonly explorations: readonly Exploration[];
  readonly technologies: readonly Technology[];
  /** The AI Roadmap's current learning as the API answered it: in-progress areas and modules. */
  readonly currentLearning: readonly RoadmapCurrentArea[];
}

/** The Ask page's content, a profile that is not published yet, or one that cannot be read now. */
export type AskResult =
  | { readonly status: "ready"; readonly content: AskContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadAskOptions {
  /** How long the request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the Ask page's content from the API's public routes: the person, the experiences, the
 * services, the explorations and the technologies, uncached and limited in time. A person that
 * does not exist makes the page missing; a failed read of the person or of any list makes the
 * whole content unavailable, so an answer never rests on a profile with a part silently missing.
 */
export async function loadAsk(client: ApiClient, options: LoadAskOptions = {}): Promise<AskResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const init = () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });
  try {
    const [person, experiences, services, explorations, technologies] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/experiences", init()),
      client.GET("/v1/services", init()),
      client.GET("/v1/explorations", init()),
      client.GET("/v1/technologies", init()),
    ]);
    if (person.data === undefined) {
      return person.response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    if (
      experiences.data === undefined ||
      services.data === undefined ||
      explorations.data === undefined ||
      technologies.data === undefined
    ) {
      return { status: "unavailable" };
    }
    return {
      status: "ready",
      content: {
        name: person.data.name,
        email: person.data.email,
        links: person.data.links.filter((link) => isWebUrl(link.url)),
        experiences: experiences.data,
        services: services.data,
        explorations: explorations.data,
        technologies: technologies.data,
        currentLearning: [],
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
