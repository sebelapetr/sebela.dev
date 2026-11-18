import {
  ExplorationCreateSchema,
  ExplorationListSchema,
  ExplorationSchema,
  ExplorationUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const LIST = "/v1/explorations";
const ITEM = "/v1/explorations/:slug";

/**
 * The HTTP routes of the explorations, addressed by stable slug: public list and read with the
 * status exactly as stored and the technologies and topics resolved, authenticated create, update
 * and delete. An exploration belongs to no experience or project. An unknown or repeated
 * technology or topic, an unknown status or an end before the start is a `validation_failed`
 * naming the field; a taken slug is a `conflict`, and so is deleting one a service names as
 * evidence.
 */
export function explorationRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listExplorations",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the explorations",
      description:
        "By position, then slug. Each exploration carries its status exactly as stored (`built`, `tested` or `designed`), its concepts in order and its technologies and topics in link order.",
      response: {
        status: 200,
        description: "Every exploration, in order.",
        schema: ExplorationListSchema,
      },
      errors: [],
      handle: () => profile.listExplorations(),
    }),
    defineRoute({
      operationId: "getExploration",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read an exploration",
      params: SlugParamsSchema,
      response: {
        status: 200,
        description: "The exploration with its technologies and topics.",
        schema: ExplorationSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => profile.getExploration(params.slug),
    }),
    defineRoute({
      operationId: "createExploration",
      method: "POST",
      content: "exploration",
      path: LIST,
      access: "private",
      summary: "Create an exploration",
      description:
        "Stores the exploration and its technology and topic links together or not at all. The technologies and topics are slugs of existing records; the slug is unique and stable, a taken slug is a conflict.",
      body: ExplorationCreateSchema,
      response: {
        status: 201,
        description: "The created exploration.",
        schema: ExplorationSchema,
        location: ITEM,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createExploration(body),
    }),
    defineRoute({
      operationId: "updateExploration",
      method: "PATCH",
      content: "exploration",
      path: ITEM,
      access: "private",
      summary: "Update an exploration",
      description:
        "Changes only the fields sent, together or not at all; the slug cannot change. A sent `concepts`, `technologies` or `topics` list replaces the whole list in its order; an omitted one keeps it. The period is checked against the stored start or end.",
      params: SlugParamsSchema,
      body: ExplorationUpdateSchema,
      response: {
        status: 200,
        description: "The updated exploration.",
        schema: ExplorationSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateExploration(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteExploration",
      method: "DELETE",
      content: "exploration",
      path: ITEM,
      access: "private",
      summary: "Delete an exploration",
      description:
        "Removes the exploration and its technology and topic links; the technologies and topics stay. An exploration a service names as evidence is a conflict until it is removed from that service.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The exploration was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await profile.deleteExploration(params.slug);
        return undefined;
      },
    }),
  ];
}
