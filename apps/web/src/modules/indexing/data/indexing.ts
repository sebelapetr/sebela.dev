// Whether search engines may index the site, from `WEB_INDEXING`, and how a page and a response say
// so. Off unless it is switched on: an unusable value keeps the site out of search engines too.
import type { Metadata } from "next";

/**
 * Reads `WEB_INDEXING` so that it can never stop a page: an unusable value turns indexing off, and
 * each distinct problem is logged once per process, naming the variable and never its value.
 */
export function createIndexingSettings(
  log: (line: string) => void,
): (env: Readonly<Record<string, string | undefined>>) => boolean {
  return () => {
    log("not implemented");
    throw new Error("not implemented");
  };
}

/** The response headers for the indexing decision: `X-Robots-Tag` while indexing is off. */
export function indexingHeaders(allowed: boolean): Readonly<Record<string, string>> {
  throw new Error(`not implemented: ${String(allowed)}`);
}

/** The root layout's metadata for the indexing decision: a robots meta tag while it is off. */
export function indexingMetadata(allowed: boolean): Metadata {
  throw new Error(`not implemented: ${String(allowed)}`);
}
