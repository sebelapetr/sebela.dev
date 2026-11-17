import type { Technology } from "@sebela/api-client";

import { anchorId } from "../../_shared";

export type TechnologyGroupKey = "core" | "ai-engineering-focus" | "secondary";

/** One group of technologies as the technologies section shows it. */
export interface TechnologyGroup {
  readonly key: TechnologyGroupKey;
  /** The stable anchor of the group on the page, `technology-group-<key>`. */
  readonly anchor: string;
  /** The group's heading, for example `AI engineering focus`. */
  readonly label: string;
  /** In the API's order. */
  readonly technologies: readonly {
    readonly slug: string;
    readonly name: string;
    /** A key of the website's static logos; null when the technology shows no logo. */
    readonly logoKey: string | null;
  }[];
}

const GROUPS: readonly {
  key: TechnologyGroupKey;
  label: string;
  holds: (t: Technology) => boolean;
}[] = [
  { key: "core", label: "Core", holds: (t) => t.tier === "primary" && t.group === "core" },
  {
    key: "ai-engineering-focus",
    label: "AI engineering focus",
    holds: (t) => t.tier === "primary" && t.group === "ai_engineering_focus",
  },
  { key: "secondary", label: "Other technologies & tools", holds: (t) => t.tier === "secondary" },
];

/**
 * The technologies in their groups, in this order: core, AI engineering focus, secondary; each
 * group in the API's order, and a group without technologies left out. Only a core technology
 * shows a logo, and only when its `logoKey` is one of the website's static `logos`: the AI
 * engineering focus is plain text (several are concepts, not products) and so are the secondary
 * technologies. Nothing is added or inferred: a group holds exactly the stored technologies.
 */
export function toTechnologyGroups(
  technologies: readonly Technology[],
  logos: ReadonlySet<string>,
): TechnologyGroup[] {
  return GROUPS.flatMap(({ key, label, holds }) => {
    const members = technologies.filter(holds);
    if (members.length === 0) return [];
    return [
      {
        key,
        anchor: anchorId({ kind: "technology-group", group: key }),
        label,
        technologies: members.map(({ slug, name, logoKey }) => ({
          slug,
          name,
          logoKey: key === "core" && logoKey !== null && logos.has(logoKey) ? logoKey : null,
        })),
      },
    ];
  });
}
