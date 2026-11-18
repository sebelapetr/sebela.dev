// The three groups the technologies are shown in (docs/design.md, Technologies), the same on the
// experience page and in the chat's sources, so a link to a group always names one that is there.
import type { Technology } from "@sebela/api-client";

/** A group of technologies, as its anchor names it (`technology-group-<key>`). */
export type TechnologyGroupKey = "core" | "ai-engineering-focus" | "secondary";

/** The groups in the order the experience page shows them. */
export const TECHNOLOGY_GROUP_KEYS: readonly TechnologyGroupKey[] = [
  "core",
  "ai-engineering-focus",
  "secondary",
];

const LABELS: Readonly<Record<TechnologyGroupKey, string>> = {
  core: "Core",
  "ai-engineering-focus": "AI engineering focus",
  secondary: "Other technologies & tools",
};

/**
 * The group a technology is shown in: a primary one in its stored group (core or AI engineering
 * focus), every secondary one in secondary; a primary one without a group in none.
 */
export function technologyGroupOf(technology: Technology): TechnologyGroupKey | null {
  if (technology.tier === "secondary") return "secondary";
  if (technology.group === "core") return "core";
  if (technology.group === "ai_engineering_focus") return "ai-engineering-focus";
  return null;
}

/** The group's heading, for example `AI engineering focus`. */
export function technologyGroupLabel(key: TechnologyGroupKey): string {
  return LABELS[key];
}
