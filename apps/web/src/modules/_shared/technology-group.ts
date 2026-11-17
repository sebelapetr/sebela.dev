// The three groups the technologies are shown in (docs/design.md, Technologies), the same on the
// experience page and in the chat's sources, so a link to a group always names one that is there.
import type { Technology } from "@sebela/api-client";

/** A group of technologies, as its anchor names it (`technology-group-<key>`). */
export type TechnologyGroupKey = "core" | "ai-engineering-focus" | "secondary";

/**
 * The group a technology is shown in: a primary one in its stored group (core or AI engineering
 * focus), every secondary one in secondary; a primary one without a group in none.
 */
export function technologyGroupOf(technology: Technology): TechnologyGroupKey | null {
  throw new Error(`not implemented for ${technology.slug}`);
}

/** The group's heading, for example `AI engineering focus`. */
export function technologyGroupLabel(key: TechnologyGroupKey): string {
  throw new Error(`not implemented for ${key}`);
}
