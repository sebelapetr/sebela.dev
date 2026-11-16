import {
  EducationCreateSchema,
  EducationListSchema,
  EducationSchema,
  EducationUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const LIST = "/v1/education";
const ITEM = "/v1/education/:slug";

/**
 * The HTTP routes of the education records, addressed by stable slug: public list and read with
 * the kind exactly as stored, authenticated create, update and delete. An unknown kind, bounded
 * text out of range or a period without any date or with an end before the start is a
 * `validation_failed` naming the field; a taken slug is a `conflict`. Nothing refers to an
 * education record, so a delete never conflicts.
 */
export function educationRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listEducation",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the education records",
      description:
        "Schools, courses, certifications and other learning milestones, by position, then slug. Each carries its kind exactly as stored.",
      response: {
        status: 200,
        description: "Every education record, in order.",
        schema: EducationListSchema,
      },
      errors: [],
      handle: () => profile.listEducation(),
    }),
    defineRoute({
      operationId: "getEducation",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read an education record",
      params: SlugParamsSchema,
      response: {
        status: 200,
        description: "The education record.",
        schema: EducationSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => profile.getEducation(params.slug),
    }),
    defineRoute({
      operationId: "createEducation",
      method: "POST",
      path: LIST,
      access: "private",
      summary: "Create an education record",
      description:
        "At least one of `startedOn` and `endedOn` is required: a start alone marks ongoing learning, an end alone a completion on that day, and the end is never before the start. The slug is unique and stable; a taken slug is a conflict.",
      body: EducationCreateSchema,
      response: {
        status: 201,
        description: "The created education record.",
        schema: EducationSchema,
        location: ITEM,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createEducation(body),
    }),
    defineRoute({
      operationId: "updateEducation",
      method: "PATCH",
      path: ITEM,
      access: "private",
      summary: "Update an education record",
      description:
        "Changes only the fields sent; the slug cannot change. The period is checked on the resulting record: it keeps at least one date and the end is never before the start.",
      params: SlugParamsSchema,
      body: EducationUpdateSchema,
      response: {
        status: 200,
        description: "The updated education record.",
        schema: EducationSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateEducation(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteEducation",
      method: "DELETE",
      path: ITEM,
      access: "private",
      summary: "Delete an education record",
      params: SlugParamsSchema,
      response: { status: 204, description: "The education record was deleted." },
      errors: ["not_found"],
      handle: async ({ params }) => {
        await profile.deleteEducation(params.slug);
        return undefined;
      },
    }),
  ];
}
