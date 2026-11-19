// The learning statistics' HTTP route, private to the roadmap module and part of its routes: one
// public read. The time it counts is written only through the authenticated time-entry routes.
import { RoadmapStatisticsSchema } from "@sebela/contracts";
import type { RoadmapService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const STATISTICS = "/v1/roadmap/statistics";

/** The route of the learning statistics over the roadmap service. */
export function statisticsRoutes(roadmap: RoadmapService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "getRoadmapStatistics",
      method: "GET",
      path: STATISTICS,
      access: "public",
      summary: "Read the learning statistics",
      description:
        "Every time entry of the learning diary counted exactly once in each view, in whole " +
        "seconds aggregated before any rounding: as resource time, book time (a resource of type " +
        "`book`) or event attendance, which always sum to the total. Days, Monday-start weeks " +
        "and months are Europe/Prague calendar periods; an interval crossing midnight is already " +
        "split into its days and a daylight-saving day keeps its actual length. Areas and " +
        "modules hold study time through each resource's current module, never event " +
        "attendance. An empty diary is zero totals and empty lists.",
      response: {
        status: 200,
        description: "The learning statistics.",
        schema: RoadmapStatisticsSchema,
      },
      errors: [],
      handle: () => roadmap.getStatistics(),
    }),
  ];
}
