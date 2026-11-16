import {
  CaseStudyCreateSchema,
  CaseStudySchema,
  CaseStudyUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";

import { defineRoute, type RouteDefinition } from "../../routing.js";

/** The case study of the project with the slug; a project has at most one. */
const ITEM = "/v1/projects/:slug/case-study";
/** The `Location` of a created case study, filled from the slug of its project. */
const LOCATION = "/v1/projects/:project/case-study";

const pending = () =>
  Promise.reject(new Error("The case-study routes do not call the case-study service yet."));

/**
 * The HTTP routes of the case studies, addressed through their project's stable slug: public read,
 * authenticated create, update and delete. An unknown project or a project without a case study is
 * `not_found`; a second case study of a project is a `conflict`.
 */
export function caseStudyRoutes(): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "getCaseStudy",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read the case study of a project",
      params: SlugParamsSchema,
      response: { status: 200, description: "The case study.", schema: CaseStudySchema },
      errors: ["not_found"],
      handle: pending,
    }),
    defineRoute({
      operationId: "createCaseStudy",
      method: "POST",
      path: ITEM,
      access: "private",
      summary: "Create the case study of a project",
      params: SlugParamsSchema,
      body: CaseStudyCreateSchema,
      response: {
        status: 201,
        description: "The created case study.",
        schema: CaseStudySchema,
        location: LOCATION,
      },
      errors: ["not_found", "conflict"],
      handle: pending,
    }),
    defineRoute({
      operationId: "updateCaseStudy",
      method: "PATCH",
      path: ITEM,
      access: "private",
      summary: "Update the case study of a project",
      params: SlugParamsSchema,
      body: CaseStudyUpdateSchema,
      response: { status: 200, description: "The updated case study.", schema: CaseStudySchema },
      errors: ["not_found"],
      handle: pending,
    }),
    defineRoute({
      operationId: "deleteCaseStudy",
      method: "DELETE",
      path: ITEM,
      access: "private",
      summary: "Delete the case study of a project",
      params: SlugParamsSchema,
      response: { status: 204, description: "The case study was deleted." },
      errors: ["not_found"],
      handle: pending,
    }),
  ];
}
