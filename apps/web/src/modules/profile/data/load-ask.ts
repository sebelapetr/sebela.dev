import type { ApiClient } from "@sebela/api-client";

/** What the Ask page needs from the profile: the name its assistant speaks about. */
export interface AskContent {
  readonly name: string;
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
    return { status: "ready", content: { name: read.data.name } };
  } catch {
    return { status: "unavailable" };
  }
}
