import { CvSchema } from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

/**
 * The public, read-only route of the assembled CV: the data of the print-friendly CV page, read
 * from the stored profile on every request. It never creates data and never renders or generates
 * the CV PDF, which it only names. `not_found` while there is no person.
 */
export function cvRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "getCv",
      method: "GET",
      path: "/v1/cv",
      access: "public",
      summary: "Read the assembled CV",
      description:
        "The person with contacts and summary, the experiences selected for the CV, the technologies in their tiers and groups, the education records, the explorations in a section of their own with their status exactly as stored (`built`, `tested` or `designed`) and the current, manually uploaded CV PDF or `null`. Absent sections are empty lists. While there is no person this answers 404 `not_found` and creates nothing.",
      response: { status: 200, description: "The assembled CV.", schema: CvSchema },
      errors: ["not_found"],
      handle: () => profile.getCv(),
    }),
  ];
}
