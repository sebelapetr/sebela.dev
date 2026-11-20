// Which disclosures a link to an item on the experience page must open. Pure, so the server builds
// the index once and the client resolves the address's hash against it.
import { anchorId } from "../../_shared";
import type { ExplorationRow } from "../data/explorations";
import type { TechnologyGroup } from "../data/technologies";
import type { TimelineEntry } from "../data/timeline";

/**
 * Every anchor on the page and the disclosures (by their anchors) that must be open for it to
 * show, outermost first: an experience opens itself, a project its experience, a case study its
 * experience and itself, the secondary technologies their own collapsed list; the independent R&D
 * block, an exploration and the other technology groups are always shown and open nothing. A plain
 * object, so it can pass from the server to the client.
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

export function deepLinkIndex({
  timeline,
  explorations,
  technologies,
}: ExperiencePageItems): DeepLinkIndex {
  const index: Record<string, readonly string[]> = {};
  for (const entry of timeline) {
    index[entry.anchor] = [entry.anchor];
    for (const project of entry.projects) {
      index[project.anchor] = [entry.anchor];
      if (project.caseStudy !== null) {
        index[project.caseStudy.anchor] = [entry.anchor, project.caseStudy.anchor];
      }
    }
  }
  if (explorations.length > 0) index[anchorId({ kind: "independent-rd" })] = [];
  for (const exploration of explorations) index[exploration.anchor] = [];
  for (const group of technologies) {
    index[group.anchor] = group.key === "secondary" ? [group.anchor] : [];
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

/** What made the page follow a link: its load (also after a page change) or a step within it. */
export type DeepLinkTrigger = "load" | "navigation";

/**
 * How the target comes into view: at once when the page loads with the link (a page change stays a
 * jump), smoothly when the visitor moves within the page, and at once again with reduced motion.
 */
export function deepLinkScrollBehavior(
  trigger: DeepLinkTrigger,
  reducedMotion: boolean,
): "instant" | "smooth" {
  throw new Error("not implemented", { cause: { trigger, reducedMotion } });
}

/**
 * The hash (`#…`) a link's address points to when it stays on the current document (same origin,
 * path and query), or null for another page, another address or a link without a hash.
 */
export function inPageHash(href: string, current: string): string | null {
  throw new Error("not implemented", { cause: { href, current } });
}
