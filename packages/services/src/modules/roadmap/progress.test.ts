import { describe, expect, it } from "vitest";

import { RoadmapProgressSchema, RoadmapSummarySchema } from "@sebela/contracts";

import { areaProgress, moduleProgress, roadmapSummary, type ProgressResource } from "./progress.js";

const at = (day: number) => new Date(Date.UTC(2025, 0, day, 12));

/** A resource with the status; finished and updated on the given days when they are given. */
function resource(
  status: ProgressResource["status"],
  options: { finished?: number; updated?: number; minutes?: number | null } = {},
): ProgressResource {
  return {
    status,
    estimatedMinutes: options.minutes === undefined ? 60 : options.minutes,
    finishedAt: options.finished === undefined ? null : at(options.finished),
    updatedAt: at(options.updated ?? 1),
  };
}

describe("module progress", () => {
  // The PRD's table of examples, one row each.
  it.each([
    { statuses: [], completed: 0, total: 0, status: "planned", dated: false },
    { statuses: ["completed", "planned"], completed: 1, total: 2, status: "planned", dated: false },
    {
      statuses: ["completed", "in-progress", "paused"],
      completed: 1,
      total: 3,
      status: "in-progress",
      dated: false,
    },
    {
      statuses: ["completed", "skipped"],
      completed: 1,
      total: 2,
      status: "completed",
      dated: true,
    },
    { statuses: ["skipped", "skipped"], completed: 0, total: 2, status: "completed", dated: false },
    { statuses: ["paused", "planned"], completed: 0, total: 2, status: "planned", dated: false },
  ] as const)("counts $statuses as $completed/$total, $status", (example) => {
    const resources = example.statuses.map((status, index) =>
      resource(status, { finished: 10 + index }),
    );
    const progress = moduleProgress(resources);
    expect(RoadmapProgressSchema.parse(progress)).toEqual(progress);
    expect(progress).toMatchObject({
      completed: example.completed,
      total: example.total,
      status: example.status,
      completedAt: example.dated ? at(10).toISOString() : null,
    });
  });

  it("dates completion with the latest finish among completed resources only", () => {
    const progress = moduleProgress([
      resource("completed", { finished: 3 }),
      resource("completed", { finished: 9 }),
      resource("completed"),
      resource("skipped", { finished: 20 }),
    ]);
    expect(progress.status).toBe("completed");
    expect(progress.completedAt).toBe(at(9).toISOString());
  });

  it("leaves completion undated when no completed resource has a finish", () => {
    const progress = moduleProgress([resource("completed"), resource("skipped")]);
    expect(progress).toMatchObject({ status: "completed", completedAt: null });
  });

  it("is never paused, even when every resource is", () => {
    expect(moduleProgress([resource("paused"), resource("paused")]).status).toBe("planned");
  });

  it("sums estimates of every status, a missing one counting as zero", () => {
    const progress = moduleProgress([
      resource("completed", { minutes: 30 }),
      resource("skipped", { minutes: 45 }),
      resource("planned", { minutes: null }),
    ]);
    expect(progress.estimatedMinutes).toBe(75);
  });

  it("takes the latest resource update as the last update, or null when empty", () => {
    const progress = moduleProgress([
      resource("planned", { updated: 4 }),
      resource("planned", { updated: 7 }),
      resource("planned", { updated: 2 }),
    ]);
    expect(progress.lastUpdatedAt).toBe(at(7).toISOString());
    expect(moduleProgress([])).toEqual({
      completed: 0,
      total: 0,
      status: "planned",
      completedAt: null,
      lastUpdatedAt: null,
      estimatedMinutes: 0,
    });
  });
});

describe("area progress", () => {
  it("applies the module rule to the resources across all its modules", () => {
    const progress = areaProgress([
      [resource("completed", { finished: 2, updated: 3 })],
      [resource("in-progress", { updated: 8 }), resource("paused", { minutes: null })],
    ]);
    expect(progress).toEqual({
      completed: 1,
      total: 3,
      status: "in-progress",
      completedAt: null,
      lastUpdatedAt: at(8).toISOString(),
      estimatedMinutes: 120,
    });
  });

  it("is completed and dated once every module is completed or skipped", () => {
    const progress = areaProgress([
      [resource("completed", { finished: 5 }), resource("skipped", { finished: 30 })],
      [resource("skipped"), resource("completed", { finished: 12 })],
    ]);
    expect(progress).toMatchObject({ completed: 2, total: 4, status: "completed" });
    expect(progress.completedAt).toBe(at(12).toISOString());
  });

  it("is completed but undated when one of its modules is empty", () => {
    const progress = areaProgress([[resource("completed", { finished: 5 })], []]);
    expect(progress).toMatchObject({ completed: 1, total: 1, status: "completed" });
    expect(progress.completedAt).toBeNull();
  });

  it("is planned and undated without modules or with only empty modules", () => {
    for (const modules of [[], [[], []]]) {
      expect(areaProgress(modules)).toEqual({
        completed: 0,
        total: 0,
        status: "planned",
        completedAt: null,
        lastUpdatedAt: null,
        estimatedMinutes: 0,
      });
    }
  });

  it("is completed but undated when everything was skipped", () => {
    const progress = areaProgress([[resource("skipped")], [resource("skipped")]]);
    expect(progress).toMatchObject({ completed: 0, total: 2, status: "completed" });
    expect(progress.completedAt).toBeNull();
  });
});

describe("roadmap summary", () => {
  it("counts every level and totals resources, estimates and the last update", () => {
    const summary = roadmapSummary([
      [
        [
          resource("completed", { minutes: 50, updated: 3 }),
          resource("planned", { minutes: null }),
        ],
        [],
      ],
      [],
      [[resource("skipped", { minutes: 100, updated: 11 })]],
    ]);
    expect(RoadmapSummarySchema.parse(summary)).toEqual(summary);
    expect(summary).toEqual({
      areaCount: 3,
      moduleCount: 3,
      resourceCount: 3,
      completed: 1,
      total: 3,
      estimatedMinutes: 150,
      estimatedHours: 3,
      lastUpdatedAt: at(11).toISOString(),
    });
  });

  it("rounds estimated hours to the nearest whole hour", () => {
    const hours = (minutes: number) =>
      roadmapSummary([[[resource("planned", { minutes })]]]).estimatedHours;
    expect(hours(29)).toBe(0);
    expect(hours(30)).toBe(1);
    expect(hours(89)).toBe(1);
    expect(hours(90)).toBe(2);
  });

  it("is all zeros with no last update for an empty roadmap", () => {
    expect(roadmapSummary([])).toEqual({
      areaCount: 0,
      moduleCount: 0,
      resourceCount: 0,
      completed: 0,
      total: 0,
      estimatedMinutes: 0,
      estimatedHours: 0,
      lastUpdatedAt: null,
    });
  });
});
