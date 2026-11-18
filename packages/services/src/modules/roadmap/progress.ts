import type { RoadmapProgress, RoadmapSummary } from "@sebela/contracts";

/** What progress reads from a resource. */
export interface ProgressResource {
  readonly status: "planned" | "in-progress" | "completed" | "paused" | "skipped";
  readonly estimatedMinutes: number | null;
  readonly finishedAt: Date | null;
  readonly updatedAt: Date;
}

/** The progress of one module from its resources. */
export function moduleProgress(resources: readonly ProgressResource[]): RoadmapProgress {
  throw new Error(`Not implemented for ${String(resources.length)} resources.`);
}

/** The progress of one area from the resources of each of its modules. */
export function areaProgress(modules: readonly (readonly ProgressResource[])[]): RoadmapProgress {
  throw new Error(`Not implemented for ${String(modules.length)} modules.`);
}

/** The totals of the whole roadmap from the resources of each module of each area. */
export function roadmapSummary(
  areas: readonly (readonly (readonly ProgressResource[])[])[],
): RoadmapSummary {
  throw new Error(`Not implemented for ${String(areas.length)} areas.`);
}
