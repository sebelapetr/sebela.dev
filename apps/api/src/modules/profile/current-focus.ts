import {
  CurrentFocusCreateSchema,
  CurrentFocusListSchema,
  CurrentFocusSchema,
  CurrentFocusUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const LIST = "/v1/current-focus";
const ITEM = "/v1/current-focus/:slug";

/**
 * The HTTP routes of the current focus, addressed by stable slug: public list and read,
 * authenticated create, update and delete. An entry may be about one existing project and links
 * existing topics in order, both named by slug; an unknown or repeated target or bounded text out of
 * range is a `validation_failed` naming the field, and a taken slug is a `conflict`. Relations and
 * scalars change together or not at all. Nothing refers to a focus entry, so a delete never
 * conflicts; a project or topic it links cannot be deleted while it does.
 */
export function currentFocusRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listCurrentFocus",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the current focus",
      description:
        "What the person is working on or learning now, ordered by position, then slug, each with its optional project and its topics.",
      response: {
        status: 200,
        description: "Every focus entry, in order.",
        schema: CurrentFocusListSchema,
      },
      errors: [],
      handle: () => profile.listCurrentFocus(),
    }),
    defineRoute({
      operationId: "getCurrentFocus",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read a current-focus entry",
      params: SlugParamsSchema,
      response: {
        status: 200,
        description: "The focus entry.",
        schema: CurrentFocusSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => profile.getCurrentFocus(params.slug),
    }),
    defineRoute({
      operationId: "createCurrentFocus",
      method: "POST",
      path: LIST,
      access: "private",
      summary: "Create a current-focus entry",
      description:
        "Creates the entry with its optional `project` and its `topics`, named by the slugs of existing records; an unknown or repeated target is refused with that field and nothing is stored. An omitted link or project means none. The slug is unique and stable; a taken slug is a conflict.",
      body: CurrentFocusCreateSchema,
      response: {
        status: 201,
        description: "The created focus entry.",
        schema: CurrentFocusSchema,
        location: ITEM,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createCurrentFocus(body),
    }),
    defineRoute({
      operationId: "updateCurrentFocus",
      method: "PATCH",
      path: ITEM,
      access: "private",
      summary: "Update a current-focus entry",
      description:
        "Changes only the fields sent; the slug cannot change. A `project` slug replaces the project and `null` removes it; `null` removes the link; a sent `topics` list replaces every link and an empty list removes them. An unknown target is refused and changes nothing.",
      params: SlugParamsSchema,
      body: CurrentFocusUpdateSchema,
      response: {
        status: 200,
        description: "The updated focus entry.",
        schema: CurrentFocusSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateCurrentFocus(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteCurrentFocus",
      method: "DELETE",
      path: ITEM,
      access: "private",
      summary: "Delete a current-focus entry",
      description: "Removes the entry and its topic links; its project and topics stay.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The focus entry was deleted." },
      errors: ["not_found"],
      handle: async ({ params }) => {
        await profile.deleteCurrentFocus(params.slug);
        return undefined;
      },
    }),
  ];
}
