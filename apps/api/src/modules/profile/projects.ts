import {
  ProjectCreateSchema,
  ProjectListSchema,
  ProjectSchema,
  ProjectUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const LIST = "/v1/projects";
const ITEM = "/v1/projects/:slug";

/**
 * The HTTP routes of the projects, addressed by stable slug: public list and read with the
 * technologies resolved and the owning experience named by slug, authenticated create, update and
 * delete. A missing or unknown experience, an unknown or repeated technology, an invalid link or
 * an end before the start is a `validation_failed` naming the field; a taken slug and a
 * project with a case study or other references are a `conflict`. Each project carries its case
 * study, or `null`; the case study is written at its own address.
 */
export function projectRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listProjects",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the projects",
      description:
        "Grouped by owning experience in the experience order, then by position, then by slug. Each project names its experience by slug and carries its technologies in their order.",
      response: {
        status: 200,
        description: "Every project, in order.",
        schema: ProjectListSchema,
      },
      errors: [],
      handle: () => profile.listProjects(),
    }),
    defineRoute({
      operationId: "getProject",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read a project",
      params: SlugParamsSchema,
      response: {
        status: 200,
        description: "The project with its technologies.",
        schema: ProjectSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => profile.getProject(params.slug),
    }),
    defineRoute({
      operationId: "createProject",
      method: "POST",
      path: LIST,
      access: "private",
      summary: "Create a project",
      description:
        "Stores the project in its experience together with its technology links, or nothing. The experience and the technologies are slugs of existing records; the slug is unique and stable across all experiences, a taken slug is a conflict.",
      body: ProjectCreateSchema,
      response: {
        status: 201,
        description: "The created project.",
        schema: ProjectSchema,
        location: ITEM,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createProject(body),
    }),
    defineRoute({
      operationId: "updateProject",
      method: "PATCH",
      path: ITEM,
      access: "private",
      summary: "Update a project",
      description:
        "Changes only the fields sent, together or not at all; the slug cannot change. A sent `experience` moves the project to that existing experience, which then is its only owner. A sent `technologies` list replaces every link in its order; an omitted one keeps them. The period is checked against the stored start or end.",
      params: SlugParamsSchema,
      body: ProjectUpdateSchema,
      response: {
        status: 200,
        description: "The updated project.",
        schema: ProjectSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateProject(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteProject",
      method: "DELETE",
      path: ITEM,
      access: "private",
      summary: "Delete a project",
      description:
        "Removes the project and its technology links; the experience and the technologies stay. A project with a case study, or one that other records still refer to, is not deleted.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The project was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await profile.deleteProject(params.slug);
        return undefined;
      },
    }),
  ];
}
