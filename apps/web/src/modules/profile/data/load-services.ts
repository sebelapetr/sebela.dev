import type { ApiClient, Person, Service } from "@sebela/api-client";

/** The content of the services page, all of it from the API. */
export interface ServicesContent {
  readonly name: string;
  readonly headline: string;
  /** Markdown: the page's header sentence; null when the profile has none. */
  readonly intro: string | null;
  /** The services in the API's order: by position, then slug. */
  readonly services: readonly Service[];
  /** The steps of a collaboration in their stored order; possibly none. */
  readonly collaborationSteps: readonly Person["collaborationSteps"][number][];
  /**
   * Markdown: the honest line on established software practice and the newer AI focus; null when
   * the profile has none.
   */
  readonly note: string | null;
}

/**
 * What the services page can show: the content (possibly without services), a profile that is not
 * published yet, or content that cannot be read now. Never an empty profile.
 */
export type ServicesResult =
  | { readonly status: "ready"; readonly content: ServicesContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadServicesOptions {
  /** How long each request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the services page's content from the API's public routes: the person and the services,
 * uncached and limited in time. A person that does not exist makes the page missing; a failed
 * read of either makes the whole content unavailable, never a page without its services.
 */
export async function loadServices(
  client: ApiClient,
  options: LoadServicesOptions = {},
): Promise<ServicesResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const init = () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });

  try {
    const [personRead, servicesRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/services", init()),
    ]);
    if (personRead.data === undefined) {
      return personRead.response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    if (servicesRead.data === undefined) return { status: "unavailable" };
    const person = personRead.data;
    return {
      status: "ready",
      content: {
        name: person.name,
        headline: person.headline,
        intro: person.servicesIntro,
        services: servicesRead.data,
        collaborationSteps: person.collaborationSteps,
        note: person.servicesNote,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
