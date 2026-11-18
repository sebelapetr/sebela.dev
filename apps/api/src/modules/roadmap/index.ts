import {
  RoadmapAreaCreateSchema,
  RoadmapAreaDetailSchema,
  RoadmapAreaParamsSchema,
  RoadmapAreaSchema,
  RoadmapAreaUpdateSchema,
  RoadmapCurrentSchema,
  RoadmapModuleCreateSchema,
  RoadmapModuleDetailSchema,
  RoadmapModuleParamsSchema,
  RoadmapModuleSchema,
  RoadmapModuleUpdateSchema,
  RoadmapResourceCreateSchema,
  RoadmapResourceSchema,
  RoadmapResourceUpdateSchema,
  RoadmapSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { RoadmapService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const TREE = "/v1/roadmap";
const AREA_DETAIL = "/v1/roadmap/tree/:area";
const MODULE_DETAIL = "/v1/roadmap/tree/:area/:module";
const CURRENT = "/v1/roadmap/current";
const AREAS = "/v1/roadmap/areas";
const AREA = "/v1/roadmap/areas/:slug";
const MODULES = "/v1/roadmap/modules";
const MODULE = "/v1/roadmap/modules/:slug";
const RESOURCES = "/v1/roadmap/resources";
const RESOURCE = "/v1/roadmap/resources/:slug";

/**
 * The HTTP routes of the AI roadmap: the whole tree with derived progress in one public read, the
 * public detail of one area or one module of that tree at its nested address (a module under
 * another area is not found), the public current learning (the in-progress areas and modules),
 * public reads of each area, module and resource by slug, and authenticated create, update and
 * delete of each. Domain errors become `not_found`, `conflict` (a taken slug, or deleting a parent
 * that still has children) and `validation_failed` naming the field (a reserved area slug, an
 * unknown parent or topic, a repeated topic, a finish before the start).
 */
export function roadmapRoutes(roadmap: RoadmapService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "getRoadmap",
      method: "GET",
      path: TREE,
      access: "public",
      summary: "Read the whole roadmap",
      description:
        "Every area, its modules and their resources in position order, with each resource's " +
        "topics. Progress of each area and module and the totals are derived on every read from " +
        "the resource statuses and are never stored: `completed` counts completed resources and " +
        "`total` counts all of them, so a skipped resource only enlarges the denominator. " +
        "Estimates are planned effort, never logged time or completed work.",
      response: { status: 200, description: "The roadmap tree.", schema: RoadmapSchema },
      errors: [],
      handle: () => roadmap.getRoadmap(),
    }),
    defineRoute({
      operationId: "getRoadmapAreaDetail",
      method: "GET",
      path: AREA_DETAIL,
      access: "public",
      summary: "Read one area of the roadmap tree",
      description:
        "The area exactly as it appears in the whole roadmap: its modules and their resources in " +
        "position order, with the same derived progress. A missing area is not found.",
      params: RoadmapAreaParamsSchema,
      response: {
        status: 200,
        description: "The area with its modules and resources.",
        schema: RoadmapAreaDetailSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getAreaDetail(params.area),
    }),
    defineRoute({
      operationId: "getRoadmapModuleDetail",
      method: "GET",
      path: MODULE_DETAIL,
      access: "public",
      summary: "Read one module of the roadmap tree",
      description:
        "The module exactly as it appears in the whole roadmap, with its resources in position " +
        "order and its derived progress, and the area it belongs to without its modules. A " +
        "missing area or module, or a module that belongs to another area, is not found.",
      params: RoadmapModuleParamsSchema,
      response: {
        status: 200,
        description: "The module with its resources and its area.",
        schema: RoadmapModuleDetailSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getModuleDetail(params.area, params.module),
    }),
    defineRoute({
      operationId: "getRoadmapCurrent",
      method: "GET",
      path: CURRENT,
      access: "public",
      summary: "Read what is currently being learned",
      description:
        "The areas whose derived status is `in-progress`, each with only its `in-progress` " +
        "modules, in roadmap order, with the same progress as the whole roadmap and without " +
        "resources. Nothing in progress is the valid empty `areas` list.",
      response: {
        status: 200,
        description: "The areas and modules in progress.",
        schema: RoadmapCurrentSchema,
      },
      errors: [],
      handle: () => roadmap.getCurrentLearning(),
    }),

    defineRoute({
      operationId: "getRoadmapArea",
      method: "GET",
      path: AREA,
      access: "public",
      summary: "Read a roadmap area",
      params: SlugParamsSchema,
      response: { status: 200, description: "The area.", schema: RoadmapAreaSchema },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getArea(params.slug),
    }),
    defineRoute({
      operationId: "createRoadmapArea",
      method: "POST",
      content: "roadmap-area",
      path: AREAS,
      access: "private",
      summary: "Create a roadmap area",
      description:
        "The slug is unique and stable; a taken slug is a conflict. The slugs of the roadmap's " +
        "own pages (`diary`, `bookshelf`, `events`, `how-to-read-effectively`) are refused.",
      body: RoadmapAreaCreateSchema,
      response: {
        status: 201,
        description: "The created area.",
        schema: RoadmapAreaSchema,
        location: AREA,
      },
      errors: ["conflict"],
      handle: ({ body }) => roadmap.createArea(body),
    }),
    defineRoute({
      operationId: "updateRoadmapArea",
      method: "PATCH",
      content: "roadmap-area",
      path: AREA,
      access: "private",
      summary: "Update a roadmap area",
      description: "Changes only the fields sent; the slug cannot change.",
      params: SlugParamsSchema,
      body: RoadmapAreaUpdateSchema,
      response: { status: 200, description: "The updated area.", schema: RoadmapAreaSchema },
      errors: ["not_found"],
      handle: ({ params, body }) => roadmap.updateArea(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteRoadmapArea",
      method: "DELETE",
      content: "roadmap-area",
      path: AREA,
      access: "private",
      summary: "Delete a roadmap area",
      description: "An area that still has modules is not deleted; move or delete them first.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The area was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await roadmap.deleteArea(params.slug);
        return undefined;
      },
    }),

    defineRoute({
      operationId: "getRoadmapModule",
      method: "GET",
      path: MODULE,
      access: "public",
      summary: "Read a roadmap module",
      params: SlugParamsSchema,
      response: { status: 200, description: "The module.", schema: RoadmapModuleSchema },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getModule(params.slug),
    }),
    defineRoute({
      operationId: "createRoadmapModule",
      method: "POST",
      content: "roadmap-module",
      path: MODULES,
      access: "private",
      summary: "Create a roadmap module",
      description:
        "The module belongs to the area named by `area`, which must exist. The slug is unique " +
        "across all modules; a taken slug is a conflict.",
      body: RoadmapModuleCreateSchema,
      response: {
        status: 201,
        description: "The created module.",
        schema: RoadmapModuleSchema,
        location: MODULE,
      },
      errors: ["conflict"],
      handle: ({ body }) => roadmap.createModule(body),
    }),
    defineRoute({
      operationId: "updateRoadmapModule",
      method: "PATCH",
      content: "roadmap-module",
      path: MODULE,
      access: "private",
      summary: "Update a roadmap module",
      description:
        "Changes only the fields sent; a given `area` moves the module. The slug cannot change.",
      params: SlugParamsSchema,
      body: RoadmapModuleUpdateSchema,
      response: { status: 200, description: "The updated module.", schema: RoadmapModuleSchema },
      errors: ["not_found"],
      handle: ({ params, body }) => roadmap.updateModule(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteRoadmapModule",
      method: "DELETE",
      content: "roadmap-module",
      path: MODULE,
      access: "private",
      summary: "Delete a roadmap module",
      description: "A module that still has resources is not deleted; move or delete them first.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The module was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await roadmap.deleteModule(params.slug);
        return undefined;
      },
    }),

    defineRoute({
      operationId: "getRoadmapResource",
      method: "GET",
      path: RESOURCE,
      access: "public",
      summary: "Read a roadmap resource",
      params: SlugParamsSchema,
      response: { status: 200, description: "The resource.", schema: RoadmapResourceSchema },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getResource(params.slug),
    }),
    defineRoute({
      operationId: "createRoadmapResource",
      method: "POST",
      content: "roadmap-resource",
      path: RESOURCES,
      access: "private",
      summary: "Create a roadmap resource",
      description:
        "The resource belongs to the module named by `module`, and every slug in `topics` must " +
        "name an existing topic. Omitted fields make a planned resource without an estimate, " +
        "dates, link or topics. The slug is unique across all resources.",
      body: RoadmapResourceCreateSchema,
      response: {
        status: 201,
        description: "The created resource.",
        schema: RoadmapResourceSchema,
        location: RESOURCE,
      },
      errors: ["conflict"],
      handle: ({ body }) => roadmap.createResource(body),
    }),
    defineRoute({
      operationId: "updateRoadmapResource",
      method: "PATCH",
      content: "roadmap-resource",
      path: RESOURCE,
      access: "private",
      summary: "Update a roadmap resource",
      description:
        "Changes only the fields sent; a given `module` moves the resource and given `topics` " +
        "replace its topic links. The finish cannot be before the start, including a stored one.",
      params: SlugParamsSchema,
      body: RoadmapResourceUpdateSchema,
      response: {
        status: 200,
        description: "The updated resource.",
        schema: RoadmapResourceSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => roadmap.updateResource(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteRoadmapResource",
      method: "DELETE",
      content: "roadmap-resource",
      path: RESOURCE,
      access: "private",
      summary: "Delete a roadmap resource",
      description: "Deletes the resource with its topic links.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The resource was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await roadmap.deleteResource(params.slug);
        return undefined;
      },
    }),
  ];
}
