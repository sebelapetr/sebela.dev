// Whether search engines may index the site, from `WEB_INDEXING`, and how a page and a response say
// so. Off unless it is switched on: an unusable value keeps the site out of search engines too.
import type { Metadata } from "next";

import { readIndexingConfig } from "../../../config";

/**
 * Reads `WEB_INDEXING` so that it can never stop a page: an unusable value turns indexing off, and
 * each distinct problem is logged once per process, naming the variable and never its value (the
 * error of `readIndexingConfig` carries none).
 */
export function createIndexingSettings(
  log: (line: string) => void,
): (env: Readonly<Record<string, string | undefined>>) => boolean {
  const reported = new Set<string>();
  return (env) => {
    try {
      return readIndexingConfig(env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unreadable settings";
      if (!reported.has(message)) {
        reported.add(message);
        log(`indexing is off: ${message}`);
      }
      return false;
    }
  };
}

const NOINDEX_HEADERS: Readonly<Record<string, string>> = { "X-Robots-Tag": "noindex, nofollow" };

/** The response headers for the indexing decision: `X-Robots-Tag` while indexing is off. */
export function indexingHeaders(allowed: boolean): Readonly<Record<string, string>> {
  return allowed ? {} : NOINDEX_HEADERS;
}

/** The root layout's metadata for the indexing decision: a robots meta tag while it is off. */
export function indexingMetadata(allowed: boolean): Metadata {
  return allowed ? {} : { robots: { index: false, follow: false } };
}
