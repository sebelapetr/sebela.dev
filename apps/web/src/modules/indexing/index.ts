// The indexing module: whether search engines may index the site (`WEB_INDEXING`, read on every
// request) and how the website says it may not. Off unless `WEB_INDEXING` is `on`, so a worktree, a
// test stack or a production not yet launched never asks to be indexed: then every response carries
// `X-Robots-Tag: noindex, nofollow` (added by `src/proxy.ts`) and every page a robots meta tag with
// the same (the root layout's metadata). robots.txt stays readable, so crawlers can see both. An
// unusable value keeps indexing off and is logged once, naming the variable and never its value.
// Deliberately not `server-only`: the proxy imports it.
import type { Metadata } from "next";

import { createIndexingSettings, indexingHeaders, indexingMetadata } from "./data/indexing";

const indexingAllowed = createIndexingSettings((line) => {
  process.stderr.write(`${line}\n`);
});

/** The headers every response carries for the current indexing decision. */
export function indexingResponseHeaders(): Readonly<Record<string, string>> {
  return indexingHeaders(indexingAllowed(process.env));
}

/** The root layout's metadata for the current indexing decision. */
export function indexingPageMetadata(): Metadata {
  return indexingMetadata(indexingAllowed(process.env));
}
