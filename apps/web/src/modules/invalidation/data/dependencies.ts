import type { ContentChange, ContentDomain } from "@sebela/contracts";

/**
 * A part of the website's cache a notification can invalidate. Only `profile` exists: every page,
 * metadata, the sitemap, `llms.txt` and the Open Graph images are rendered from the profile reads,
 * and that cache is invalidated as a whole.
 */
export type CacheScope = "profile";

/**
 * Which cache scopes a change of each content domain affects. Coarse on purpose: a record is
 * related to others (an experience to its organization, projects and technologies; a service to
 * its evidence; media to the records showing them), and a change or deletion must also reach the
 * pages that showed it before. Invalidating the whole profile covers every former and current
 * dependant without the website having to know them. Typed over every domain, so a new domain in
 * the contract does not compile until it is mapped.
 */
export const dependencyMap: Readonly<Record<ContentDomain, readonly CacheScope[]>> = {
  person: ["profile"],
  technology: ["profile"],
  topic: ["profile"],
  organization: ["profile"],
  experience: ["profile"],
  project: ["profile"],
  "case-study": ["profile"],
  testimonial: ["profile"],
  exploration: ["profile"],
  service: ["profile"],
  education: ["profile"],
  "current-focus": ["profile"],
  media: ["profile"],
  // The AI Roadmap's pages (the overview, an area's address) and their metadata read the whole
  // tree with its derived progress and totals in one call, so a change of an area, a module or a
  // resource (or of a topic it uses) refreshes them with the rest of the profile.
  "roadmap-area": ["profile"],
  "roadmap-module": ["profile"],
  "roadmap-resource": ["profile"],
};

/**
 * The scopes the changes affect, each once, taken from the map by domain only: the record a change
 * names never chooses a scope, an address or a cache key.
 */
export function scopesFor(changes: readonly ContentChange[]): CacheScope[] {
  const scopes = new Set<CacheScope>();
  for (const change of changes) {
    for (const scope of dependencyMap[change.domain]) scopes.add(scope);
  }
  return [...scopes];
}
