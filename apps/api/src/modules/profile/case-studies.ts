import {
  CaseStudyCreateSchema,
  CaseStudySchema,
  CaseStudyUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

/** The case study of the project with the slug; a project has at most one. */
const ITEM = "/v1/projects/:slug/case-study";
/** The `Location` of a created case study, filled from the slug of its project. */
const LOCATION = "/v1/projects/:project/case-study";

/**
 * The HTTP routes of the case studies, addressed through their project's stable slug: public read,
 * authenticated create, update and delete. An unknown project or a project without a case study is
 * `not_found`; a second case study of a project is a `conflict`.
 */
export function caseStudyRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "getCaseStudy",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read the case study of a project",
      description:
        "The long-form narrative of the project and the person's role in it; the body is Markdown as written, never HTML. The project's own read carries the same case study.",
      params: SlugParamsSchema,
      response: { status: 200, description: "The case study.", schema: CaseStudySchema },
      errors: ["not_found"],
      handle: ({ params }) => profile.getCaseStudy(params.slug),
    }),
    defineRoute({
      operationId: "createCaseStudy",
      method: "POST",
      path: ITEM,
      access: "private",
      summary: "Create the case study of a project",
      description:
        "Stores the case study of the existing project named in the path. A project has at most one case study; a second one, also from a competing create, is a conflict. The body is Markdown, stored as written.",
      params: SlugParamsSchema,
      body: CaseStudyCreateSchema,
      response: {
        status: 201,
        description: "The created case study.",
        schema: CaseStudySchema,
        location: LOCATION,
      },
      errors: ["not_found", "conflict"],
      handle: ({ params, body }) => profile.createCaseStudy(params.slug, body),
    }),
    defineRoute({
      operationId: "updateCaseStudy",
      method: "PATCH",
      path: ITEM,
      access: "private",
      summary: "Update the case study of a project",
      description: "Changes only the fields sent; the project it belongs to cannot change.",
      params: SlugParamsSchema,
      body: CaseStudyUpdateSchema,
      response: { status: 200, description: "The updated case study.", schema: CaseStudySchema },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateCaseStudy(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteCaseStudy",
      method: "DELETE",
      path: ITEM,
      access: "private",
      summary: "Delete the case study of a project",
      description:
        "Removes the case study and leaves the project. A project with a case study cannot be deleted until its case study is.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The case study was deleted." },
      errors: ["not_found"],
      handle: async ({ params }) => {
        await profile.deleteCaseStudy(params.slug);
        return undefined;
      },
    }),
  ];
}
