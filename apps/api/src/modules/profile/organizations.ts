import {
  OrganizationCreateSchema,
  OrganizationListSchema,
  OrganizationSchema,
  OrganizationUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const LIST = "/v1/organizations";
const ITEM = "/v1/organizations/:slug";

/**
 * The HTTP routes of the organizations, addressed by stable slug: public list and read,
 * authenticated create, update and delete. Domain errors become `not_found` and `conflict`; a
 * delete of an organization that other records still refer to is a `conflict`.
 */
export function organizationRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listOrganizations",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the organizations",
      description: "Ordered by name, ignoring case, then by slug.",
      response: {
        status: 200,
        description: "Every organization, in order.",
        schema: OrganizationListSchema,
      },
      errors: [],
      handle: () => profile.listOrganizations(),
    }),
    defineRoute({
      operationId: "getOrganization",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read an organization",
      params: SlugParamsSchema,
      response: { status: 200, description: "The organization.", schema: OrganizationSchema },
      errors: ["not_found"],
      handle: ({ params }) => profile.getOrganization(params.slug),
    }),
    defineRoute({
      operationId: "createOrganization",
      method: "POST",
      content: "organization",
      path: LIST,
      access: "private",
      summary: "Create an organization",
      description:
        "The slug is unique and stable; a taken slug is a conflict. `logoId` attaches uploaded image media; a PDF or unknown media is refused.",
      body: OrganizationCreateSchema,
      response: {
        status: 201,
        description: "The created organization.",
        schema: OrganizationSchema,
        location: ITEM,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createOrganization(body),
    }),
    defineRoute({
      operationId: "updateOrganization",
      method: "PATCH",
      content: "organization",
      path: ITEM,
      access: "private",
      summary: "Update an organization",
      description:
        "Changes only the fields sent; `null` clears an optional field; the slug cannot change.",
      params: SlugParamsSchema,
      body: OrganizationUpdateSchema,
      response: {
        status: 200,
        description: "The updated organization.",
        schema: OrganizationSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateOrganization(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteOrganization",
      method: "DELETE",
      content: "organization",
      path: ITEM,
      access: "private",
      summary: "Delete an organization",
      description:
        "An organization that other records, such as experiences, still refer to is not deleted; remove those references first.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The organization was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await profile.deleteOrganization(params.slug);
        return undefined;
      },
    }),
  ];
}
