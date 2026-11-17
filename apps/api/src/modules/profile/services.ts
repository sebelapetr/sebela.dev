import {
  ServiceCreateSchema,
  ServiceListSchema,
  ServiceSchema,
  ServiceUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const LIST = "/v1/services";
const ITEM = "/v1/services/:slug";

/**
 * The HTTP routes of the services, addressed by stable slug: public list and read with the
 * evidence resolved in its order, authenticated create, update and delete. Each piece of evidence
 * is typed by `kind`: a project or an exploration by slug, or a link within the site. An unknown
 * or repeated project or exploration, an unsupported kind or an unsafe link is a
 * `validation_failed` naming `evidence`; a taken slug is a `conflict`.
 */
export function serviceRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listServices",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the services",
      description:
        "By position, then slug. Each service carries its evidence in its defined order, each piece typed by `kind`: a project or an exploration resolved to what a page needs, or a link within the site.",
      response: { status: 200, description: "Every service, in order.", schema: ServiceListSchema },
      errors: [],
      handle: () => profile.listServices(),
    }),
    defineRoute({
      operationId: "getService",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read a service",
      params: SlugParamsSchema,
      response: {
        status: 200,
        description: "The service with its evidence in order.",
        schema: ServiceSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => profile.getService(params.slug),
    }),
    defineRoute({
      operationId: "createService",
      method: "POST",
      path: LIST,
      access: "private",
      summary: "Create a service",
      description:
        "Stores the service and its evidence together or not at all. Projects and explorations are named by the slugs of existing records, each at most once; links are paths within the site. The slug is unique and stable, a taken slug is a conflict.",
      body: ServiceCreateSchema,
      response: {
        status: 201,
        description: "The created service.",
        schema: ServiceSchema,
        location: ITEM,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createService(body),
    }),
    defineRoute({
      operationId: "updateService",
      method: "PATCH",
      path: ITEM,
      access: "private",
      summary: "Update a service",
      description:
        "Changes only the fields sent, together or not at all; the slug cannot change. A sent `evidence` list replaces all evidence in its order, an empty list removes it; an omitted one keeps it. A refused update leaves the service and its evidence as they were.",
      params: SlugParamsSchema,
      body: ServiceUpdateSchema,
      response: { status: 200, description: "The updated service.", schema: ServiceSchema },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateService(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteService",
      method: "DELETE",
      path: ITEM,
      access: "private",
      summary: "Delete a service",
      description:
        "Removes the service and its evidence; the projects and explorations it names stay.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The service was deleted." },
      errors: ["not_found"],
      handle: async ({ params }) => {
        await profile.deleteService(params.slug);
        return undefined;
      },
    }),
  ];
}
