import {
  ExperienceCreateSchema,
  ExperienceListSchema,
  ExperienceSchema,
  ExperienceUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const LIST = "/v1/experiences";
const ITEM = "/v1/experiences/:slug";

/**
 * The HTTP routes of the experiences, addressed by stable slug: public list and read with the
 * organization and technologies resolved and the owned projects and testimonials in their order,
 * authenticated create, update and delete. An unknown organization or technology, a repeated
 * technology or an end before the start is a `validation_failed` naming the field; a taken slug and
 * an experience that still owns projects or testimonials are a `conflict`.
 */
export function experienceRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listExperiences",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the experiences",
      description:
        "Current roles (no end) first, then by start, latest first, then by end, latest first, then by slug. Each experience carries its organization, its technologies, its projects and its testimonials, each in their order.",
      response: {
        status: 200,
        description: "Every experience, in order.",
        schema: ExperienceListSchema,
      },
      errors: [],
      handle: () => profile.listExperiences(),
    }),
    defineRoute({
      operationId: "getExperience",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read an experience",
      params: SlugParamsSchema,
      response: {
        status: 200,
        description:
          "The experience with its organization, technologies, projects and testimonials.",
        schema: ExperienceSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => profile.getExperience(params.slug),
    }),
    defineRoute({
      operationId: "createExperience",
      method: "POST",
      path: LIST,
      access: "private",
      summary: "Create an experience",
      description:
        "Stores the experience and its technology links together or not at all. The organization and the technologies are slugs of existing records; the slug is unique and stable, a taken slug is a conflict.",
      body: ExperienceCreateSchema,
      response: {
        status: 201,
        description: "The created experience.",
        schema: ExperienceSchema,
        location: ITEM,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createExperience(body),
    }),
    defineRoute({
      operationId: "updateExperience",
      method: "PATCH",
      path: ITEM,
      access: "private",
      summary: "Update an experience",
      description:
        "Changes only the fields sent, together or not at all; the slug cannot change. A sent `technologies` list replaces every link in its order; an omitted one keeps them. The period is checked against the stored start or end.",
      params: SlugParamsSchema,
      body: ExperienceUpdateSchema,
      response: {
        status: 200,
        description: "The updated experience.",
        schema: ExperienceSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateExperience(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteExperience",
      method: "DELETE",
      path: ITEM,
      access: "private",
      summary: "Delete an experience",
      description:
        "Removes the experience and its technology links; the organization and the technologies stay. An experience that still owns projects or testimonials, or that other records refer to, is not deleted.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The experience was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await profile.deleteExperience(params.slug);
        return undefined;
      },
    }),
  ];
}
