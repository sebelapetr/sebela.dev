// Derived roadmap progress, computed on every read and never stored. The rules carry over the
// original application's: a count of completed resources over all resources, a display status that
// is never `paused`, and a completion date only for a container that is entirely done.
import type { RoadmapDerivedStatus, RoadmapProgress, RoadmapSummary } from "@sebela/contracts";

/** What progress reads from a resource. */
export interface ProgressResource {
  readonly status: "planned" | "in-progress" | "completed" | "paused" | "skipped";
  readonly estimatedMinutes: number | null;
  readonly finishedAt: Date | null;
  readonly updatedAt: Date;
}

const isDone = (resource: ProgressResource) =>
  resource.status === "completed" || resource.status === "skipped";

/** The latest of the instants as an ISO string, or `null` when there are none. */
function latest(instants: readonly (Date | null)[]): string | null {
  let found: Date | null = null;
  for (const instant of instants) {
    if (instant !== null && (found === null || instant > found)) found = instant;
  }
  return found === null ? null : found.toISOString();
}

/**
 * `planned` when empty, `completed` when every resource is completed or skipped, `in-progress`
 * when any is in progress, otherwise `planned`. A paused resource never makes its parent paused.
 */
function derivedStatus(resources: readonly ProgressResource[]): RoadmapDerivedStatus {
  if (resources.length === 0) return "planned";
  if (resources.every(isDone)) return "completed";
  if (resources.some((resource) => resource.status === "in-progress")) return "in-progress";
  return "planned";
}

/** The latest finish among completed resources; skipping never invents a study date. */
function latestCompletion(resources: readonly ProgressResource[]): string | null {
  return latest(
    resources.filter((resource) => resource.status === "completed").map((r) => r.finishedAt),
  );
}

/** The parts of progress that only count the resources, whatever container holds them. */
function counted(resources: readonly ProgressResource[]) {
  return {
    completed: resources.filter((resource) => resource.status === "completed").length,
    total: resources.length,
    status: derivedStatus(resources),
    lastUpdatedAt: latest(resources.map((resource) => resource.updatedAt)),
    estimatedMinutes: resources.reduce(
      (sum, resource) => sum + (resource.estimatedMinutes ?? 0),
      0,
    ),
  };
}

/**
 * The progress of one module from its resources. Its completion date exists only when it is
 * non-empty and every resource is completed or skipped.
 */
export function moduleProgress(resources: readonly ProgressResource[]): RoadmapProgress {
  const { completed, total, status, lastUpdatedAt, estimatedMinutes } = counted(resources);
  const completedAt = status === "completed" && total > 0 ? latestCompletion(resources) : null;
  return { completed, total, status, completedAt, lastUpdatedAt, estimatedMinutes };
}

/**
 * The progress of one area from the resources of each of its modules: the module rule applied to
 * all of them. Its completion date additionally needs at least one module and every module to be
 * non-empty, so an area with an empty module can be completed without a date.
 */
export function areaProgress(modules: readonly (readonly ProgressResource[])[]): RoadmapProgress {
  const resources = modules.flat();
  const { completed, total, status, lastUpdatedAt, estimatedMinutes } = counted(resources);
  const dated =
    status === "completed" &&
    modules.length > 0 &&
    modules.every((module) => module.length > 0 && module.every(isDone));
  const completedAt = dated ? latestCompletion(resources) : null;
  return { completed, total, status, completedAt, lastUpdatedAt, estimatedMinutes };
}

/**
 * The totals of the whole roadmap from the resources of each module of each area. Estimated hours
 * are the summed minutes over 60, rounded to the nearest whole hour: planned effort, not logged time.
 */
export function roadmapSummary(
  areas: readonly (readonly (readonly ProgressResource[])[])[],
): RoadmapSummary {
  const modules = areas.flat();
  const resources = modules.flat();
  const { completed, total, lastUpdatedAt, estimatedMinutes } = counted(resources);
  return {
    areaCount: areas.length,
    moduleCount: modules.length,
    resourceCount: resources.length,
    completed,
    total,
    estimatedMinutes,
    estimatedHours: Math.round(estimatedMinutes / 60),
    lastUpdatedAt,
  };
}
