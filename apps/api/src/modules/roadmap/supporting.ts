// The supporting content's HTTP routes, private to the roadmap module and part of its routes:
// public reads and authenticated create, update and delete of project ideas, followed sources and
// glossary terms. Each is an ordered list of its own; nothing references them, so a delete is
// refused only when the record is missing.
import {
  RoadmapFollowedSourceCreateSchema,
  RoadmapFollowedSourceListSchema,
  RoadmapFollowedSourceSchema,
  RoadmapFollowedSourceUpdateSchema,
  RoadmapGlossaryTermCreateSchema,
  RoadmapGlossaryTermListSchema,
  RoadmapGlossaryTermSchema,
  RoadmapGlossaryTermUpdateSchema,
  RoadmapProjectIdeaCreateSchema,
  RoadmapProjectIdeaListSchema,
  RoadmapProjectIdeaSchema,
  RoadmapProjectIdeaUpdateSchema,
  SlugParamsSchema,
} from "@sebela/contracts";
import type { RoadmapService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const IDEAS = "/v1/roadmap/project-ideas";
const IDEA = "/v1/roadmap/project-ideas/:slug";
const SOURCES = "/v1/roadmap/followed-sources";
const SOURCE = "/v1/roadmap/followed-sources/:slug";
const TERMS = "/v1/roadmap/glossary-terms";
const TERM = "/v1/roadmap/glossary-terms/:slug";

const ORDER = "Ordered by position, then slug. None is the valid empty list.";
const CREATE = "The slug is unique and stable; a taken slug is a conflict.";
const UPDATE =
  "Changes only the fields sent; `null` clears an optional field and the slug cannot change.";
const DELETE = "Nothing references it, so it is deleted unless it is missing.";
const TOPIC_RULES =
  "Every slug in `topics` names an existing shared topic, each once (`validation_failed` on " +
  "`topics`).";

/** The routes of the project ideas, followed sources and glossary terms. */
export function supportingRoutes(roadmap: RoadmapService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listRoadmapProjectIdeas",
      method: "GET",
      path: IDEAS,
      access: "public",
      summary: "Read the project ideas",
      description: `Every project idea with its topics in their order. ${ORDER}`,
      response: {
        status: 200,
        description: "The project ideas.",
        schema: RoadmapProjectIdeaListSchema,
      },
      errors: [],
      handle: () => roadmap.listProjectIdeas(),
    }),
    defineRoute({
      operationId: "getRoadmapProjectIdea",
      method: "GET",
      path: IDEA,
      access: "public",
      summary: "Read a project idea",
      params: SlugParamsSchema,
      response: { status: 200, description: "The project idea.", schema: RoadmapProjectIdeaSchema },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getProjectIdea(params.slug),
    }),
    defineRoute({
      operationId: "createRoadmapProjectIdea",
      method: "POST",
      content: "roadmap-project-idea",
      path: IDEAS,
      access: "private",
      summary: "Add a project idea",
      description: `${CREATE} An omitted way to start means none and omitted topics none. ${TOPIC_RULES}`,
      body: RoadmapProjectIdeaCreateSchema,
      response: {
        status: 201,
        description: "The created project idea.",
        schema: RoadmapProjectIdeaSchema,
        location: IDEA,
      },
      errors: ["conflict"],
      handle: ({ body }) => roadmap.createProjectIdea(body),
    }),
    defineRoute({
      operationId: "updateRoadmapProjectIdea",
      method: "PATCH",
      content: "roadmap-project-idea",
      path: IDEA,
      access: "private",
      summary: "Update a project idea",
      description: `${UPDATE} Given \`topics\` replace every link. ${TOPIC_RULES}`,
      params: SlugParamsSchema,
      body: RoadmapProjectIdeaUpdateSchema,
      response: {
        status: 200,
        description: "The updated project idea.",
        schema: RoadmapProjectIdeaSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => roadmap.updateProjectIdea(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteRoadmapProjectIdea",
      method: "DELETE",
      content: "roadmap-project-idea",
      path: IDEA,
      access: "private",
      summary: "Delete a project idea",
      description: `Deletes the idea with its topic links and keeps the topics. ${DELETE}`,
      params: SlugParamsSchema,
      response: { status: 204, description: "The project idea was deleted." },
      errors: ["not_found"],
      handle: async ({ params }) => {
        await roadmap.deleteProjectIdea(params.slug);
        return undefined;
      },
    }),

    defineRoute({
      operationId: "listRoadmapFollowedSources",
      method: "GET",
      path: SOURCES,
      access: "public",
      summary: "Read the followed sources",
      description: `Every source followed to stay current. ${ORDER}`,
      response: {
        status: 200,
        description: "The followed sources.",
        schema: RoadmapFollowedSourceListSchema,
      },
      errors: [],
      handle: () => roadmap.listFollowedSources(),
    }),
    defineRoute({
      operationId: "getRoadmapFollowedSource",
      method: "GET",
      path: SOURCE,
      access: "public",
      summary: "Read a followed source",
      params: SlugParamsSchema,
      response: {
        status: 200,
        description: "The followed source.",
        schema: RoadmapFollowedSourceSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getFollowedSource(params.slug),
    }),
    defineRoute({
      operationId: "createRoadmapFollowedSource",
      method: "POST",
      content: "roadmap-followed-source",
      path: SOURCES,
      access: "private",
      summary: "Add a followed source",
      description: `${CREATE} An omitted description or link means none.`,
      body: RoadmapFollowedSourceCreateSchema,
      response: {
        status: 201,
        description: "The created followed source.",
        schema: RoadmapFollowedSourceSchema,
        location: SOURCE,
      },
      errors: ["conflict"],
      handle: ({ body }) => roadmap.createFollowedSource(body),
    }),
    defineRoute({
      operationId: "updateRoadmapFollowedSource",
      method: "PATCH",
      content: "roadmap-followed-source",
      path: SOURCE,
      access: "private",
      summary: "Update a followed source",
      description: UPDATE,
      params: SlugParamsSchema,
      body: RoadmapFollowedSourceUpdateSchema,
      response: {
        status: 200,
        description: "The updated followed source.",
        schema: RoadmapFollowedSourceSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => roadmap.updateFollowedSource(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteRoadmapFollowedSource",
      method: "DELETE",
      content: "roadmap-followed-source",
      path: SOURCE,
      access: "private",
      summary: "Delete a followed source",
      description: DELETE,
      params: SlugParamsSchema,
      response: { status: 204, description: "The followed source was deleted." },
      errors: ["not_found"],
      handle: async ({ params }) => {
        await roadmap.deleteFollowedSource(params.slug);
        return undefined;
      },
    }),

    defineRoute({
      operationId: "listRoadmapGlossaryTerms",
      method: "GET",
      path: TERMS,
      access: "public",
      summary: "Read the glossary terms",
      description: `Every additional term explained beside the roadmap. ${ORDER}`,
      response: {
        status: 200,
        description: "The glossary terms.",
        schema: RoadmapGlossaryTermListSchema,
      },
      errors: [],
      handle: () => roadmap.listGlossaryTerms(),
    }),
    defineRoute({
      operationId: "getRoadmapGlossaryTerm",
      method: "GET",
      path: TERM,
      access: "public",
      summary: "Read a glossary term",
      params: SlugParamsSchema,
      response: {
        status: 200,
        description: "The glossary term.",
        schema: RoadmapGlossaryTermSchema,
      },
      errors: ["not_found"],
      handle: ({ params }) => roadmap.getGlossaryTerm(params.slug),
    }),
    defineRoute({
      operationId: "createRoadmapGlossaryTerm",
      method: "POST",
      content: "roadmap-glossary-term",
      path: TERMS,
      access: "private",
      summary: "Add a glossary term",
      description: CREATE,
      body: RoadmapGlossaryTermCreateSchema,
      response: {
        status: 201,
        description: "The created glossary term.",
        schema: RoadmapGlossaryTermSchema,
        location: TERM,
      },
      errors: ["conflict"],
      handle: ({ body }) => roadmap.createGlossaryTerm(body),
    }),
    defineRoute({
      operationId: "updateRoadmapGlossaryTerm",
      method: "PATCH",
      content: "roadmap-glossary-term",
      path: TERM,
      access: "private",
      summary: "Update a glossary term",
      description: "Changes only the fields sent; the slug cannot change.",
      params: SlugParamsSchema,
      body: RoadmapGlossaryTermUpdateSchema,
      response: {
        status: 200,
        description: "The updated glossary term.",
        schema: RoadmapGlossaryTermSchema,
      },
      errors: ["not_found"],
      handle: ({ params, body }) => roadmap.updateGlossaryTerm(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteRoadmapGlossaryTerm",
      method: "DELETE",
      content: "roadmap-glossary-term",
      path: TERM,
      access: "private",
      summary: "Delete a glossary term",
      description: DELETE,
      params: SlugParamsSchema,
      response: { status: 204, description: "The glossary term was deleted." },
      errors: ["not_found"],
      handle: async ({ params }) => {
        await roadmap.deleteGlossaryTerm(params.slug);
        return undefined;
      },
    }),
  ];
}
