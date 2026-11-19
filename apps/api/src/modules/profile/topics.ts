import {
  SlugParamsSchema,
  TopicCreateSchema,
  TopicListSchema,
  TopicSchema,
  TopicUpdateSchema,
} from "@sebela/contracts";
import type { ProfileService } from "@sebela/services";

import { defineRoute, type RouteDefinition } from "../../routing.js";

const LIST = "/v1/topics";
const ITEM = "/v1/topics/:slug";

/**
 * The HTTP routes of the topic catalog, addressed by stable slug: public list and read,
 * authenticated create, update and delete. Domain errors become `not_found` and `conflict`.
 */
export function topicRoutes(profile: ProfileService): RouteDefinition[] {
  return [
    defineRoute({
      operationId: "listTopics",
      method: "GET",
      path: LIST,
      access: "public",
      summary: "List the topics",
      description: "Ordered by position and slug.",
      response: {
        status: 200,
        description: "Every topic, in catalog order.",
        schema: TopicListSchema,
      },
      errors: [],
      handle: () => profile.listTopics(),
    }),
    defineRoute({
      operationId: "getTopic",
      method: "GET",
      path: ITEM,
      access: "public",
      summary: "Read a topic",
      params: SlugParamsSchema,
      response: { status: 200, description: "The topic.", schema: TopicSchema },
      errors: ["not_found"],
      handle: ({ params }) => profile.getTopic(params.slug),
    }),
    defineRoute({
      operationId: "createTopic",
      method: "POST",
      content: "topic",
      path: LIST,
      access: "private",
      summary: "Create a topic",
      description: "The slug is unique and stable; a taken slug is a conflict.",
      body: TopicCreateSchema,
      response: {
        status: 201,
        description: "The created topic.",
        schema: TopicSchema,
        location: ITEM,
      },
      errors: ["conflict"],
      handle: ({ body }) => profile.createTopic(body),
    }),
    defineRoute({
      operationId: "updateTopic",
      method: "PATCH",
      content: "topic",
      path: ITEM,
      access: "private",
      summary: "Update a topic",
      description: "Changes only the fields sent; the slug cannot change.",
      params: SlugParamsSchema,
      body: TopicUpdateSchema,
      response: { status: 200, description: "The updated topic.", schema: TopicSchema },
      errors: ["not_found"],
      handle: ({ params, body }) => profile.updateTopic(params.slug, body),
    }),
    defineRoute({
      operationId: "deleteTopic",
      method: "DELETE",
      content: "topic",
      path: ITEM,
      access: "private",
      summary: "Delete a topic",
      description:
        "A topic that an exploration, a current-focus entry, a roadmap resource, an event or a " +
        "project idea still links is not deleted (`conflict`); remove those links first.",
      params: SlugParamsSchema,
      response: { status: 204, description: "The topic was deleted." },
      errors: ["not_found", "conflict"],
      handle: async ({ params }) => {
        await profile.deleteTopic(params.slug);
        return undefined;
      },
    }),
  ];
}
