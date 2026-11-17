import type { Technology } from "@sebela/api-client";

export type TechnologyGroupKey = "core" | "ai-engineering-focus" | "secondary";

export interface TechnologyGroup {
  readonly key: TechnologyGroupKey;
  readonly anchor: string;
  readonly label: string;
  readonly technologies: readonly {
    readonly slug: string;
    readonly name: string;
    readonly logoKey: string | null;
  }[];
}

export function toTechnologyGroups(
  technologies: readonly Technology[],
  logos: ReadonlySet<string>,
): TechnologyGroup[] {
  throw new Error(`not implemented (${String(technologies.length + logos.size)})`);
}
