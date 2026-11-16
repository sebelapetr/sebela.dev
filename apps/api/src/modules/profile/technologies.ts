import {
  SlugParamsSchema,
  TechnologyCreateSchema,
  TechnologyListSchema,
  TechnologySchema,
  TechnologyUpdateSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const LIST = "/v1/technologies";
const ITEM = "/v1/technologies/:slug";

/**
 * The HTTP routes of the technology catalog, addressed by stable slug: public list and read,
 * authenticated create, update and delete. Domain errors become `not_found` and `conflict`; a
 * delete of a technology that other records still link is a `conflict`.
 */
export function technologyRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listTechnologies",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the technologies",
      description: "Ordered by tier (primary first), group (core first), position and slug.",
      response: {
        status: 200,
        description: "Every technology, in catalog order.",
        schema: TechnologyListSchema,
      },
      errors: [],
      handle: () => profile.listTechnologies(),
    }),
    defineRoute({
      operationId: "getTechnology",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read a technology",
      params: SlugParamsSchema,
      response: { status: 200, description: "The technology.", schema: TechnologySchema },
      errors: ["not_found"],
      handle: ({ params }) => profile.getTechnology(params.slug),
    }),
    defineRoute({
      operationId: "createTechnology",
      method: "POST",
      path: LIST,
      access: "private",
      summary: "Create a technology",
      description: "The slug is unique and stable; a taken slug is a conflict.",
      body: TechnologyCreateSchema,
      response: {
        status: 201,
        description: "The created technology.",
        schema: TechnologySchema,
        location: ITEM,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createTechnology(body),
    }),
    defineRoute({
      operationId: "updateTechnology",
      method: "PATCH",
      path: ITEM,
      access: "private",
      summary: "Update a technology",
      description:
        "Changes only the fields sent; the slug cannot change. A primary technology needs a group and a secondary one has none, also after combining with the stored values.",
      params: SlugParamsSchema,
      body: TechnologyUpdateSchema,
      response: { status: 200, description: "The updated technology.", schema: TechnologySchema },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateTechnology(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteTechnology",
      method: "DELETE",
      path: ITEM,
      access: "private",
      summary: "Delete a technology",
      description:
        "A technology that other records, such as experiences and projects, still link is not deleted; remove those links first.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The technology was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await profile.deleteTechnology(params.slug);
        return undefined;
      },
    }),
  ];
}
