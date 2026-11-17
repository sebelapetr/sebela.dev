// Which disclosures a link to an item on the experience page must open. Pure, so the server builds
// the index once and the client resolves the address's hash against it.
import type { TimelineEntry } from "../data/timeline";

/**
 * Every anchor on the page and the disclosures (by their anchors) that must be open for it to
 * show, outermost first: an experience opens itself, a project its experience, a case study its
 * experience and itself. A plain object, so it can pass from the server to the client.
 */
export type DeepLinkIndex = Readonly<Record<string, readonly string[]>>;

/** A hash that names an item on the page: the item's anchor and what to open to show it. */
export interface DeepLink {
  readonly anchor: string;
  readonly open: readonly string[];
}

export function deepLinkIndex(_entries: readonly TimelineEntry[]): DeepLinkIndex {
  throw new Error(`not implemented: ${JSON.stringify([_entries])}`);
}

/**
 * The item a hash (`#project-…`, with or without `#`, percent-encoded or not) names, or null when
 * the page has no such item: an empty, malformed, unknown or removed anchor opens nothing.
 */
export function resolveDeepLink(_hash: string, _index: DeepLinkIndex): DeepLink | null {
  throw new Error(`not implemented: ${JSON.stringify([_hash, _index])}`);
}
