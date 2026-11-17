// Which disclosures a link to an item on the experience page must open. Pure, so the server builds
// the index once and the client resolves the address's hash against it.
import type { ExplorationRow } from "../data/explorations";
import type { TechnologyGroup } from "../data/technologies";
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

/** Everything on the experience page a link can point at. */
export interface ExperiencePageItems {
  readonly timeline: readonly TimelineEntry[];
  readonly explorations: readonly ExplorationRow[];
  readonly technologies: readonly TechnologyGroup[];
}

export function deepLinkIndex({ timeline: entries }: ExperiencePageItems): DeepLinkIndex {
  const index: Record<string, readonly string[]> = {};
  for (const entry of entries) {
    index[entry.anchor] = [entry.anchor];
    for (const project of entry.projects) {
      index[project.anchor] = [entry.anchor];
      if (project.caseStudy !== null) {
        index[project.caseStudy.anchor] = [entry.anchor, project.caseStudy.anchor];
      }
    }
  }
  return index;
}

/**
 * The item a hash (`#project-…`, with or without `#`, percent-encoded or not) names, or null when
 * the page has no such item: an empty, malformed, unknown or removed anchor opens nothing.
 */
export function resolveDeepLink(hash: string, index: DeepLinkIndex): DeepLink | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return null;
  let anchor: string;
  try {
    anchor = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // Own keys only: a hash such as `#constructor` must not reach the object's prototype.
  if (!Object.hasOwn(index, anchor)) return null;
  const open = index[anchor];
  return open === undefined ? null : { anchor, open };
}
