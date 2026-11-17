import type { ApiClient, Experience, Exploration, Service, Technology } from "@sebela/api-client";

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
 * Reads the person's name from the API's public person route, uncached and limited in time. A
 * person that does not exist makes the page missing; a failed read makes it unavailable.
 */
export async function loadAsk(client: ApiClient, options: LoadAskOptions = {}): Promise<AskResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const read = await client.GET("/v1/person", {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (read.data === undefined) {
      return read.response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    throw new Error(`not implemented for ${read.data.name}`);
  } catch {
    return { status: "unavailable" };
  }
}
